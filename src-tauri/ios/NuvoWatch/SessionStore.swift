// The watch half of the credential bridge.
//
// The phone pushes a WatchConnectivity application context (see
// src-tauri/plugins/nuvo-watch/ios/Sources/NuvoWatchPlugin.swift); this receives
// it, keeps the newest, and persists it to the watch's own Keychain so the app
// is usable on a cold launch with the phone out of range.
//
// Two rules worth stating, because both are easy to get wrong:
//
//   • **Monotonic or ignored.** WatchConnectivity can deliver the same context
//     more than once, and `activationDidCompleteWith` also replays the last one
//     on launch. Anything not strictly newer than what we hold is dropped, so a
//     replay can never resurrect a credential we have already replaced.
//
//   • **A tombstone is not an absence.** The OS persists the application
//     context on both devices, so signing out on the phone cannot simply stop
//     sending — it sends `revoked: true`, and that deletes the Keychain item.
//     Nuvo is multi-tenant; a signed-out phone must not leave a live credential
//     on a wrist.
//
// No entitlement, no access group: the watch is a separate device with its own
// Keychain, which is why nuvo_iOS.entitlements stays empty.

import Foundation
import WatchConnectivity

struct Creds: Equatable {
    let url: String
    let anonKey: String
    /// The durable credential — a `connections` bearer token.
    let connectionToken: String?
    /// Short-lived Supabase access token. Milestone only; never refreshed here,
    /// because refreshing a rotated token would revoke the phone's session too.
    let accessToken: String?
    let userId: String
    let issuedAt: Int64

    /// What to send as `Authorization`, preferring the durable one.
    var bearer: String? { connectionToken ?? accessToken }
}

// MARK: - Keychain

enum Keychain {
    private static let service = "day.nuvo.app.watchkitapp"
    private static let account = "supabase-session"

    private static var base: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    static func save(_ c: Creds) {
        var dict: [String: Any] = [
            "url": c.url,
            "anonKey": c.anonKey,
            "userId": c.userId,
            "issuedAt": NSNumber(value: c.issuedAt),
        ]
        if let t = c.connectionToken { dict["connectionToken"] = t }
        if let t = c.accessToken { dict["accessToken"] = t }
        guard let data = try? JSONSerialization.data(withJSONObject: dict) else { return }

        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = data
        // AfterFirstUnlock so a background refresh can read it; ThisDeviceOnly
        // keeps it out of iCloud Keychain backup.
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    static func load() -> Creds? {
        var query = base
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }

        guard let url = dict["url"] as? String,
              let anonKey = dict["anonKey"] as? String,
              let userId = dict["userId"] as? String,
              let issuedAt = (dict["issuedAt"] as? NSNumber)?.int64Value
        else { return nil }

        return Creds(
            url: url,
            anonKey: anonKey,
            connectionToken: dict["connectionToken"] as? String,
            accessToken: dict["accessToken"] as? String,
            userId: userId,
            issuedAt: issuedAt
        )
    }

    static func clear() {
        SecItemDelete(base as CFDictionary)
    }
}

// MARK: - The session

final class SessionStore: NSObject, ObservableObject, WCSessionDelegate {
    @Published private(set) var creds: Creds?
    /// Set when a context arrived that we refused, so the UI can say something
    /// truthful rather than looking merely empty.
    @Published private(set) var lastError: String?

    override init() {
        super.init()
        creds = Keychain.load()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    var isSignedIn: Bool { creds?.bearer != nil }

    // MARK: WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        if let error {
            DispatchQueue.main.async { self.lastError = error.localizedDescription }
            return
        }
        // Cold launch: whatever the phone last sent is already sitting here.
        ingest(session.receivedApplicationContext)
    }

    func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
        ingest(context)
    }

    // MARK: -

    private func ingest(_ context: [String: Any]) {
        guard !context.isEmpty else { return }
        guard let v = (context["v"] as? NSNumber)?.int64Value else { return }
        // Strictly newer, or it is a replay.
        guard v > (creds?.issuedAt ?? Int64.min) else { return }

        if (context["revoked"] as? Bool) == true {
            Keychain.clear()
            DispatchQueue.main.async {
                self.creds = nil
                self.lastError = nil
            }
            return
        }

        guard let url = context["url"] as? String,
              let anonKey = context["anonKey"] as? String,
              let userId = context["userId"] as? String
        else { return }

        let next = Creds(
            url: url,
            anonKey: anonKey,
            connectionToken: context["connectionToken"] as? String,
            accessToken: context["accessToken"] as? String,
            userId: userId,
            issuedAt: v
        )
        Keychain.save(next)
        DispatchQueue.main.async {
            self.creds = next
            self.lastError = nil
        }
    }
}

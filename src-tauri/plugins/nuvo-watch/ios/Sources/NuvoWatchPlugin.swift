// The phone half of the credential bridge.
//
// Compiled by cargo (swift-rs) into libapp.a — NOT by the Xcode project. There
// is nothing to add to scripts/ios-watch.rb for this file.
//
// Transport choice, because it is load-bearing: `updateApplicationContext`
// keeps exactly ONE payload and replaces the previous one, delivered
// opportunistically whenever the watch next connects — which is exactly "the
// newest credential wins". `transferUserInfo` is a FIFO queue that delivers
// every item, so a watch that had been out of range would receive a backlog of
// already-dead tokens oldest-first and authenticate with the wrong one.
//
// WatchConnectivity needs no entitlement. nuvo_iOS.entitlements stays empty.

import Foundation
import Tauri
import UIKit
import WatchConnectivity
import WebKit

class PushSessionArgs: Decodable {
    let url: String
    let anonKey: String
    let connectionToken: String?
    let accessToken: String?
    let userId: String
    let issuedAt: Int64
}

struct WatchStatusPayload: Encodable {
    let supported: Bool
    let paired: Bool
    let installed: Bool
    let reachable: Bool
}

class NuvoWatchPlugin: Plugin, WCSessionDelegate {
    private var activated = false

    public override func load(webview: WKWebView) {
        activate()
    }

    private func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        if session.activationState != .activated {
            session.activate()
        }
    }

    /// Snapshot of the wrist. `isPaired` / `isWatchAppInstalled` are iOS-only
    /// properties — never referenced from the watch side.
    private func status(_ session: WCSession?) -> WatchStatusPayload {
        guard let s = session, WCSession.isSupported() else {
            return WatchStatusPayload(supported: false, paired: false, installed: false, reachable: false)
        }
        return WatchStatusPayload(
            supported: true,
            paired: s.isPaired,
            installed: s.isWatchAppInstalled,
            reachable: s.isReachable
        )
    }

    /// Replace the context wholesale. Every value must be a property-list type
    /// or `updateApplicationContext` throws.
    private func send(_ context: [String: Any], _ invoke: Invoke) {
        guard WCSession.isSupported() else {
            return invoke.resolve(status(nil))
        }
        let session = WCSession.default
        guard session.activationState == .activated else {
            activate()
            return invoke.reject("WCSession is not activated yet — try again in a moment")
        }
        do {
            try session.updateApplicationContext(context)
        } catch {
            return invoke.reject("updateApplicationContext failed: \(error.localizedDescription)")
        }
        invoke.resolve(status(session))
    }

    @objc public func pushSession(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(PushSessionArgs.self)
        var context: [String: Any] = [
            "v": args.issuedAt,
            "url": args.url,
            "anonKey": args.anonKey,
            "userId": args.userId,
            "revoked": false,
        ]
        // Only send what exists — an empty string would read as a real credential.
        if let t = args.connectionToken, !t.isEmpty { context["connectionToken"] = t }
        if let t = args.accessToken, !t.isEmpty { context["accessToken"] = t }
        send(context, invoke)
    }

    /// A tombstone rather than an absence. The application context is persisted
    /// by the OS on both devices, so leaving the last good payload there would
    /// keep a live credential on a wrist whose phone has signed out. The watch
    /// deletes its Keychain item when it sees this.
    @objc public func clearSession(_ invoke: Invoke) {
        send(["v": Int64(Date().timeIntervalSince1970), "revoked": true], invoke)
    }

    @objc public func watchStatus(_ invoke: Invoke) {
        invoke.resolve(status(WCSession.isSupported() ? WCSession.default : nil))
    }

    // MARK: - WCSessionDelegate
    //
    // All three are required on iOS; WCSession refuses to activate without them.

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        activated = state == .activated
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    /// Fires when the user switches to a different watch. Re-activating binds
    /// the session to the new device; without it the bridge silently stops.
    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
}

@_cdecl("init_plugin_nuvo_watch")
func initPlugin() -> Plugin {
    NuvoWatchPlugin()
}

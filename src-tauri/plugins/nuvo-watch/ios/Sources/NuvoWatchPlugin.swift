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

    /// A payload that arrived before WCSession finished activating.
    ///
    /// This exists because of a race that is easy to lose: activation is async
    /// and starts at launch, while the webview calls pushSession the moment the
    /// SPA mounts with a session in hand. Rejecting on "not activated yet" meant
    /// the credential was dropped — and because the JS side only pushes when the
    /// access token *changes*, nothing retried for the best part of an hour.
    /// So the last payload is held and flushed on activation instead.
    ///
    /// Only ever touched under `lock`: the delegate callbacks arrive on a
    /// background queue, the invoke comes from the webview's.
    private var pending: [String: Any]?
    private let lock = NSLock()

    public override func load(webview: WKWebView) {
        // This plugin is the only Swift `load(webview:)` hook we have. The
        // watch credential bridge is why the crate exists; the keyboard policy
        // lives here too so we don't mint a second plugin for one setter.
        allowProgrammaticKeyboard(webview)
        activate()
    }

    /// Widget / deep-link launches (`nuvo://capture`, `nuvo://chat`) have no
    /// webview user gesture. Stock WKWebView then silently no-ops a
    /// programmatic `input.focus()`, so the lock-screen ＋ opens the sheet
    /// and leaves you tapping the field. Capacitor / Cordova ship the same
    /// `keyboardDisplayRequiresUserAction = false` for this reason (D-115).
    /// Undocumented; if a review rejects it, revert this setter — the SPA
    /// half still lands the caret.
    ///
    /// Never KVC this. `keyboardDisplayRequiresUserAction` is a UIWebView
    /// leftover; WKWebView is not KVC-compliant for it. `setValue(_:forKey:)`
    /// raises `NSUnknownKeyException`, Swift `do/catch` does not catch that,
    /// and the process dies in `load(webview:)` — the app never opens.
    /// On iOS 13+ the private setter lives on `WKContentView` (a scroll-view
    /// child), not on `WKWebView`. Apply only where `responds(to:)` is true.
    private func allowProgrammaticKeyboard(_ webview: WKWebView) {
        let sel = sel_registerName("_setKeyboardDisplayRequiresUserAction:")
        func apply(_ target: NSObject) -> Bool {
            guard target.responds(to: sel) else { return false }
            typealias Setter = @convention(c) (AnyObject, Selector, Bool) -> Void
            let fn = unsafeBitCast(target.method(for: sel), to: Setter.self)
            fn(target, sel, false)
            return true
        }
        if apply(webview) { return }
        func walk(_ view: UIView) -> Bool {
            if apply(view) { return true }
            for child in view.subviews {
                if walk(child) { return true }
            }
            return false
        }
        _ = walk(webview)
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
            // Queued, not failed. Holding the newest payload is the whole point
            // of updateApplicationContext semantics anyway — one value, latest
            // wins — so a second push before activation simply replaces this.
            lock.lock()
            pending = context
            lock.unlock()
            activate()
            return invoke.resolve(status(session))
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
        guard state == .activated else { return }

        // Flush whatever arrived while we were still activating.
        lock.lock()
        let queued = pending
        pending = nil
        lock.unlock()

        guard let queued else { return }
        do {
            try session.updateApplicationContext(queued)
            NSLog("[nuvo-watch] flushed a queued credential on activation")
        } catch {
            NSLog("[nuvo-watch] flush failed: \(error.localizedDescription)")
        }
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

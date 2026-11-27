// The iPhone's APNs device token, for background reminders (D-259).
//
// iOS hands the token to the *app delegate*
// (`application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`), and a
// Tauri app's delegate belongs to tao — Swift in a plugin cannot subclass it.
// So the two callbacks are installed onto the delegate's class at runtime:
// added if the class lacks them (the usual case), chained in front of the
// original if it already has them. Nothing else about the delegate changes.
//
// This plugin never touches UNUserNotificationCenter's delegate: that belongs to
// tauri-plugin-notification (foreground presentation, taps). Registering for
// remote notifications does not need it, and does not prompt — the permission
// prompt is the notification plugin's, asked when reminders are turned on.

import Foundation
import ObjectiveC
import Tauri
import UIKit

/// Waiters for the one token iOS will deliver. Main-thread only.
private enum TokenBox {
    static var token: String?
    static var waiting: [(String?, String?) -> Void] = []
    static var hooked = false

    static func finish(token: String?, error: String?) {
        if let token { TokenBox.token = token }
        let callbacks = waiting
        waiting = []
        for cb in callbacks { cb(token, error) }
    }
}

private let didRegisterSel = NSSelectorFromString("application:didRegisterForRemoteNotificationsWithDeviceToken:")
private let didFailSel = NSSelectorFromString("application:didFailToRegisterForRemoteNotificationsWithError:")

private func installDelegateHooks() {
    if TokenBox.hooked { return }
    guard let delegate = UIApplication.shared.delegate else { return }
    TokenBox.hooked = true
    let cls: AnyClass = type(of: delegate)

    // didRegister — the token, as lowercase hex (what APNs expects in the path).
    typealias RegisterFn = @convention(c) (AnyObject, Selector, UIApplication, Data) -> Void
    var originalRegister: RegisterFn?
    if let existing = class_getInstanceMethod(cls, didRegisterSel) {
        originalRegister = unsafeBitCast(method_getImplementation(existing), to: RegisterFn.self)
    }
    let registerBlock: @convention(block) (AnyObject, UIApplication, Data) -> Void = { obj, app, data in
        originalRegister?(obj, didRegisterSel, app, data)
        let hex = data.map { String(format: "%02x", $0) }.joined()
        DispatchQueue.main.async { TokenBox.finish(token: hex, error: nil) }
    }
    let registerImp = imp_implementationWithBlock(registerBlock)
    if let existing = class_getInstanceMethod(cls, didRegisterSel) {
        method_setImplementation(existing, registerImp)
    } else {
        class_addMethod(cls, didRegisterSel, registerImp, "v@:@@")
    }

    // didFail — usually a missing aps-environment entitlement, or the simulator.
    typealias FailFn = @convention(c) (AnyObject, Selector, UIApplication, NSError) -> Void
    var originalFail: FailFn?
    if let existing = class_getInstanceMethod(cls, didFailSel) {
        originalFail = unsafeBitCast(method_getImplementation(existing), to: FailFn.self)
    }
    let failBlock: @convention(block) (AnyObject, UIApplication, NSError) -> Void = { obj, app, err in
        originalFail?(obj, didFailSel, app, err)
        let message = err.localizedDescription
        DispatchQueue.main.async { TokenBox.finish(token: nil, error: message) }
    }
    let failImp = imp_implementationWithBlock(failBlock)
    if let existing = class_getInstanceMethod(cls, didFailSel) {
        method_setImplementation(existing, failImp)
    } else {
        class_addMethod(cls, didFailSel, failImp, "v@:@@")
    }
}

/// Which APNs host accepts this build's tokens. A development-signed build
/// carries an embedded provisioning profile saying `development`; App Store and
/// TestFlight builds carry none and are production.
private func apsEnvironment() -> String {
    guard
        let path = Bundle.main.path(forResource: "embedded", ofType: "mobileprovision"),
        let data = FileManager.default.contents(atPath: path),
        let text = String(data: data, encoding: .isoLatin1),
        let keyRange = text.range(of: "<key>aps-environment</key>")
    else { return "production" }
    let tail = text[keyRange.upperBound...]
    guard
        let open = tail.range(of: "<string>"),
        let close = tail.range(of: "</string>", range: open.upperBound..<tail.endIndex)
    else { return "production" }
    let value = tail[open.upperBound..<close.lowerBound].trimmingCharacters(in: .whitespacesAndNewlines)
    return value == "development" ? "sandbox" : "production"
}

class NuvoPushPlugin: Plugin {
    @objc public func register(_ invoke: Invoke) {
        DispatchQueue.main.async {
            let environment = apsEnvironment()
            let reply: (String?, String?) -> Void = { token, error in
                var out: [String: Any] = ["supported": true, "environment": environment]
                if let token { out["token"] = token }
                if let error { out["error"] = error }
                invoke.resolve(out)
            }
            installDelegateHooks()
            if let token = TokenBox.token {
                reply(token, nil)
                return
            }
            var answered = false
            TokenBox.waiting.append { token, error in
                if answered { return }
                answered = true
                reply(token, error)
            }
            UIApplication.shared.registerForRemoteNotifications()
            // iOS normally answers in well under a second; never leave the
            // caller hanging if it doesn't (no network, no entitlement).
            DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
                if answered { return }
                answered = true
                reply(nil, "timed out waiting for an APNs token")
            }
        }
    }
}

@_cdecl("init_plugin_nuvo_push")
func initPlugin() -> Plugin {
    NuvoPushPlugin()
}

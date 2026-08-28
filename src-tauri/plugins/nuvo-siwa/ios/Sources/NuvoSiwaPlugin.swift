// Sign in with Apple. Compiled by cargo (swift-rs) into libapp.a — NOT by the
// Xcode project, so there is nothing to add to scripts/ios-siwa.rb for this
// file. That script carries only the entitlement.
//
// Delegate-based on purpose: no async/await, no Task. See Package.swift for
// why concurrency is unsafe in a swift-rs target at the current minos.
//
// This file NEVER hashes the nonce. JS holds the raw nonce and hands down its
// SHA-256 hex digest, which is what Apple embeds in the identity token; the
// raw value goes to Supabase, which hashes it and compares. Hashing in two
// places is how that pair silently drifts apart.

import AuthenticationServices
import Foundation
import Tauri
import UIKit
import WebKit

class SignInArgs: Decodable {
    /// SHA-256 hex digest of the raw nonce JS keeps. Never the raw nonce.
    let nonce: String
}

struct AppleCredentialPayload: Encodable {
    let supported: Bool
    let identityToken: String?
    let authorizationCode: String?
    let user: String?
    let email: String?
    let givenName: String?
    let familyName: String?
}

/// The string JS matches to tell "the user backed out" from "this broke".
/// Keep it in sync with APPLE_SIGN_IN_CANCELLED in src/lib/appleAuth.ts.
private let cancelledMessage = "Sign in with Apple was cancelled"

class NuvoSiwaPlugin: Plugin, ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding
{
    /// The in-flight invoke, and the controller itself.
    ///
    /// Both are held deliberately. `ASAuthorizationController` is not retained
    /// by the system while it presents: a locally-scoped one is deallocated the
    /// moment the function returns, and neither delegate method ever fires — the
    /// sheet appears and the promise hangs forever. Only ever touched under
    /// `lock`; the delegate callbacks arrive on the main queue, the invoke comes
    /// from the webview's.
    private var pending: Invoke?
    private var controller: ASAuthorizationController?
    private let lock = NSLock()

    @objc public func signIn(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SignInArgs.self)
        guard !args.nonce.isEmpty else {
            return invoke.reject("Missing nonce")
        }

        lock.lock()
        let inFlight = pending != nil
        if !inFlight { pending = invoke }
        lock.unlock()
        // A second tap while Apple's sheet is already up would replace the first
        // invoke and strand it unresolved. Refuse instead.
        if inFlight {
            return invoke.reject("Sign in with Apple is already in progress")
        }

        // ASAuthorizationController is UI: it must be built and performed on the
        // main thread, and the invoke arrives on the webview's queue.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            // Already hashed by JS. Apple puts this verbatim in the token's
            // `nonce` claim.
            request.nonce = args.nonce

            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.lock.lock()
            self.controller = controller
            self.lock.unlock()
            controller.performRequests()
        }
    }

    /// Take the in-flight invoke, exactly once. A delegate that fires twice —
    /// or after a cancel already resolved — must not resolve a dead promise.
    private func takePending() -> Invoke? {
        lock.lock()
        let invoke = pending
        pending = nil
        controller = nil
        lock.unlock()
        return invoke
    }

    // MARK: - ASAuthorizationControllerDelegate

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        guard let invoke = takePending() else { return }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
            return invoke.reject("Apple returned an unexpected credential")
        }
        guard let tokenData = credential.identityToken,
              let identityToken = String(data: tokenData, encoding: .utf8),
              !identityToken.isEmpty
        else {
            return invoke.reject("Apple returned no identity token")
        }

        // Single-use and short-lived (~5 min). The server exchanges it for the
        // refresh token that account deletion revokes; nothing else can.
        var authorizationCode: String?
        if let codeData = credential.authorizationCode {
            authorizationCode = String(data: codeData, encoding: .utf8)
        }

        // ⚠️ fullName and email are populated ONLY on the very first
        // authorization for this Apple ID + app pair, ever. Every later
        // sign-in leaves them nil, and the only way back is the user revoking
        // Nuvo in Settings → Apple ID. Whoever receives this persists them now
        // or never gets them. Email may be a @privaterelay.appleid.com alias.
        invoke.resolve(AppleCredentialPayload(
            supported: true,
            identityToken: identityToken,
            authorizationCode: authorizationCode,
            user: credential.user,
            email: credential.email,
            givenName: credential.fullName?.givenName,
            familyName: credential.fullName?.familyName
        ))
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        guard let invoke = takePending() else { return }
        // Backing out of the sheet is not a failure the user should be told
        // about twice. JS matches this string and stays quiet.
        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            return invoke.reject(cancelledMessage)
        }
        invoke.reject(error.localizedDescription)
    }

    // MARK: - ASAuthorizationControllerPresentationContextProviding

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }
        // A fresh UIWindow is Apple's own sample fallback — the sheet still
        // presents, and returning nil is not an option (non-optional return).
        return window ?? ASPresentationAnchor()
    }
}

@_cdecl("init_plugin_nuvo_siwa")
func initPlugin() -> Plugin {
    NuvoSiwaPlugin()
}

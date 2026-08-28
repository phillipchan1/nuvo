// swift-tools-version:5.9

import PackageDescription

let package = Package(
    name: "tauri-plugin-nuvo-siwa",
    platforms: [
        // Matches the app's deployment target (tauri.conf.json
        // bundle.iOS.minimumSystemVersion "15.0").
        //
        // ⚠️ As documented on nuvo-watch's Package.swift: this declaration does
        // NOT actually raise the built object's floor — swift-rs passes its own
        // `-target` and the emitted static lib reports `minos 13.0`. The known
        // failure mode is Swift *concurrency* compiled below 15 going through
        // the back-deployment runtime and crashing at Task creation. So this
        // target, like the other two, contains no `async`, no `await` and no
        // `Task`: ASAuthorizationController is delegate-based, which is exactly
        // why it is used here rather than the async credential APIs. Do not
        // introduce concurrency without re-checking that floor first.
        .iOS(.v15),
        // SwiftPM resolution consistency with the Tauri package; only ever
        // compiled into iOS builds.
        .macOS(.v12),
    ],
    products: [
        .library(
            name: "tauri-plugin-nuvo-siwa",
            type: .static,
            targets: ["tauri-plugin-nuvo-siwa"]),
    ],
    dependencies: [
        // Injected as a sibling local package by the Tauri CLI during
        // `tauri ios init` / `tauri ios build`.
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-nuvo-siwa",
            dependencies: [.byName(name: "Tauri")],
            path: "Sources"),
    ]
)

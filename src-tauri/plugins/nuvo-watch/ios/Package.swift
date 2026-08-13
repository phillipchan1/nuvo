// swift-tools-version:5.9

import PackageDescription

let package = Package(
    name: "tauri-plugin-nuvo-watch",
    platforms: [
        // Matches the app's deployment target (tauri.conf.json
        // bundle.iOS.minimumSystemVersion "15.0").
        //
        // ⚠️ Verified 2026-08-13 that this declaration does NOT actually raise
        // the built object's floor: swift-rs passes its own `-target`, and the
        // emitted static lib reports `minos 13.0` (checked with `otool -l` on
        // out/swift-rs/.../libtauri-plugin-nuvo-watch.a — platform 2, iOS).
        //
        // Why that is safe *here*: there is no Swift concurrency in this plugin
        // — no `async`, no `Task`, only synchronous WCSession calls and
        // delegate callbacks. The known failure mode is concurrency compiled
        // below 15 going through the back-deployment runtime and crashing at
        // Task creation when linked through swift-rs. **So do not introduce
        // async/await into this target without re-checking that floor first.**
        .iOS(.v15),
        // SwiftPM resolution consistency with the Tauri package; only ever
        // compiled into iOS builds.
        .macOS(.v12),
    ],
    products: [
        .library(
            name: "tauri-plugin-nuvo-watch",
            type: .static,
            targets: ["tauri-plugin-nuvo-watch"]),
    ],
    dependencies: [
        // Injected as a sibling local package by the Tauri CLI during
        // `tauri ios init` / `tauri ios build`.
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-nuvo-watch",
            dependencies: [.byName(name: "Tauri")],
            path: "Sources"),
    ]
)

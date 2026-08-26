// swift-tools-version:5.9

import PackageDescription

let package = Package(
    name: "tauri-plugin-nuvo-iap",
    platforms: [
        // Matches the app's deployment target. StoreKit 1 delegates only —
        // no async/await. See nuvo-watch Package.swift for why concurrency
        // is unsafe through swift-rs at the current minos.
        .iOS(.v15),
        .macOS(.v12),
    ],
    products: [
        .library(
            name: "tauri-plugin-nuvo-iap",
            type: .static,
            targets: ["tauri-plugin-nuvo-iap"]),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-nuvo-iap",
            dependencies: [.byName(name: "Tauri")],
            path: "Sources"),
    ]
)

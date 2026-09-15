// swift-tools-version:5.9

import PackageDescription

let package = Package(
    name: "tauri-plugin-nuvo-iap",
    platforms: [
        // Matches the app's deployment target. Purchase/restore use StoreKit 2
        // (async/await) — the same calls Dayspring ships on this identical
        // toolchain. See nuvo-watch Package.swift for the swift-rs minos caveat.
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

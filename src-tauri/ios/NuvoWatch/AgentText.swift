// The agent answers in markdown. A watch has to read it, not show it.
//
// The reply is written for the SPA, which renders `**bold**`, `- ` bullets and
// `##` headings. SwiftUI's `Text` does none of that on its own, so the first
// build put literal asterisks on the wrist:
//
//     **12:00–1:00 PM** — Lunch
//
// SwiftUI can parse inline markdown into an AttributedString, which handles the
// bold. What it does NOT handle is block structure — headings, list markers,
// hard line breaks — so those are normalised to something a 45mm screen can
// actually scan before the inline parse runs.

import Foundation
import SwiftUI

enum AgentText {
    /// Markdown from the agent → something readable on a watch face.
    static func render(_ raw: String) -> AttributedString {
        let cleaned = normalizeBlocks(raw)
        // `.inlineOnlyPreservingWhitespace` keeps the line breaks we just made
        // deliberate; the default collapses them into one paragraph.
        if let attributed = try? AttributedString(
            markdown: cleaned,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            return attributed
        }
        return AttributedString(cleaned)
    }

    /// Block-level markdown the inline parser would otherwise leave as litter.
    private static func normalizeBlocks(_ raw: String) -> String {
        raw
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { line -> String in
                var s = String(line).trimmingCharacters(in: .whitespaces)
                // Headings: the watch has one type scale, so a heading is just
                // a line. Keep its words, drop its hashes.
                while s.hasPrefix("#") { s.removeFirst() }
                s = s.trimmingCharacters(in: .whitespaces)
                // List markers: a real bullet reads better than a hyphen and
                // costs the same width.
                for marker in ["- ", "* ", "+ "] where s.hasPrefix(marker) {
                    s = "• " + s.dropFirst(marker.count)
                    break
                }
                return s
            }
            .joined(separator: "\n")
            // Three or more newlines is the model breathing, not structure.
            .replacingOccurrences(
                of: "\n{3,}", with: "\n\n", options: .regularExpression
            )
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

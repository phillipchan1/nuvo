// The Warm Paper tokens, transcribed for watchOS.
//
// ⚠️ This is the SECOND transcription of these values — `NuvoWidgets.swift`
// carries a private copy of the same four. Swift can't read `src/index.css`, so
// some duplication is unavoidable, but two copies drifting apart is a real
// hazard: the accent is the app's identity and a watch face that renders a
// slightly different purple reads as a different product.
//
// The fix when a build can verify it: move this file to `src-tauri/ios/Shared/`
// and add that directory to BOTH targets' `sources:` in ios-watch.rb and
// ios-widgets.rb. Left alone for now rather than editing a shipped, working
// widget target in a change that isn't compiled here.

import SwiftUI

enum Paper {
    static let bg = Color(red: 0.957, green: 0.945, blue: 0.918) // --bg     #f4f1ea
    static let ink = Color(red: 0.122, green: 0.102, blue: 0.086) // --text   #1f1a16
    static let muted = Color(red: 0.435, green: 0.400, blue: 0.337) // --muted #6f6656
    static let accent = Color(red: 0.573, green: 0.337, blue: 0.541) // --accent #92568a
    static let onAccent = Color.white
}

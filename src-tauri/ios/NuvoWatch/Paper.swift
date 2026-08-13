// The Warm Paper tokens, transcribed for watchOS — the DARK set, on purpose.
//
// The first cut used the light values (--bg #f4f1ea, --text #1f1a16) and put
// near-black text on a platform that is black. It was unreadable on the wrist.
// watchOS has no light mode: the face is black, content floats on it, and the
// system paints the background. So the watch wears Nuvo's dark theme —
// `[data-theme="dark"]` in src/index.css — and paints no background of its own.
//
// ⚠️ Third transcription of these values (the phone widgets and the watch
// complications carry the others). Swift can't read src/index.css. Keep them in
// step: the accent is the app's identity and a slightly different purple reads
// as a different product.

import SwiftUI

enum Paper {
    /// --text  #f1ece2 — the reading colour. Not `.primary`: the warm off-white
    /// is what makes this Nuvo and not a system app.
    static let ink = Color(red: 0.945, green: 0.925, blue: 0.886)
    /// --muted #a99c87
    static let muted = Color(red: 0.663, green: 0.612, blue: 0.529)
    /// --accent #c692bf — the dark theme's accent, lifted for contrast against
    /// black. The light theme's #92568a fails against it.
    static let accent = Color(red: 0.776, green: 0.573, blue: 0.749)
    /// --surface #201b14 — for the few things that genuinely float.
    static let surface = Color(red: 0.125, green: 0.106, blue: 0.078)
    /// --line #332c20
    static let line = Color(red: 0.200, green: 0.173, blue: 0.125)
    /// --bg #17130e. Used sparingly: on watchOS the system's black is the
    /// canvas, and painting over it is how a screen stops feeling native.
    static let bg = Color(red: 0.090, green: 0.075, blue: 0.055)
}

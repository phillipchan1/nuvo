// Nuvo — iOS widgets (lock screen + Home Screen).
//
// The phone shell floats two permanent first-class actions above the bottom bar:
// capture (＋) and the Nuvo chat (✦). Neither is a place, so neither is a tab —
// and on a locked phone neither is reachable at all without unlocking, finding
// the app, waiting for the webview, and then tapping. These widgets are that
// same pair, moved to the lock screen: one tap from a raised phone to the sheet.
//
// They are LAUNCHERS, not readouts. A widget can only ever show what the app
// wrote the last time it ran, and a stale "next up" that reads as live is worse
// than no line at all (Principle 7) — so nothing here claims to know your day.
// When a glance widget lands it ships with its own "as of" stamp and an App
// Group snapshot behind it; see docs/ios-releases.md § Phase 3.
//
// How a tap reaches the app: each widget links to the `nuvo://` scheme
// registered by scripts/ios-postinit.sh. iOS opens the app with that URL,
// tauri-plugin-deep-link emits it into the webview, and MobileShell's
// applyShortcut opens the same overlay the ＋ / ✦ buttons open
// (src/lib/shortcuts.ts is the shared vocabulary — keep the two in step).
//
// This target is generated into the Xcode project by scripts/ios-widgets.rb,
// which runs from scripts/ios-postinit.sh after `tauri ios init`.

import SwiftUI
import WidgetKit

// MARK: - The acts

/// The two acts a widget can launch, each with the deep link MobileShell reads.
/// Mirrors `Shortcut` in `src/lib/shortcuts.ts`.
enum NuvoAct {
    case capture
    case chat

    var url: URL {
        switch self {
        case .capture: return URL(string: "nuvo://capture")!
        case .chat: return URL(string: "nuvo://chat")!
        }
    }

    /// SF Symbols standing in for the app's own marks: ＋ for capture, ✦ for Nuvo.
    var symbol: String {
        switch self {
        case .capture: return "plus"
        case .chat: return "sparkle"
        }
    }

    var label: String {
        switch self {
        case .capture: return "Capture"
        case .chat: return "Ask Nuvo"
        }
    }
}

// MARK: - Palette
//
// Warm Paper, transcribed. The tokens live in `src/index.css` (`--bg`, `--ink`,
// `--accent`…) and cannot be read from here, so the Home Screen faces carry a
// copy. Lock-screen faces ignore all of it — iOS renders accessory widgets in
// its own vibrant monochrome — which is why only the small/medium ones do.

private enum Paper {
    static let bg = Color(red: 0.957, green: 0.945, blue: 0.918) // --bg   #f4f1ea
    static let ink = Color(red: 0.122, green: 0.102, blue: 0.086) // --text #1f1a16
    static let muted = Color(red: 0.435, green: 0.400, blue: 0.337) // --muted #6f6656
    static let accent = Color(red: 0.573, green: 0.337, blue: 0.541) // --accent #92568a
    static let onAccent = Color.white
}

// MARK: - Entry
//
// Nothing to time-travel through: the widgets carry no data, so one entry that
// never expires. `.never` means WidgetKit stops asking for a timeline, which is
// the honest thing to say when there is nothing to refresh.

struct NuvoEntry: TimelineEntry {
    let date: Date
}

struct NuvoProvider: TimelineProvider {
    func placeholder(in context: Context) -> NuvoEntry { NuvoEntry(date: Date()) }

    func getSnapshot(in context: Context, completion: @escaping (NuvoEntry) -> Void) {
        completion(NuvoEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NuvoEntry>) -> Void) {
        completion(Timeline(entries: [NuvoEntry(date: Date())], policy: .never))
    }
}

// MARK: - Shared marks

/// iOS 17 requires every widget to declare its own background; earlier systems
/// paint it themselves. One modifier so each face can stay a plain view.
private struct WidgetCanvas: ViewModifier {
    let paper: Bool

    func body(content: Content) -> some View {
        if #available(iOS 17.0, *) {
            if paper {
                content.containerBackground(Paper.bg, for: .widget)
            } else {
                content.containerBackground(Color.clear, for: .widget)
            }
        } else {
            content
        }
    }
}

private extension View {
    func nuvoCanvas(paper: Bool = false) -> some View { modifier(WidgetCanvas(paper: paper)) }
}

/// The circular lock-screen face: one glyph, one tap, no words — at that size a
/// label is unreadable and the glyph is the whole affordance.
private struct CircularFace: View {
    let act: NuvoAct

    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            Image(systemName: act.symbol)
                .font(.system(size: 22, weight: .semibold))
        }
        .widgetURL(act.url)
        .nuvoCanvas()
    }
}

/// One act as a pill — the unit the rectangular and Home Screen faces stack.
private struct ActPill: View {
    let act: NuvoAct
    let filled: Bool

    var body: some View {
        Link(destination: act.url) {
            HStack(spacing: 5) {
                Image(systemName: act.symbol).font(.system(size: 12, weight: .semibold))
                Text(act.label).font(.system(size: 13, weight: .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 7)
            .background(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(filled ? Paper.accent.opacity(0.14) : Color.primary.opacity(0.10))
            )
        }
    }
}

// MARK: - Faces

/// Capture — the one that earns its place on a lock screen. Raise, tap, type.
struct NuvoCaptureWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NuvoCapture", provider: NuvoProvider()) { _ in
            CaptureFace()
        }
        .configurationDisplayName("Capture")
        .description("One tap into Nuvo's inbox — before the thought is gone.")
        .supportedFamilies([.accessoryCircular, .accessoryInline, .systemSmall])
    }
}

private struct CaptureFace: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .accessoryInline:
            // Inline gets one line beside the clock — glyph plus a verb.
            Label("Capture", systemImage: NuvoAct.capture.symbol)
                .widgetURL(NuvoAct.capture.url)
        case .systemSmall:
            HomeFace(act: .capture)
        default:
            CircularFace(act: .capture)
        }
    }
}

/// Ask Nuvo — the chat, reachable without hunting for the ✦ launcher first.
struct NuvoChatWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NuvoChat", provider: NuvoProvider()) { _ in
            ChatFace()
        }
        .configurationDisplayName("Ask Nuvo")
        .description("Open the Nuvo chat straight from the lock screen.")
        .supportedFamilies([.accessoryCircular, .accessoryInline, .systemSmall])
    }
}

private struct ChatFace: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .accessoryInline:
            Label("Ask Nuvo", systemImage: NuvoAct.chat.symbol)
                .widgetURL(NuvoAct.chat.url)
        case .systemSmall:
            HomeFace(act: .chat)
        default:
            CircularFace(act: .chat)
        }
    }
}

/// Both acts on one widget — the rectangular lock-screen slot is wide enough to
/// hold the choice, so you pick at the moment of the tap rather than at the
/// moment you placed the widget.
struct NuvoActionsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NuvoActions", provider: NuvoProvider()) { _ in
            ActionsFace()
        }
        .configurationDisplayName("Capture · Ask")
        .description("Both of Nuvo's floating actions, side by side.")
        .supportedFamilies([.accessoryRectangular, .systemMedium])
    }
}

private struct ActionsFace: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if family == .systemMedium {
            VStack(alignment: .leading, spacing: 10) {
                Text("Nuvo")
                    .font(.system(size: 15, weight: .semibold, design: .serif))
                    .foregroundStyle(Paper.ink)
                HStack(spacing: 8) {
                    ActPill(act: .capture, filled: true)
                    ActPill(act: .chat, filled: false)
                }
                .foregroundStyle(Paper.ink)
            }
            .padding(14)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .nuvoCanvas(paper: true)
        } else {
            HStack(spacing: 6) {
                ActPill(act: .capture, filled: false)
                ActPill(act: .chat, filled: false)
            }
            .nuvoCanvas()
        }
    }
}

/// The Home Screen small face: a single act, big enough to hit without looking.
private struct HomeFace: View {
    let act: NuvoAct

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Nuvo")
                .font(.system(size: 13, weight: .semibold, design: .serif))
                .foregroundStyle(Paper.muted)
            Spacer(minLength: 8)
            Image(systemName: act.symbol)
                .font(.system(size: 26, weight: .semibold))
                .foregroundStyle(Paper.onAccent)
                .frame(width: 46, height: 46)
                .background(Circle().fill(Paper.accent))
            Spacer(minLength: 8)
            Text(act.label)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Paper.ink)
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .widgetURL(act.url)
        .nuvoCanvas(paper: true)
    }
}

// MARK: - Bundle

@main
struct NuvoWidgetBundle: WidgetBundle {
    var body: some Widget {
        NuvoCaptureWidget()
        NuvoChatWidget()
        NuvoActionsWidget()
    }
}

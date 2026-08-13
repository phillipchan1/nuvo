// Nuvo — watch face complications.
//
// The two acts, one turn of the wrist away: **Capture** and **Ask Nuvo**. Same
// pair as the iPhone's floating ＋ / ✦, same pair as its lock-screen widgets,
// same names (Principle 11). A complication cannot take text itself, so each one
// opens the watch app on the view that can — `nuvo://capture`, `nuvo://chat`,
// the same vocabulary `src/lib/shortcuts.ts` parses and `WatchRoute` reads.
//
// They carry NO DATA, deliberately, and for the same reason the lock-screen
// widgets don't (D-100): a complication renders what was last written, and a
// stale "next up" that reads as live is worse than no line at all (Principle 7).
// When the day arrives here it ships with its own "as of" stamp behind it.
//
// This target is injected into the generated Xcode project by
// scripts/ios-watch.rb and embedded in the WATCH app — not the iPhone app.

import SwiftUI
import WidgetKit

// MARK: - The acts

enum WatchAct {
    case capture
    case chat

    var url: URL {
        switch self {
        case .capture: return URL(string: "nuvo://capture")!
        case .chat: return URL(string: "nuvo://chat")!
        }
    }

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

// MARK: - Tokens
//
// Third transcription of the Warm Paper values (the phone widgets and the watch
// app carry the other two). Complications render in the face's own tint on most
// families, so only the accent is really reachable — but keep it exact anyway:
// a slightly different purple reads as a different product.

private enum Paper {
    static let accent = Color(red: 0.573, green: 0.337, blue: 0.541) // --accent #92568a
}

// MARK: - Entry

struct ActEntry: TimelineEntry {
    let date: Date
}

struct ActProvider: TimelineProvider {
    func placeholder(in context: Context) -> ActEntry { ActEntry(date: Date()) }
    func getSnapshot(in context: Context, completion: @escaping (ActEntry) -> Void) {
        completion(ActEntry(date: Date()))
    }
    // Nothing to refresh — there is no data here to go stale. `.never` is the
    // honest thing to tell WidgetKit rather than waking for no reason.
    func getTimeline(in context: Context, completion: @escaping (Timeline<ActEntry>) -> Void) {
        completion(Timeline(entries: [ActEntry(date: Date())], policy: .never))
    }
}

// MARK: - Faces

struct ActCircular: View {
    let act: WatchAct
    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            Image(systemName: act.symbol)
                .font(.title3)
        }
        .widgetURL(act.url)
    }
}

struct ActInline: View {
    let act: WatchAct
    var body: some View {
        // Inline is a single tinted line beside the time; an icon plus one word
        // is all it can honestly hold.
        Label(act.label, systemImage: act.symbol)
            .widgetURL(act.url)
    }
}

struct ActCorner: View {
    let act: WatchAct
    var body: some View {
        Image(systemName: act.symbol)
            .font(.title3)
            .widgetLabel(act.label)
            .widgetURL(act.url)
    }
}

/// Rectangular is the only family with room for both acts, so it carries both —
/// two separate tap targets, the way the iPhone's medium widget does.
struct BothRectangular: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Nuvo")
                .font(.headline)
                .foregroundStyle(Paper.accent)
            HStack(spacing: 10) {
                Link(destination: WatchAct.capture.url) {
                    Label("Capture", systemImage: "plus")
                }
                Link(destination: WatchAct.chat.url) {
                    Label("Ask", systemImage: "sparkle")
                }
            }
            .font(.caption2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Widgets

struct NuvoCaptureComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NuvoWatchCapture", provider: ActProvider()) { _ in
            ComplicationBody(act: .capture)
        }
        .configurationDisplayName("Capture")
        .description("Add to your Nuvo inbox from the watch face.")
        .supportedFamilies([.accessoryCircular, .accessoryInline, .accessoryCorner])
    }
}

struct NuvoChatComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NuvoWatchChat", provider: ActProvider()) { _ in
            ComplicationBody(act: .chat)
        }
        .configurationDisplayName("Ask Nuvo")
        .description("Open the Nuvo chat from the watch face.")
        .supportedFamilies([.accessoryCircular, .accessoryInline, .accessoryCorner])
    }
}

struct NuvoActsComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NuvoWatchActs", provider: ActProvider()) { _ in
            BothRectangular()
        }
        .configurationDisplayName("Nuvo")
        .description("Capture and Ask Nuvo together.")
        .supportedFamilies([.accessoryRectangular])
    }
}

/// One body that renders whichever family the face asked for.
struct ComplicationBody: View {
    @Environment(\.widgetFamily) private var family
    let act: WatchAct

    var body: some View {
        switch family {
        case .accessoryInline: ActInline(act: act)
        case .accessoryCorner: ActCorner(act: act)
        default: ActCircular(act: act)
        }
    }
}

@main
struct NuvoWatchWidgetBundle: WidgetBundle {
    var body: some Widget {
        NuvoCaptureComplication()
        NuvoChatComplication()
        NuvoActsComplication()
    }
}

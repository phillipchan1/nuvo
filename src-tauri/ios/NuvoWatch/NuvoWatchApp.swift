// Nuvo — watchOS companion.
//
// watchOS has no web view, so unlike the iPhone (a Tauri shell over the same
// React bundle) not one line of `src/` is reachable here. This is native SwiftUI
// talking to Supabase over HTTPS.
//
// The rule that shapes everything: **the watch computes nothing.** Nuvo's day
// rules — what counts as busy, which events you can see, how much of a working
// window is unclaimed, the words a day is described in — live in
// `supabase/functions/_shared/dayShape.ts` and are imported by both the SPA and
// the agent. Re-deriving them in Swift would be a third runtime of the same
// logic, which is the drift the planning kernel exists to prevent.
//
// Two acts, matching the iPhone's two floating actions and its lock-screen
// widgets exactly — **Capture** and **Ask Nuvo**. Same names, same acts, three
// surfaces (Principle 11). The complications in NuvoWatchWidgets are these two
// again, on the watch face, because a complication cannot take text itself: it
// opens the app on the view that can.

import SwiftUI

/// Which act a launch is asking for. Mirrors `Shortcut` in
/// `src/lib/shortcuts.ts` and `NuvoAct` in `NuvoWidgets.swift` — a complication's
/// ＋ and the app's ＋ must never be able to mean different things.
enum WatchRoute: String, Identifiable, Hashable {
    case capture
    case chat

    var id: String { rawValue }

    /// The complication's deep link. `nuvo://capture` / `nuvo://chat`.
    static func from(_ url: URL) -> WatchRoute? {
        WatchRoute(rawValue: url.host ?? url.path.replacingOccurrences(of: "/", with: ""))
    }
}

@main
struct NuvoWatchApp: App {
    @StateObject private var session = SessionStore()
    @State private var route: WatchRoute?

    var body: some Scene {
        WindowGroup {
            RootView(route: $route)
                .environmentObject(session)
                // A complication tap arrives here. Presenting rather than
                // pushing keeps Today at the root, so the leading-edge swipe
                // (which pops the stack on watchOS) has nothing to fight.
                .sheet(item: $route) { r in
                    NavigationStack {
                        switch r {
                        case .capture: CaptureView()
                        case .chat: AskView()
                        }
                    }
                    .environmentObject(session)
                }
                .onOpenURL { url in
                    if let r = WatchRoute.from(url) { route = r }
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var session: SessionStore
    @Binding var route: WatchRoute?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 8) {
                if session.isSignedIn {
                    // The two acts, in the order they are reached for.
                    Button {
                        route = .capture
                    } label: {
                        Label("Capture", systemImage: "plus")
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .tint(Paper.accent)

                    Button {
                        route = .chat
                    } label: {
                        Label("Ask Nuvo", systemImage: "sparkle")
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    // Deliberately says nothing about the day yet. A glance that
                    // looks live when it has no data is the Principle 7 failure
                    // the lock-screen widgets refused to ship; the day arrives
                    // here when it arrives from GET /day, with its "as of".
                } else {
                    Text("Not signed in yet")
                        .font(.footnote)
                        .foregroundStyle(Paper.accent)
                    Text("Open Nuvo on your iPhone to hand this watch a credential.")
                        .font(.caption2)
                        .foregroundStyle(Paper.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let err = session.lastError {
                    Text(err)
                        .font(.caption2)
                        .foregroundStyle(Paper.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .navigationTitle("Nuvo")
            .containerBackground(Paper.bg.gradient, for: .navigation)
        }
    }
}

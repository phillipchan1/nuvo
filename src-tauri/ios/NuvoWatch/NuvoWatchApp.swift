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
// logic, which is the drift the planning kernel exists to prevent. So this app
// asks `GET /functions/v1/day` and renders what it gets: `timeRange` and
// `readout` arrive pre-formatted in the wearer's zone and are shown verbatim.
//
// THIS FILE IS THE FIRST MILESTONE ONLY — a shell that proves the delivery
// chain: xcodegen injection (scripts/ios-watch.rb) → embedded in the iOS app at
// Payload/Nuvo.app/Watch/Nuvo.app → one TestFlight build → installed on a
// paired watch. It shows nothing about your day on purpose. A glance that
// looks live when it has no credential and no data is exactly the Principle 7
// failure the lock-screen widgets refused to ship (D-100); this says plainly
// that it is waiting for the phone instead.
//
// Next, in order: the token bridge (the phone hands this app a credential over
// WCSession), then Today, then Capture, then Ask Nuvo.

import SwiftUI

@main
struct NuvoWatchApp: App {
    @StateObject private var session = SessionStore()

    var body: some Scene {
        WindowGroup {
            // Today will be the ROOT view when it lands. On watchOS a
            // leading-edge swipe pops the navigation stack, which fights the
            // horizontal day pager — keeping Today at the root means there is
            // nothing to pop back to and the edge swipe is inert.
            RootView()
                .environmentObject(session)
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var session: SessionStore

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Nuvo")
                .font(.system(.title3, design: .serif))
                .foregroundStyle(Paper.ink)

            if session.isSignedIn {
                // The credential arrived. Still says nothing about the day,
                // because nothing fetches it yet — claiming otherwise is the
                // stale-glance failure (P7) the widgets refused to ship.
                Text("Connected")
                    .font(.footnote)
                    .foregroundStyle(Paper.accent)
                Text("Your day lands here next.")
                    .font(.caption2)
                    .foregroundStyle(Paper.muted)
                    .fixedSize(horizontal: false, vertical: true)
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
        .padding(.horizontal, 4)
        .containerBackground(Paper.bg.gradient, for: .navigation)
    }
}

#Preview {
    RootView().environmentObject(SessionStore())
}

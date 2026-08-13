// Ask Nuvo, on the wrist.
//
// The same agent the desk and the phone talk to — one brain, three doors. What
// the watch drops is everything the SPA draws *around* a reply: record cards,
// the staged invite, undo, the marquee. `content` is written to stand on its
// own, so a client that renders only that gets a coherent answer with no
// SPA logic (see loop.ts, which synthesises prose when the model acts silently).
//
// It runs on the Supabase access token, which lives about an hour and is
// refreshed only by the phone. That is a real limit and this screen says so
// plainly rather than failing in a way that looks like the chat is broken.

import SwiftUI

struct AskView: View {
    @EnvironmentObject private var session: SessionStore

    @State private var question = ""
    @State private var answer: String?
    @State private var error: String?
    @State private var asking = false
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if let answer {
                    Text(answer)
                        .font(.footnote)
                        .foregroundStyle(Paper.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("Ask again") {
                        self.answer = nil
                        question = ""
                        focused = true
                    }
                    .font(.caption2)
                } else if asking {
                    // No partial rendering: a half-sentence redrawing on a
                    // 45mm screen is harder to read than a moment of waiting.
                    ProgressView()
                        .frame(maxWidth: .infinity)
                    Text("Thinking…")
                        .font(.caption2)
                        .foregroundStyle(Paper.muted)
                } else {
                    TextField("Ask Nuvo…", text: $question)
                        .focused($focused)
                        .submitLabel(.send)
                        .onSubmit(ask)

                    Button(action: ask) {
                        Text("Ask").frame(maxWidth: .infinity)
                    }
                    .disabled(question.trimmingCharacters(in: .whitespaces).isEmpty)
                    .tint(Paper.accent)
                }

                if let error {
                    Text(error)
                        .font(.caption2)
                        .foregroundStyle(Paper.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle("Ask Nuvo")
        .containerBackground(Paper.bg.gradient, for: .navigation)
        .onAppear { if answer == nil && !asking { focused = true } }
    }

    private func ask() {
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, let creds = session.creds else {
            error = "Open Nuvo on your iPhone first."
            return
        }
        asking = true
        error = nil
        Task {
            do {
                let reply = try await NuvoClient(creds: creds).ask(q)
                await MainActor.run {
                    answer = reply
                    asking = false
                }
            } catch {
                await MainActor.run {
                    self.error = error.localizedDescription
                    asking = false
                }
            }
        }
    }
}

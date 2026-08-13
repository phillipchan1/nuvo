// Capture — the whole point of the wrist.
//
// One plain text field. watchOS puts dictation and Scribble behind it for free,
// which is the same reason the app uses plain `<input>`s everywhere: capture is
// organic free text parsed into structure, never a form. "call David tomorrow
// 9am 30m #work" arrives here as one string and lands structured, because
// /capture runs the same parseCapture the phone does.
//
// It writes on the durable connection token, so it works with the phone in a
// pocket and its session long expired.

import SwiftUI

struct CaptureView: View {
    @EnvironmentObject private var session: SessionStore
    @Environment(\.dismiss) private var dismiss

    @State private var text = ""
    @State private var phase: Phase = .idle
    @FocusState private var focused: Bool

    private enum Phase: Equatable {
        case idle, sending, landed(String), failed(String)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            switch phase {
            case .landed(let title):
                // Confirm what actually landed, in its own words — a capture you
                // can't verify is one you'll re-enter on the phone anyway.
                Label("In your inbox", systemImage: "checkmark.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(Paper.accent)
                Text(title)
                    .font(.caption2)
                    .foregroundStyle(Paper.muted)
                    .fixedSize(horizontal: false, vertical: true)

            case .failed(let message):
                Label("Didn't send", systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(Paper.accent)
                Text(message)
                    .font(.caption2)
                    .foregroundStyle(Paper.muted)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Try again") { phase = .idle }
                    .font(.caption2)

            default:
                TextField("Capture anything…", text: $text)
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit(send)

                Button(action: send) {
                    if phase == .sending {
                        ProgressView()
                    } else {
                        Text("Add").frame(maxWidth: .infinity)
                    }
                }
                .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || phase == .sending)
                .tint(Paper.accent)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .navigationTitle("Capture")
        .task {
            // Straight into dictation. Focusing in onAppear is too early —
            // the field isn't in the hierarchy yet and watchOS silently ignores
            // it, which is what left a menu-then-tap-then-type sequence on a
            // surface whose whole job is to be faster than remembering.
            guard case .idle = phase else { return }
            try? await Task.sleep(nanoseconds: 250_000_000)
            focused = true
        }
    }

    private func send() {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, let creds = session.creds else {
            phase = .failed("Open Nuvo on your iPhone first.")
            return
        }
        phase = .sending
        Task {
            do {
                let title = try await NuvoClient(creds: creds).capture(body)
                await MainActor.run {
                    text = ""
                    phase = .landed(title)
                }
                // Long enough to read the confirmation, short enough that the
                // wrist goes back to being a watch.
                try? await Task.sleep(nanoseconds: 1_600_000_000)
                await MainActor.run { dismiss() }
            } catch {
                await MainActor.run {
                    phase = .failed(error.localizedDescription)
                }
            }
        }
    }
}

// What the watch is allowed to ask the server, and how.
//
// Two credentials arrive from the phone and they are not interchangeable:
//
//   • connectionToken — durable, never expires, revocable from Settings →
//     Apps & devices. Authenticates /capture. This is what makes capture work
//     on a wrist whose phone has been in a pocket all day.
//   • accessToken — a Supabase session token, good for about an hour. Reaches
//     the agent and /day. The watch NEVER refreshes it: rotation plus reuse
//     detection would revoke the whole token family and sign the user out on
//     their phone. When it is stale, say so — don't retry it into a sign-out.

import Foundation

enum NuvoClientError: LocalizedError {
    case notSignedIn
    case sessionExpired
    case http(Int, String)
    case empty

    var errorDescription: String? {
        switch self {
        case .notSignedIn: return "Open Nuvo on your iPhone first."
        case .sessionExpired: return "Open Nuvo on your iPhone to refresh."
        case .http(let code, let msg): return msg.isEmpty ? "Failed (\(code))" : msg
        case .empty: return "No reply."
        }
    }
}

struct NuvoClient {
    let creds: Creds

    private func request(_ path: String, bearer: String, method: String = "POST") -> URLRequest? {
        guard let url = URL(string: creds.url + path) else { return nil }
        var r = URLRequest(url: url)
        r.httpMethod = method
        r.setValue(creds.anonKey, forHTTPHeaderField: "apikey")
        r.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // A wrist is not a place to wait. Fail early enough to say so.
        r.timeoutInterval = 20
        return r
    }

    /// Free text in, task out. Goes through /capture rather than the agent: it
    /// is deterministic, needs no model round-trip, and runs on the durable
    /// token — so it works when the access token is long expired.
    func capture(_ text: String) async throws -> String {
        guard let token = creds.connectionToken, !token.isEmpty else {
            // No durable token yet. The phone mints one on its next launch.
            throw NuvoClientError.notSignedIn
        }
        guard var r = request("/functions/v1/capture", bearer: token) else {
            throw NuvoClientError.notSignedIn
        }
        // `text` is the free-text field the server parses with the same
        // parseCapture the app uses — "call David tomorrow 9am 30m" lands
        // structured, from the wrist, with no forms.
        r.httpBody = try JSONSerialization.data(withJSONObject: [
            "text": text,
            "source": "apple_watch",
            "tz": TimeZone.current.identifier,
        ])

        let (data, response) = try await URLSession.shared.data(for: r)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            if code == 401 { throw NuvoClientError.notSignedIn }
            throw NuvoClientError.http(code, message(from: data))
        }
        let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        return (obj?["title"] as? String) ?? text
    }

    /// Ask Nuvo. The endpoint streams SSE; the watch has nothing to do with a
    /// partial answer on a screen this size, so the stream is consumed to
    /// completion and the final prose is shown.
    ///
    /// Everything the SPA renders around a reply — record cards, the invite
    /// card, undo, the marquee — is deliberately ignored. `content` is written
    /// to stand alone: when the model acts without speaking, the edge function
    /// synthesises prose from what it did.
    func ask(_ question: String) async throws -> String {
        guard let token = creds.accessToken, !token.isEmpty else {
            throw NuvoClientError.sessionExpired
        }
        guard var r = request("/functions/v1/agent", bearer: token) else {
            throw NuvoClientError.sessionExpired
        }
        r.timeoutInterval = 45 // a turn can take tool rounds
        let now = Date()
        let iso = ISO8601DateFormatter()
        r.httpBody = try JSONSerialization.data(withJSONObject: [
            "messages": [["role": "user", "content": question]],
            "rangeStart": iso.string(from: now.addingTimeInterval(-86_400)),
            "rangeEnd": iso.string(from: now.addingTimeInterval(7 * 86_400)),
            "tz": TimeZone.current.identifier,
            // No surface to point at, so point_at has no vocabulary and becomes
            // a no-op rather than a tool the model can waste a round on.
            "marqueeTargets": [],
        ])

        let (bytes, response) = try await URLSession.shared.bytes(for: r)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            if code == 401 { throw NuvoClientError.sessionExpired }
            throw NuvoClientError.http(code, "")
        }

        var streamed = ""
        var final: String?
        for try await line in bytes.lines {
            guard line.hasPrefix("data: ") else { continue }
            let payload = String(line.dropFirst(6))
            guard let d = payload.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any]
            else { continue }

            switch obj["t"] as? String {
            case "c": streamed += (obj["v"] as? String) ?? ""
            case "d": final = obj["content"] as? String
            case "e": throw NuvoClientError.http(500, (obj["msg"] as? String) ?? "")
            default: break
            }
        }

        let answer = (final?.isEmpty == false ? final! : streamed)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !answer.isEmpty else { throw NuvoClientError.empty }
        return answer
    }

    private func message(from data: Data) -> String {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return "" }
        return (obj["error"] as? String) ?? ""
    }
}

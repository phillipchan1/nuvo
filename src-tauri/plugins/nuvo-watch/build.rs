// Commands exposed to JS as `plugin:nuvo-watch|<name>`. `ios_path` is what
// makes cargo compile ios/ as a SwiftPM package and link it into libapp.a.
const COMMANDS: &[&str] = &["push_session", "clear_session", "watch_status"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}

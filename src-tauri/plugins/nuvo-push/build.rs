// Exposed to JS as `plugin:nuvo-push|register`.
const COMMANDS: &[&str] = &["register"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}

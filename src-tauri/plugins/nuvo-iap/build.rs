const COMMANDS: &[&str] = &["products", "purchase", "restore", "manage_subscriptions"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}

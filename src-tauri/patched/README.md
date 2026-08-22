# Patched GTK3 / glib (RUSTSEC-2024-0429)

Tauri 2's Linux webview (`wry` → `webkit2gtk` 2.0 + `gtk` 0.18) cannot take
crates.io `glib` 0.20. `gtk` 0.18 requires `glib ^0.18`; gtk3-rs is unmaintained
and will not publish a 0.20 line. Dependabot therefore reports
`security_update_not_possible` (latest resolvable 0.18.5; lowest patched 0.20.0).

What this directory is:

- `glib/` — gtk-rs-core **0.18.5** plus the upstream `VariantStrIter::impl_get`
  fix from [gtk-rs-core#1343](https://github.com/gtk-rs/gtk-rs-core/pull/1343)
  (`let mut p` / `&mut p`). Package version is **0.20.0** so `Cargo.lock`
  satisfies GHSA-wrw7-89jp-8q8g. This is not crates.io glib 0.20 (a breaking
  gtk-rs-core major).
- The other crates — the same crates.io releases Tauri 2 already locked, with
  only the `glib` requirement rewritten from `0.18` to `0.20`. `cairo-rs` also
  gets the same out-pointer mutability fix (`&data_ptr` → `&mut data_ptr` on
  `cairo_surface_get_mime_data`); rustc 1.98 treats the old form as UB and
  refuses to compile it.

Do not "upgrade" these copies to crates.io 0.20/gtk4. That is the Tauri 3
Linux rewrite. Delete this directory and the `[patch.crates-io]` block in
`Cargo.toml` when that ships.

Rebuild after changing sources: `cargo generate-lockfile` from `src-tauri/`.

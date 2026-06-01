//! Inversion-of-control hooks the `settings` crate uses to notify the rest of
//! the app when the on-disk settings file changes. Set once at startup from
//! `app::lib::run`; absent in tests (no-op).
//!
//! Keeps the crate a true leaf — `agent_core::utils::set_global_http_version_pref`
//! and similar consumers are wired in by `app::lib::run` rather than imported
//! here. Add a new hook here whenever a new subsystem needs to react to a
//! settings change instead of polling.

use std::sync::OnceLock;

/// Called every time the settings file changes on disk after the new content
/// is parsed. Receives the full settings JSON; consumers pick out the keys
/// they care about (e.g. `network.httpVersion`).
pub type OnSettingsChanged = Box<dyn Fn(&serde_json::Value) + Send + Sync>;

static ON_CHANGED: OnceLock<OnSettingsChanged> = OnceLock::new();

pub fn register_on_settings_changed(f: OnSettingsChanged) {
    if ON_CHANGED.set(f).is_err() {
        tracing::warn!("settings::hooks: on_settings_changed already registered");
    }
}

pub(crate) fn on_settings_changed(value: &serde_json::Value) {
    if let Some(f) = ON_CHANGED.get() {
        f(value);
    }
}

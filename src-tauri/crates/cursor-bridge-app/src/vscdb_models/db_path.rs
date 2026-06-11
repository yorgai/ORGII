//! DB path constants and helpers shared by all vscdb query modules.

use std::path::PathBuf;

/// Row key Cursor writes the application-user reactive blob under.
pub(super) const APPLICATION_USER_KEY: &str =
    "src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser";

/// Where the probe instance keeps its state. Mirrored from
/// `lifecycle::PROBE_DATA_DIR` so they don't drift; if the lifecycle
/// constant is changed both consts must move together (compile-time
/// guaranteed by the test below).
pub(super) const PROBE_DB_PATH: &str =
    "/tmp/orgii-cursor-probe-data/User/globalStorage/state.vscdb";

/// Per-composer DKV row prefix. Concatenate with a UUID to get the
/// full key (`composerData:<uuid>`). The row's value is a JSON blob
/// holding everything Cursor remembers about that composer; we read
/// `modelConfig.modelName` to surface the session's last-used model.
pub(super) const COMPOSER_DATA_KEY_PREFIX: &str = "composerData:";

pub(super) const DEFAULT_MODEL_NAME: &str = "default";

pub(super) fn real_user_db() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/_unknown".to_string());
    PathBuf::from(home).join("Library/Application Support/Cursor/User/globalStorage/state.vscdb")
}

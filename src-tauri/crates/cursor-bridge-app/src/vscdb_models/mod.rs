//! Offline-fallback reader for Cursor's available-model list.
//!
//! When the probe Cursor isn't running we still want the model picker
//! to show *something* — the user just opened our app, the picker
//! shouldn't be blank for the 5–10 s it takes the probe to spawn.
//!
//! Cursor mirrors its `applicationUserPersistentStorage` reactive
//! cell (which holds `availableDefaultModels2`) to a JSON blob in
//! `state.vscdb`'s `ItemTable` under a single canonical key. Reading
//! that blob is a synchronous SQLite SELECT; no Cursor process needed.
//!
//! ## What we read
//!
//! | Source | Key |
//! | ----- | ----- |
//! | Probe DB (preferred — same instance as the live CDP path) | `/tmp/orgii-cursor-probe-data/User/globalStorage/state.vscdb` |
//! | User's real Cursor (fallback — when the probe hasn't been seeded yet) | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` |
//!
//! Both locations use the *same* row key:
//! `src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser`
//!
//! That blob's `availableDefaultModels2` field is the same array
//! `modelConfigService.getAvailableDefaultModels()` reads at runtime,
//! minus the entitlement filtering. So this path can return *more*
//! models than the live one (e.g. `op-4.6-relay`, `kimi-k2.5`,
//! `claude-opus-4-7` show up here even when the user's plan doesn't
//! include them). The frontend deduplicates by `name`.
//!
//! ## Why we don't write
//!
//! Writing to Cursor's persistent storage from outside its process
//! would race against Cursor's own reactive flush. We strictly read
//! here and use the live CDP path (`set_model_for_composer`) for
//! mutations.
//!
//! ## Module layout
//!
//! - `db_path` — DB path constants and the `real_user_db()` helper.
//! - `model_catalog` — Read and project the available-model catalog.
//! - `model_toggles` — User show/hide toggles and the global default
//!   composer model.
//! - `composer` — Per-composer queries: model, timestamp, unified mode.

pub mod composer;
mod db_path;
pub mod model_catalog;
pub mod model_toggles;

pub use composer::{
    read_composer_last_updated_at, read_composer_model_from_disk,
    read_composer_unified_mode_from_disk,
};
pub use model_catalog::{has_model_catalog, read_models_from_disk};
pub use model_toggles::{
    apply_model_toggles, read_global_default_composer_model_from_disk,
    read_model_toggles_from_disk, ModelToggles,
};

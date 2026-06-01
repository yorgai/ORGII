//! Agent configuration types.
//!
//! Each sub-module owns one coherent config concern:
//!
//! - `databases`   — database connection entries
//! - `reliability` — retry / fallback chain config
//!
//! App-level cross-agent sub-types (exec / web-search / nodes / plugins,
//! `ExecutionMode`, `EmbeddingConfig`) live on
//! [`crate::integrations::config`]. The per-agent L3 learnings
//! policy (`AgentLearningsConfig`) lives on
//! [`crate::core::definitions::schema`]. Vision/image
//! support is determined at runtime from the model name; there is no
//! separate `image` config sub-module.

mod databases;
mod reliability;

// `databases` is private, so its type aliases (`DatabaseConnectionEntry`,
// `DatabaseProviderType`) are not reachable from outside this module —
// nobody references them by name today, callers only ever name
// `DatabasesConfig`.
pub use databases::DatabasesConfig;
pub use reliability::ReliabilityConfig;

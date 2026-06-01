//! Code search commands split into focused submodules.

pub mod cache;
pub mod helpers;
pub mod symbol_search;
pub mod text_search;
pub mod types;

pub use cache::*;
pub use helpers::*;
pub use symbol_search::*;
pub use text_search::*;
pub use types::*;

#[cfg(test)]
#[path = "../tests/commands_cache_tests.rs"]
mod cache_tests;

#[cfg(test)]
#[path = "../tests/commands_fast_search_tests.rs"]
mod fast_search_tests;

//! Provider-facing alias for the canonical UTF-8 safe truncation helper.
//!
//! The implementation lives in [`crate::utils::safe_truncate`] (the crate-wide
//! home for this util). This module re-exports it so the many existing provider
//! call sites that import `crate::providers::safe_truncate::safe_truncate_utf8`
//! keep resolving. New call sites should prefer `crate::utils::safe_truncate_utf8`.

pub use crate::utils::safe_truncate::safe_truncate_utf8;

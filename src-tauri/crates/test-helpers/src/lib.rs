//! Workspace-wide test helpers.
//!
//! Currently exposes only [`test_env`] — the canonical sandbox guard for
//! tests that mutate `ORGII_HOME` / `HOME`. Hoisted from
//! `app::test_utils::test_env` so leaf workspace crates can depend on the
//! sandbox without depending on the monolithic `app` crate.
//!
//! See `test_env`'s module docs for the full rationale.

pub mod test_env;

//! Connection Re-export
//!
//! Re-exports `get_connection` from the `database` workspace crate so
//! `session_persistence::*` consumers don't need their own `database`
//! crate dependency. New code should import directly from
//! `database::db::get_connection`.

pub use database::db::get_connection;

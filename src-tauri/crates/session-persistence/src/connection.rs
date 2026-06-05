//! Connection Re-export
//!
//! Re-exports `get_connection` and the writer-serialization helpers from
//! the `database` workspace crate so `session_persistence::*` consumers
//! don't need their own `database` crate dependency. New code should
//! import directly from `database::db::*`.

pub use database::db::{begin_immediate, get_connection, with_sessions_writer};

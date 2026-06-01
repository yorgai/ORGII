//! Prost-generated types for Cursor's `agent.v1` Connect/gRPC schema.
//!
//! Source: `src-tauri/proto/cursor_agent_v1.descriptor.pb` (a `FileDescriptorSet`
//! extracted from opencode-cursor's bufbuild-generated TypeScript). The
//! descriptor is compiled into this module at build time by `build.rs` via
//! `prost_build::Config::compile_fds`. To refresh the schema, replace the
//! descriptor file and rebuild — the Rust types track whatever Cursor ships.

#![allow(clippy::all)]
#![allow(rustdoc::invalid_html_tags)]

pub mod agent_v1 {
    include!(concat!(env!("OUT_DIR"), "/agent.v1.rs"));
}

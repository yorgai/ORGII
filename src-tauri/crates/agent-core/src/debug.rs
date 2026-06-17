//! Curated `#[doc(hidden)]` re-exports for `app/api/agent/test/*` debug
//! routes.
//!
//! ## Why this module exists
//!
//! When `agent_core` was extracted into its own workspace crate, the
//! `app` crate's debug HTTP endpoints (`/test/*` Axum routes) needed to
//! keep poking at internals — last-assistant-text helpers, builtin-agent
//! recovery counters, work-item-launch parsers, cursor-style parser, the
//! `resolve_agent_mode` invariant probe, etc. The straightforward fix at
//! extraction time was to promote those `pub(crate)` items to `pub`,
//! which leaks debug-only surface into the crate's public API.
//!
//! ## What goes here vs what doesn't
//!
//! Three categories of debug-route reach-throughs:
//!
//! 1. **Re-exported here** — items that exist *only* to support the
//!    test routes (e.g. `subagent_type_label`, `resolve_agent_id_for_execute`,
//!    the `ResolvedAgentId` struct). These are `#[doc(hidden)] pub use`
//!    here AND `#[doc(hidden)] pub` at their definition. Test routes
//!    should import them from `agent_core::debug::*`.
//!
//! 2. **`#[doc(hidden)] pub` at home, no shim here** — items where the
//!    canonical path is already meaningful and stable (e.g.
//!    `tool_infra::debug_parse_work_item_launch_sources` is named
//!    `debug_*` and gated on `#[cfg(debug_assertions)]`;
//!    `state::commands::desktop::debug_parse_*` likewise). The
//!    `#[doc(hidden)]` marker hides them from rustdoc; the existing
//!    canonical path stays.
//!
//! 3. **Genuine public surface, no shim, no `#[doc(hidden)]`** — items
//!    used by non-debug callers too (e.g. `core::session::wingman`,
//!    `core::session::prompt::builder`, `core::session::turn`,
//!    `specialization::mcp::config::insert_server_config`,
//!    `core::turn_executor::helpers`). The test routes share these with
//!    production callers; they stay normal public API.
//!
//! Why `#[doc(hidden)]` on the definitions, even when re-exported
//! through this module: Rust does not allow a `pub` re-export of a
//! `pub(crate)` item, so once a debug-only item is reachable from
//! outside the home module it must be `pub`. The `#[doc(hidden)]`
//! attribute is the contract: not part of agent_core's documented
//! public API, even though it is technically `pub` for the
//! workspace-internal call site. Rustdoc and downstream consumers do
//! not see it.
//!
//! ## Future-hardening
//!
//! When this crate ships standalone (e.g. published to crates.io for
//! the GPLv3 release), wrap this module in `#[cfg(feature =
//! "debug-routes")]` and tighten every `#[doc(hidden)] pub` definition
//! to `pub(crate)` (or `pub(crate)` behind the same feature). The rest
//! of the crate compiles fine without it.
//!
//! ## Discipline
//!
//! - Do NOT add re-exports here that aren't used by `app/api/agent/test/*`
//!   today; if a new debug route needs something, add the re-export in
//!   the same commit that adds the call site.
//! - Do NOT promote items to `pub` in their home modules just to satisfy
//!   a debug route — route imports go through this module (category 1)
//!   or through an existing `debug_*`-named, `cfg(debug_assertions)`-gated
//!   helper (category 2).
//! - Keep `#[doc(hidden)]` on the underlying items in categories 1 and
//!   2 — that is the single signal that says "this is not part of the
//!   public API."

#![allow(missing_docs)]

// --- Session turn helpers ---------------------------------------------------

#[doc(hidden)]
pub use crate::core::session::turn::background_reminder;
#[doc(hidden)]
pub use crate::core::session::turn::turn_max_iterations_from_session_model;
#[cfg(debug_assertions)]
#[doc(hidden)]
pub use crate::core::session::turn::{
    debug_prefetch_zero_wait_probe, debug_prompt_cache_benchmark,
};

// --- Session recovery counters ---------------------------------------------

#[doc(hidden)]
pub use crate::core::session::recovery;

// `core::session::prompt` and `core::session::wingman` are genuine
// public surfaces. Test routes can import them directly via the
// `agent_core::session::*` re-exports — no shimming needed here.

// `core::turn_executor::helpers` is genuine internal-leaf-public — the
// `last_assistant_text` symbol is already re-exported at
// `turn_executor::last_assistant_text` for the test routes; no debug
// shim needed here.

// `foundation::tool_infra::debug_parse_work_item_launch_sources` is
// already named `debug_*`, gated on `#[cfg(debug_assertions)]`, and
// marked `#[doc(hidden)]` at its definition. The test route reaches it
// at its existing path; no shim here.

// --- Orchestration agent helpers (subagent id parsing, spawn rejection) ----

#[doc(hidden)]
pub use crate::core::tools::impls::orchestration::agent::{
    looks_like_valid_subagent_session_id, org_roster_spawn_rejection, resolve_agent_id_for_execute,
    subagent_of_subagent_rejection, subagent_type_label, ResolvedAgentId,
};

// --- Tauri command bodies invoked directly by debug routes -----------------

#[doc(hidden)]
pub use crate::state::commands::channel_handler::ensure_gateway_infra;
#[cfg(debug_assertions)]
#[doc(hidden)]
pub use crate::state::commands::desktop::debug_parse_desktop_config;
#[doc(hidden)]
pub use crate::state::commands::session::message::resolve_agent_mode;

// `specialization::mcp::config::insert_server_config` is genuine
// public-within-crate (used by smithery/hub/bar registries). Already
// reached at its canonical path; no debug shim needed.

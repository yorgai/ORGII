//! Plan-mode tool — `create_plan` writes the session plan file AND submits
//! it for user review in a single step (broadcasts
//! `agent:plan_ready_for_approval`, ends the turn). The tool is gated by the
//! Plan-mode policy allow-list so it's only visible when the session is in
//! Plan mode.

pub mod create_plan;

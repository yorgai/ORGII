//! Cursor Dashboard API client for fetching token usage.
//!
//! The Cursor CLI does not report token usage in its stdout. To get accurate
//! usage data, we query the Cursor Dashboard API after a session completes.
//!
//! ## API
//!
//! - `POST https://cursor.com/api/dashboard/get-filtered-usage-events`
//! - Auth: `Cookie: WorkosCursorSessionToken={session_token}`
//! - Body: `{ "startDate": ms, "endDate": ms, "page": 1, "pageSize": 100 }`
//!
//! ## Token format
//!
//! Session tokens come in two forms:
//! 1. `{userId}%3A%3A{jwtToken}` — from Cursor auth flow
//! 2. Raw JWT token — from local DB extraction
//!
//! The client tries the primary format first, then falls back to the alternative.

pub mod tracker;

pub use tracker::fetch_cursor_usage;
pub use tracker::CursorUsageSummary;

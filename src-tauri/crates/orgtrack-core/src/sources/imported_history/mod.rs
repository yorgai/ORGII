pub mod cache;
pub mod metadata;

use chrono::TimeZone;

pub const IMPORTED_STATUS_COMPLETED: &str = "completed";

pub fn epoch_ms_to_iso(ms: i64) -> String {
    chrono::Utc
        .timestamp_millis_opt(ms)
        .single()
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339()
}

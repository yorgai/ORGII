//! Append-only telemetry log for the sync subsystem.
//!
//! Every push / pull / webhook / import / conflict-resolve operation
//! records a single [`SyncMetric`] line into
//! `~/.orgii/sync-metrics.jsonl`. The file rotates to
//! `~/.orgii/sync-metrics.jsonl.1` once it crosses
//! [`MAX_LOG_BYTES`]; anything older than the previous rotation is
//! discarded. The goal is a recent-window for support triage, not
//! long-term observability — rotation drops history aggressively on
//! purpose.
//!
//! # Why JSON-Lines
//!
//! - Append-only fits the workload (each metric is a single short
//!   record; no need to mutate prior lines).
//! - Trivially `tail -f`-able and `jq`-pipeable from a terminal,
//!   which is the primary support-triage workflow.
//! - Survives malformed lines gracefully — a corrupt line breaks
//!   only that line's parse, not the whole file.
//!
//! # Concurrency
//!
//! All writes go through a process-wide [`std::sync::Mutex`]
//! ([`WRITER_LOCK`]). A short critical section that does a single
//! file open + write + drop avoids inter-process contention with
//! external readers (`tail -f` works fine because the OS does not
//! treat the lock as advisory across processes).
//!
//! # Cost
//!
//! ~1µs per record on warm path. Designed to be cheap enough that
//! every push/pull adds telemetry unconditionally — there is no
//! sampling and no opt-out.
//!
//! # No string literals for kind / outcome
//!
//! [`MetricKind`] and [`MetricOutcome`] are typed enums with
//! `as_db_str` / `from_db_str` round-trip helpers. JSON serialization
//! goes through serde's `rename_all = "snake_case"` so wire values
//! (and grep targets) match the enum variants 1:1.

use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tracing::warn;

use app_paths as paths;

/// Rotation threshold. The file is renamed to `.1` and a fresh one
/// is opened the next time a write would push past this boundary.
///
/// 10MB ≈ 60-100k records depending on slug/error-message lengths;
/// at the assumed worker tick rate this covers ~24-48 hours of live
/// sync activity for a single project, more for users with idle
/// projects.
pub const MAX_LOG_BYTES: u64 = 10 * 1024 * 1024;

/// What the metric describes. The kind drives downstream UI grouping
/// (e.g. webhook-vs-poll latency comparisons; conflict-rate signals).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetricKind {
    /// One outbox row was dispatched to an adapter's `push`.
    Push,
    /// One project's pull cycle ran (poll-driven).
    Pull,
    /// One adapter `handle_webhook` call ran (push-driven).
    Webhook,
    /// One bulk-import page was fetched + applied.
    Import,
    /// One conflict row was resolved (use-local / use-remote / dismiss).
    ConflictResolve,
}

impl MetricKind {
    pub fn as_wire(self) -> &'static str {
        match self {
            MetricKind::Push => "push",
            MetricKind::Pull => "pull",
            MetricKind::Webhook => "webhook",
            MetricKind::Import => "import",
            MetricKind::ConflictResolve => "conflict_resolve",
        }
    }
}

/// Outcome of the operation. Distinct from `Ok/Err` because some
/// "success" cases carry a no-op signal that's useful for SLO math
/// (e.g. a pull cycle returning 0 changes is success-but-empty, not
/// a failure).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetricOutcome {
    /// Happy path — at least one effect applied.
    Ok,
    /// Happy path — operation completed but produced no effect (e.g.
    /// pull cycle observed no changes).
    Empty,
    /// Transient failure (will retry).
    Transient,
    /// Permanent failure (abandoned / surfaced to UI).
    Permanent,
    /// Auth failure (credential rejected by remote).
    Auth,
    /// Rate-limited by remote.
    RateLimited,
    /// Operation was cancelled (user clicked cancel / shutdown).
    Cancelled,
    /// Operation was intentionally bypassed (e.g. pull cycle skipped
    /// because the project's webhook delivery is still fresh — see
    /// [`super::worker::WEBHOOK_FRESHNESS_WINDOW_MS`]).
    Skipped,
}

impl MetricOutcome {
    pub fn as_wire(self) -> &'static str {
        match self {
            MetricOutcome::Ok => "ok",
            MetricOutcome::Empty => "empty",
            MetricOutcome::Transient => "transient",
            MetricOutcome::Permanent => "permanent",
            MetricOutcome::Auth => "auth",
            MetricOutcome::RateLimited => "rate_limited",
            MetricOutcome::Cancelled => "cancelled",
            MetricOutcome::Skipped => "skipped",
        }
    }

    /// Map a `SyncError` to its corresponding metric outcome. Keeping
    /// the mapping in one place avoids divergence between worker push
    /// and worker pull instrumentation.
    pub fn from_sync_error(err: &super::types::SyncError) -> Self {
        use super::types::SyncError;
        match err {
            SyncError::Transient(_) => MetricOutcome::Transient,
            SyncError::Permanent(_) => MetricOutcome::Permanent,
            SyncError::AuthFailed(_) => MetricOutcome::Auth,
            SyncError::RateLimited { .. } => MetricOutcome::RateLimited,
        }
    }
}

/// One telemetry record.
///
/// All fields are pre-serialized to wire form (snake_case). Optional
/// fields are emitted only when present so the JSONL line stays
/// compact — a typical push record is ~150 bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncMetric {
    /// RFC 3339 with millisecond precision; sortable lexicographically.
    pub ts: String,
    /// Project slug the record is scoped to.
    pub slug: String,
    /// Adapter id (`"linear"`, `"github_issues"`, `"echo"`, …).
    pub adapter_id: String,
    pub kind: MetricKind,
    pub outcome: MetricOutcome,
    /// End-to-end duration in milliseconds.
    pub duration_ms: u64,
    /// Outbox op for push records, change count for pull/webhook,
    /// imported-row count for import. Always emitted; semantics depend
    /// on `kind`.
    pub count: u64,
    /// Free-form one-liner. For permanent / transient outcomes this
    /// carries the error message truncated to ~200 chars; otherwise
    /// it's omitted.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub note: Option<String>,
}

impl SyncMetric {
    /// Build a metric capturing the current UTC instant.
    pub fn now(
        slug: impl Into<String>,
        adapter_id: impl Into<String>,
        kind: MetricKind,
        outcome: MetricOutcome,
        duration_ms: u64,
        count: u64,
    ) -> Self {
        Self {
            ts: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            slug: slug.into(),
            adapter_id: adapter_id.into(),
            kind,
            outcome,
            duration_ms,
            count,
            note: None,
        }
    }

    /// Builder-style: attach a free-form note (truncated to ~200 chars
    /// to keep individual lines bounded).
    pub fn with_note(mut self, note: impl Into<String>) -> Self {
        let mut text = note.into();
        if text.chars().count() > 200 {
            text = text.chars().take(200).collect::<String>() + "…";
        }
        self.note = Some(text);
        self
    }
}

/// Process-wide writer lock. Held only across the open + write +
/// rotation check (which is one stat call + at most one rename).
static WRITER_LOCK: Mutex<()> = Mutex::new(());

/// Append one metric line. Errors are logged and swallowed — telemetry
/// is best-effort and **must never** propagate failure into a sync
/// operation's result.
///
/// Cost: one syscall plus one optional rename per [`MAX_LOG_BYTES`]
/// boundary crossing.
pub fn append(metric: &SyncMetric) {
    let line = match serde_json::to_string(metric) {
        Ok(json) => json,
        Err(err) => {
            warn!("[sync::metrics] serialize failed: {}", err);
            return;
        }
    };

    let _guard = match WRITER_LOCK.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let path = paths::sync_metrics_log();
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            if let Err(err) = std::fs::create_dir_all(parent) {
                warn!(
                    "[sync::metrics] create parent {} failed: {}",
                    parent.display(),
                    err
                );
                return;
            }
        }
    }

    if let Err(err) = maybe_rotate(&path) {
        warn!("[sync::metrics] rotate failed: {}", err);
    }

    let mut file = match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(file) => file,
        Err(err) => {
            warn!("[sync::metrics] open {} failed: {}", path.display(), err);
            return;
        }
    };

    if let Err(err) = writeln!(file, "{}", line) {
        warn!("[sync::metrics] write failed: {}", err);
    }
}

/// Convenience: build a `SyncMetric` and append it in one call.
///
/// Equivalent to `append(&SyncMetric::now(...))` but slightly cheaper
/// because it avoids cloning the strings into a builder if the call
/// site already has owned strings.
pub fn record(
    slug: impl Into<String>,
    adapter_id: impl Into<String>,
    kind: MetricKind,
    outcome: MetricOutcome,
    duration_ms: u64,
    count: u64,
) {
    append(&SyncMetric::now(
        slug,
        adapter_id,
        kind,
        outcome,
        duration_ms,
        count,
    ));
}

/// Convenience for failure paths that want to attach an error string.
pub fn record_with_note(
    slug: impl Into<String>,
    adapter_id: impl Into<String>,
    kind: MetricKind,
    outcome: MetricOutcome,
    duration_ms: u64,
    count: u64,
    note: impl Into<String>,
) {
    append(&SyncMetric::now(slug, adapter_id, kind, outcome, duration_ms, count).with_note(note));
}

/// Rotate the active log to `.1` if it has grown past
/// [`MAX_LOG_BYTES`]. The previous `.1` is overwritten — only one
/// generation of history is kept.
fn maybe_rotate(active: &std::path::Path) -> std::io::Result<()> {
    let metadata = match std::fs::metadata(active) {
        Ok(meta) => meta,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(err),
    };
    if metadata.len() < MAX_LOG_BYTES {
        return Ok(());
    }
    let backup = paths::sync_metrics_log_backup();
    // `rename` is atomic on the same volume; the active file disappears
    // and the next `OpenOptions::create(true)` creates a fresh one.
    std::fs::rename(active, backup)
}

/// Read up to `limit` most-recent lines from the live + backup logs,
/// newest first. Used by the dev-only metrics-tail command and unit
/// tests; production code never reads telemetry, only writes it.
///
/// Lines that fail to parse as `SyncMetric` are skipped silently.
pub fn tail(limit: usize) -> Vec<SyncMetric> {
    if limit == 0 {
        return Vec::new();
    }

    let mut lines: Vec<String> = Vec::new();

    // Read backup first (older), then live (newer); reverse-iterate to
    // pick the newest `limit` lines after concatenation.
    // For both files, only warn when the file exists but is
    // unreadable (Rule 6) — `path.exists()` already ruled out the
    // benign "no log yet" case. A silently empty metrics view here
    // would mask a permission flip / disk-full situation that the
    // sync UI would otherwise blame on "no recent syncs".
    let backup_path = paths::sync_metrics_log_backup();
    if backup_path.exists() {
        match std::fs::read_to_string(&backup_path) {
            Ok(text) => lines.extend(text.lines().map(|s| s.to_string())),
            Err(err) => tracing::warn!(
                path = %backup_path.display(),
                error = %err,
                "sync::metrics: backup log read failed; metrics view will be missing this slice"
            ),
        }
    }

    let live_path = paths::sync_metrics_log();
    if live_path.exists() {
        match std::fs::read_to_string(&live_path) {
            Ok(text) => lines.extend(text.lines().map(|s| s.to_string())),
            Err(err) => tracing::warn!(
                path = %live_path.display(),
                error = %err,
                "sync::metrics: live log read failed; metrics view will be missing this slice"
            ),
        }
    }

    // Per-line corruption is intentionally tolerated (a partial
    // write must not block the rest of the log), but we count
    // skipped lines so a noisy log surfaces in metrics. We don't
    // warn per-line — that would flood the log on a torn JSONL.
    let take_from = lines.len().saturating_sub(limit);
    let slice = &lines[take_from..];
    let mut parsed: Vec<SyncMetric> = Vec::new();
    let mut skipped = 0usize;
    for line in slice.iter().rev() {
        match serde_json::from_str::<SyncMetric>(line) {
            Ok(m) => parsed.push(m),
            Err(_) => skipped += 1,
        }
    }
    if skipped > 0 {
        tracing::warn!(
            skipped,
            window = slice.len(),
            "sync::metrics: skipped {} corrupt JSONL lines in metrics window of {}",
            skipped,
            slice.len()
        );
    }
    parsed
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    /// Per-test isolated ORGII_HOME so concurrent tests don't smash each
    /// other's metrics file. Wraps the env-var dance in a guard that
    /// restores the previous value on drop.
    struct OrgiiHomeGuard {
        previous: Option<String>,
        _lock: std::sync::MutexGuard<'static, ()>,
    }

    impl OrgiiHomeGuard {
        fn new(path: &std::path::Path) -> Self {
            // Serialize ORGII_HOME mutations across tests in this module.
            static ENV_LOCK: StdMutex<()> = StdMutex::new(());
            let lock = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
            let previous = std::env::var("ORGII_HOME").ok();
            // SAFETY: tests are single-threaded inside the guard.
            unsafe { std::env::set_var("ORGII_HOME", path) };
            Self {
                previous,
                _lock: lock,
            }
        }
    }

    impl Drop for OrgiiHomeGuard {
        fn drop(&mut self) {
            match &self.previous {
                Some(value) => unsafe { std::env::set_var("ORGII_HOME", value) },
                None => unsafe { std::env::remove_var("ORGII_HOME") },
            }
        }
    }

    #[test]
    fn append_and_tail_round_trip() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let _guard = OrgiiHomeGuard::new(tmp.path());

        record("p1", "echo", MetricKind::Push, MetricOutcome::Ok, 12, 1);
        record("p1", "echo", MetricKind::Pull, MetricOutcome::Empty, 4, 0);

        let recent = tail(10);
        assert_eq!(recent.len(), 2);
        // Newest first.
        assert!(matches!(recent[0].kind, MetricKind::Pull));
        assert!(matches!(recent[1].kind, MetricKind::Push));
    }

    #[test]
    fn rotation_moves_live_to_backup_when_over_threshold() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let _guard = OrgiiHomeGuard::new(tmp.path());

        // Pre-seed the live file just over the threshold so the next
        // append triggers rotation. Don't write 10MB of zeroes — just
        // truncate-set the length.
        let live = paths::sync_metrics_log();
        std::fs::create_dir_all(live.parent().unwrap()).unwrap();
        let file = std::fs::File::create(&live).unwrap();
        file.set_len(MAX_LOG_BYTES + 1).unwrap();
        drop(file);

        record("p1", "echo", MetricKind::Push, MetricOutcome::Ok, 1, 1);

        let backup = paths::sync_metrics_log_backup();
        assert!(backup.exists(), "backup must exist after rotation");
        let live_after = std::fs::metadata(&live).unwrap();
        assert!(
            live_after.len() < MAX_LOG_BYTES,
            "live file must be fresh after rotation, got {} bytes",
            live_after.len()
        );
    }

    #[test]
    fn note_truncation_keeps_lines_bounded() {
        let huge = "x".repeat(1000);
        let metric = SyncMetric::now(
            "p1",
            "echo",
            MetricKind::Push,
            MetricOutcome::Permanent,
            10,
            1,
        )
        .with_note(huge);
        let note = metric.note.expect("note set");
        assert!(note.chars().count() <= 201, "got {}", note.chars().count());
        assert!(note.ends_with('…'));
    }

    #[test]
    fn outcome_and_kind_wire_strings_are_stable() {
        // Pin the snake_case wire values; downstream tooling (jq
        // pipelines, conflict-rate UI) reads these literals.
        assert_eq!(MetricKind::Push.as_wire(), "push");
        assert_eq!(MetricKind::ConflictResolve.as_wire(), "conflict_resolve");
        assert_eq!(MetricOutcome::Ok.as_wire(), "ok");
        assert_eq!(MetricOutcome::RateLimited.as_wire(), "rate_limited");
    }
}

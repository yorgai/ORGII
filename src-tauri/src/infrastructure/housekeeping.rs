//! Deferred disk cleanup orchestrator.
//!
//! Centralises background retention so all "forgetful" subsystems run from
//! one place instead of each spawning its own startup task. A single
//! slow-ops pass, run 10 minutes after boot, walks the long tail of
//! ~/.orgii/ and drops anything older than its retention window.
//!
//! Currently handles:
//! - File-history TTL prune (30 days, mtime-based, with DB sync)
//! - File-history per-session cap enforcement (100 manifests)
//! - Log file TTL prune (30 days, mtime-based)
//! - Partial stream recovery file TTL prune (1 day, mtime-based)
//! - Browser automation screenshot TTL prune (7 days, mtime-based)
//! - Plan-mode plan file TTL prune (30 days, mtime-based, recursive)
//! - Merkle snapshot TTL prune (30 days, mtime-based — stale snapshots
//!   auto-rebuild on next access)
//! - Orphan `cursor-config/<session_id>/` and `gemini-cli-home/<session_id>/`
//!   eviction (session no longer present in `agent_sessions` DB)
//! - Orphan `agent-worktrees/<repo_hash>/<session_id>/` eviction (session
//!   no longer present in `agent_sessions` DB)
//! - Orphan `session-images/<hash>.{ext}` eviction (hash no longer
//!   referenced by any message's `images` column)
//! - Orphan `gateway_bindings` row prune (target session no longer
//!   present in `agent_sessions`)
//! - Session-cache TTL prune (`sessions` + `events` for rows older than
//!   30 days)
//!
//! Intentionally out of scope:
//! - `learnings` / `consolidation_runs` — knowledge artefacts that
//!   outlive sessions by design. `delete_session` nulls
//!   `learnings.source_session_id` to prevent dangling references but
//!   the rows themselves are retained forever.

mod housekeeping_orphans;
mod housekeeping_ttl;
use housekeeping_orphans::*;
use housekeeping_ttl::*;

use agent_core::tools::file_history;
use app_paths as paths;

/// Retention window for rotated frontend/backend log files. Matches the
/// `file-history` TTL so disk-age policy is uniform across the data dir.
pub const LOG_TTL_DAYS: u64 = 30;

/// Retention window for partial-stream recovery files in `~/.orgii/partials/`.
///
/// Partials are written mid-stream so an in-progress assistant turn can
/// recover after a crash. Once the turn lands (or the user moves on), the
/// corresponding file becomes dead weight. Anything older than a day is
/// effectively abandoned.
pub const PARTIALS_TTL_DAYS: u64 = 1;

/// Retention window for browser-automation screenshots in
/// `~/.orgii/screenshots/`. Shorter than the file-history window because
/// screenshots are purely diagnostic — they are never consulted after
/// the tool round they belong to has landed in the event log.
pub const SCREENSHOTS_TTL_DAYS: u64 = 7;

/// Retention window for Plan-mode plan markdown under
/// `~/.orgii/plans/<agent_id>/*.plan.md`. Plans are per-session scratchpads
/// that get consumed (promoted into session state) within minutes; aging
/// out anything older than `agent_messages` TTL is safe.
pub const PLANS_TTL_DAYS: u64 = 30;

/// Retention window for Merkle snapshots in `~/.orgii/merkle/*.json`.
/// Snapshots are regenerated on demand — pruning stale ones forces a
/// fresh rebuild on next access and reclaims disk without risking
/// data loss.
pub const MERKLE_TTL_DAYS: u64 = 30;

/// Retention window for the `sessions` + `events` cache TTL. Mirrors the
/// file-history window so a single age threshold governs both disk and
/// database tails of the same session.
pub const SESSION_CACHE_TTL_DAYS: u64 = 30;

/// Delay before the first deferred cleanup pass kicks in. Matches Claude
/// Code's `DELAYED_STARTUP_MS` so we don't compete with app boot I/O.
pub const DEFERRED_CLEANUP_DELAY_SECS: u64 = 10 * 60;

/// Aggregate stats across every subsystem touched in a single
/// [`run_deferred_cleanup`] pass.
#[derive(Debug, Clone, Default)]
pub struct HousekeepingStats {
    pub file_history: file_history::TtlPruneStats,
    pub log_files_removed: usize,
    /// Sessions that had at least one orphan manifest evicted (i.e. count
    /// exceeded `MAX_SNAPSHOTS_PER_SESSION`).
    pub sessions_capped: usize,
    /// Total manifests evicted across all capped sessions.
    pub manifests_capped: usize,
    /// Total backup blobs GC'd during cap enforcement.
    pub blobs_capped: usize,
    /// Files removed from `~/.orgii/partials/` via TTL sweep.
    pub partials_removed: usize,
    /// Per-session directories removed from `~/.orgii/cursor-config/` because
    /// their owning session was no longer present in `agent_sessions`.
    pub cursor_configs_evicted: usize,
    /// Per-session directories removed from `~/.orgii/gemini-cli-home/`
    /// because their owning session was no longer present in
    /// `agent_sessions`.
    pub gemini_homes_evicted: usize,
    /// Screenshot files removed from `~/.orgii/screenshots/` via TTL sweep.
    pub screenshots_removed: usize,
    /// Plan markdown files removed recursively under `~/.orgii/plans/` via
    /// TTL sweep.
    pub plans_removed: usize,
    /// Merkle snapshot files removed from `~/.orgii/merkle/` via TTL sweep.
    pub merkle_snapshots_removed: usize,
    /// Per-session worktree dirs removed from `~/.orgii/agent-worktrees/`
    /// because their owning session was no longer present in
    /// `agent_sessions`.
    pub agent_worktrees_evicted: usize,
    /// Session-image files deleted from `~/.orgii/session-images/` because
    /// no surviving message row still referenced their filename.
    pub session_images_evicted: usize,
    /// Gateway-binding DB rows deleted because `target_session_id` no
    /// longer exists in `agent_sessions`.
    pub gateway_bindings_evicted: usize,
    /// Session-cache rows evicted from `sessions`/`events` via TTL sweep.
    pub session_cache_rows_evicted: i64,
}

/// Run all registered background retention passes in sequence. Each step
/// logs its own errors; this function never panics and never propagates
/// failures — housekeeping is strictly best-effort.
///
/// Intended to be called from a background tokio task 10 minutes after
/// startup (see `DEFERRED_CLEANUP_DELAY_SECS`).
pub fn run_deferred_cleanup() -> HousekeepingStats {
    let mut stats = HousekeepingStats::default();
    tracing::info!("[housekeeping] deferred cleanup pass started");

    // Step 1: file-history TTL (30d) — drops entire session dirs + DB rows.
    match file_history::prune_old_file_history(file_history::DEFAULT_FILE_HISTORY_TTL_DAYS) {
        Ok(s) => stats.file_history = s,
        Err(err) => tracing::warn!("[housekeeping] file-history TTL prune failed: {}", err),
    }

    // Step 2: per-session manifest cap on everything that survived TTL.
    // Cheap: just counts rows and skips sessions already under cap.
    match cap_all_surviving_sessions() {
        Ok((sessions, manifests, blobs)) => {
            stats.sessions_capped = sessions;
            stats.manifests_capped = manifests;
            stats.blobs_capped = blobs;
        }
        Err(err) => tracing::warn!("[housekeeping] session cap sweep failed: {}", err),
    }

    // Step 3: log files older than LOG_TTL_DAYS.
    match prune_old_log_files(LOG_TTL_DAYS) {
        Ok(n) => stats.log_files_removed = n,
        Err(err) => tracing::warn!("[housekeeping] log file prune failed: {}", err),
    }

    // Step 4: partial-stream recovery files older than PARTIALS_TTL_DAYS.
    match prune_old_files_in_dir(paths::partials_dir(), PARTIALS_TTL_DAYS) {
        Ok(n) => stats.partials_removed = n,
        Err(err) => tracing::warn!("[housekeeping] partials prune failed: {}", err),
    }

    // Step 5: orphan per-session dirs whose owning session is no longer in
    // `agent_sessions` (e.g. session row was hard-deleted while the process
    // was down, or startup cleanup missed it).
    match list_known_session_ids() {
        Ok(known) => {
            match evict_orphan_session_dirs(paths::cursor_config_root(), &known) {
                Ok(n) => stats.cursor_configs_evicted = n,
                Err(err) => {
                    tracing::warn!("[housekeeping] cursor-config orphan sweep failed: {}", err)
                }
            }
            match evict_orphan_session_dirs(paths::gemini_cli_home_root(), &known) {
                Ok(n) => stats.gemini_homes_evicted = n,
                Err(err) => tracing::warn!(
                    "[housekeeping] gemini-cli-home orphan sweep failed: {}",
                    err
                ),
            }
            match evict_orphan_agent_worktrees(paths::agent_worktrees_root(), &known) {
                Ok(n) => stats.agent_worktrees_evicted = n,
                Err(err) => tracing::warn!(
                    "[housekeeping] agent-worktrees orphan sweep failed: {}",
                    err
                ),
            }
            match evict_orphan_gateway_bindings(&known) {
                Ok(n) => stats.gateway_bindings_evicted = n,
                Err(err) => tracing::warn!(
                    "[housekeeping] gateway_bindings orphan sweep failed: {}",
                    err
                ),
            }
        }
        Err(err) => {
            tracing::warn!(
                "[housekeeping] could not read agent_sessions for orphan sweep: {}; skipping",
                err
            );
        }
    }

    // Step 6: screenshots TTL — diagnostic-only files, aged aggressively.
    match prune_old_files_in_dir(paths::screenshots_dir(), SCREENSHOTS_TTL_DAYS) {
        Ok(n) => stats.screenshots_removed = n,
        Err(err) => tracing::warn!("[housekeeping] screenshots prune failed: {}", err),
    }

    // Step 7: Plan-mode plan markdown TTL (recursive — nested per-agent dirs).
    match prune_old_files_recursive(paths::orgii_root().join("plans"), PLANS_TTL_DAYS) {
        Ok(n) => stats.plans_removed = n,
        Err(err) => tracing::warn!("[housekeeping] plans prune failed: {}", err),
    }

    // Step 8: Merkle snapshot TTL — pruned snapshots auto-rebuild on next access.
    match prune_old_files_in_dir(paths::merkle_root(), MERKLE_TTL_DAYS) {
        Ok(n) => stats.merkle_snapshots_removed = n,
        Err(err) => tracing::warn!("[housekeeping] merkle prune failed: {}", err),
    }

    // Step 9: session-image orphan eviction — files whose filename no
    // longer appears in any surviving message's `images` JSON array.
    match evict_orphan_session_images() {
        Ok(n) => stats.session_images_evicted = n,
        Err(err) => tracing::warn!("[housekeeping] session-images orphan sweep failed: {}", err),
    }

    // Step 10: session-cache TTL — drops `sessions`/`events` rows older
    // than SESSION_CACHE_TTL_DAYS. `agent_snapshots` is cascaded by
    // `clear_old_sessions` as a side-effect.
    match session_persistence::clear_old_sessions(
        (SESSION_CACHE_TTL_DAYS as i64).saturating_mul(24),
    ) {
        Ok(n) => stats.session_cache_rows_evicted = n,
        Err(err) => tracing::warn!("[housekeeping] session-cache TTL prune failed: {}", err),
    }

    tracing::info!(
        "[housekeeping] pass finished: file_history(sessions={}, rows={}), capped(sessions={}, manifests={}, blobs={}), logs_removed={}, partials_removed={}, cursor_configs_evicted={}, gemini_homes_evicted={}, agent_worktrees_evicted={}, screenshots_removed={}, plans_removed={}, merkle_snapshots_removed={}, session_images_evicted={}, gateway_bindings_evicted={}, session_cache_rows_evicted={}",
        stats.file_history.sessions_removed,
        stats.file_history.db_rows_removed,
        stats.sessions_capped,
        stats.manifests_capped,
        stats.blobs_capped,
        stats.log_files_removed,
        stats.partials_removed,
        stats.cursor_configs_evicted,
        stats.gemini_homes_evicted,
        stats.agent_worktrees_evicted,
        stats.screenshots_removed,
        stats.plans_removed,
        stats.merkle_snapshots_removed,
        stats.session_images_evicted,
        stats.gateway_bindings_evicted,
        stats.session_cache_rows_evicted,
    );

    stats
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::test_env;
    use std::path::Path;
    use std::time::{Duration, SystemTime};

    /// Test-only mtime helper (not compiled into release builds).
    fn set_mtime_days_ago(path: &Path, days: u64) -> std::io::Result<()> {
        use std::fs::File;
        let target = SystemTime::now()
            .checked_sub(Duration::from_secs(days.saturating_mul(86_400)))
            .unwrap_or(SystemTime::UNIX_EPOCH);
        let file = File::options().write(true).open(path)?;
        file.set_modified(target)?;
        drop(file);
        Ok(())
    }

    fn with_sandbox<F: FnOnce(&Path)>(test: F) {
        let guard = test_env::sandbox();
        test(guard.path());
    }

    #[test]
    fn prune_old_log_files_removes_only_aged_entries() {
        with_sandbox(|_| {
            let dir = paths::logs_dir();
            std::fs::create_dir_all(&dir).unwrap();

            let fresh = dir.join("frontend.log.fresh");
            let aged = dir.join("frontend.log.aged");
            std::fs::write(&fresh, b"fresh").unwrap();
            std::fs::write(&aged, b"aged").unwrap();

            // Age the second file 60 days back.
            set_mtime_days_ago(&aged, 60).unwrap();

            let removed = prune_old_log_files(30).unwrap();
            assert_eq!(removed, 1);
            assert!(fresh.exists());
            assert!(!aged.exists());
        });
    }

    #[test]
    fn prune_old_log_files_handles_missing_dir() {
        with_sandbox(|_| {
            // No logs_dir created.
            let removed = prune_old_log_files(30).unwrap();
            assert_eq!(removed, 0);
        });
    }

    #[test]
    fn prune_old_files_recursive_drops_nested_aged_files_and_empty_dirs() {
        with_sandbox(|_| {
            let plans = paths::orgii_root().join("plans");
            let agent_a = plans.join("agent-a");
            let agent_b = plans.join("agent-b");
            std::fs::create_dir_all(&agent_a).unwrap();
            std::fs::create_dir_all(&agent_b).unwrap();

            let fresh = agent_a.join("keep.plan.md");
            let aged_nested = agent_a.join("drop.plan.md");
            let aged_only = agent_b.join("lone-old.plan.md");
            std::fs::write(&fresh, b"keep").unwrap();
            std::fs::write(&aged_nested, b"drop").unwrap();
            std::fs::write(&aged_only, b"drop").unwrap();
            set_mtime_days_ago(&aged_nested, 60).unwrap();
            set_mtime_days_ago(&aged_only, 60).unwrap();

            let removed = prune_old_files_recursive(plans.clone(), 30).unwrap();
            assert_eq!(removed, 2, "exactly two aged files should be removed");
            assert!(fresh.exists(), "fresh file must survive");
            assert!(!aged_nested.exists(), "aged nested file must be gone");
            assert!(!aged_only.exists(), "aged lone file must be gone");
            assert!(agent_a.exists(), "agent-a dir has a surviving file, stays");
            assert!(!agent_b.exists(), "agent-b is now empty and must be pruned");
        });
    }

    #[test]
    fn evict_orphan_agent_worktrees_prunes_only_unknown_sids() {
        with_sandbox(|_| {
            let root = paths::agent_worktrees_root();
            let repo = root.join("abc123");
            let live_sid = "agent-live-sid";
            let dead_sid = "agent-dead-sid";
            std::fs::create_dir_all(repo.join(live_sid).join("sub")).unwrap();
            std::fs::create_dir_all(repo.join(dead_sid).join("sub")).unwrap();
            std::fs::write(repo.join(live_sid).join("marker"), b"live").unwrap();
            std::fs::write(repo.join(dead_sid).join("marker"), b"dead").unwrap();

            let mut known = std::collections::HashSet::new();
            known.insert(live_sid.to_string());

            let removed = evict_orphan_agent_worktrees(root.clone(), &known).unwrap();
            assert_eq!(removed, 1);
            assert!(repo.join(live_sid).exists(), "live session worktree kept");
            assert!(
                !repo.join(dead_sid).exists(),
                "dead session worktree evicted"
            );
            assert!(
                repo.exists(),
                "repo-hash parent kept even when a child is evicted"
            );
        });
    }

    #[test]
    fn evict_orphan_gateway_bindings_drops_unknown_targets() {
        with_sandbox(|_| {
            // Bring up the unified agent_sessions schema (includes the
            // `session_type` column required by the INSERT below) and
            // create the gateway_bindings table directly — in production
            // both are created by their respective init hooks on boot;
            // here we inline only what the test needs.
            agent_core::foundation::persistence::session_snapshots::ensure_tables().unwrap();
            let conn = session_persistence::get_connection().unwrap();
            agent_core::core::session::persistence::init(&conn).unwrap();
            conn.execute(
                "CREATE TABLE IF NOT EXISTS gateway_bindings (
                    session_key        TEXT PRIMARY KEY,
                    target_session_id  TEXT NOT NULL,
                    updated_at         TEXT NOT NULL,
                    last_activity_at   TEXT
                )",
                [],
            )
            .unwrap();
            let now = chrono::Utc::now().to_rfc3339();

            conn.execute(
                "INSERT INTO agent_sessions (session_id, session_type, created_at, updated_at)
                 VALUES (?1, 'os', ?2, ?2)",
                rusqlite::params!["sid-live", now],
            )
            .unwrap();

            conn.execute(
                "INSERT INTO gateway_bindings (session_key, target_session_id, updated_at, last_activity_at)
                 VALUES ('telegram:1', 'sid-live', ?1, ?1),
                        ('telegram:2', 'sid-dead', ?1, ?1)",
                rusqlite::params![now],
            )
            .unwrap();

            let known = list_known_session_ids().unwrap();
            let removed = evict_orphan_gateway_bindings(&known).unwrap();
            assert_eq!(removed, 1);

            let remaining: Vec<String> = conn
                .prepare("SELECT session_key FROM gateway_bindings ORDER BY session_key")
                .unwrap()
                .query_map([], |row| row.get::<_, String>(0))
                .unwrap()
                .flatten()
                .collect();
            assert_eq!(remaining, vec!["telegram:1"]);
        });
    }

    #[test]
    fn evict_orphan_session_images_removes_unreferenced_files() {
        with_sandbox(|_| {
            agent_core::foundation::persistence::session_snapshots::ensure_tables().unwrap();
            let dir = paths::session_images_dir();
            std::fs::create_dir_all(&dir).unwrap();
            let referenced = dir.join("live-hash.png");
            let orphan = dir.join("dead-hash.png");
            std::fs::write(&referenced, b"live").unwrap();
            std::fs::write(&orphan, b"dead").unwrap();

            // Seed one message row referencing only `live-hash.png`.
            let conn = session_persistence::get_connection().unwrap();
            let now = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO agent_messages (id, session_id, role, content, sequence, created_at, images)
                 VALUES ('msg-1', 'sid-x', 'user', 'hi', 0, ?1, ?2)",
                rusqlite::params![
                    now,
                    serde_json::json!([referenced.to_string_lossy().to_string()]).to_string()
                ],
            )
            .unwrap();

            let removed = evict_orphan_session_images().unwrap();
            assert_eq!(removed, 1);
            assert!(referenced.exists(), "referenced image kept");
            assert!(!orphan.exists(), "orphan image deleted");
        });
    }
}

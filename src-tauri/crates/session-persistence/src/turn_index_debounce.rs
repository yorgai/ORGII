//! Coalescing debouncer for `rebuild_turn_index`.
//!
//! `save_events` historically called `rebuild_turn_index` synchronously
//! at the tail of every batch. For a single human-driven session that
//! cost is unmeasurable, but the streaming agent pipeline (parent +
//! N subagents) issues hundreds of `save_events` per second, each
//! pulling the writer mutex twice in quick succession (events INSERT,
//! then index DELETE+INSERT). Worse, every rebuild re-runs
//! `normalize_session_sequences` (per-row UPDATEs) over the full event
//! tail, multiplying writer-lock work.
//!
//! The index is **eventually consistent** by design: `load_turn_index`
//! calls `ensure_turn_index_fresh`, which compares
//! `indexed_event_count` / `indexed_max_sequence` against the live
//! `events` table and rebuilds lazily. Dropping the synchronous rebuild
//! from the hot path is therefore safe — any reader will catch up.
//!
//! To keep the index reasonably fresh for background consumers (and to
//! cap worst-case rebuild cost on the next read), we additionally
//! schedule a coalesced background rebuild per session ID. Multiple
//! `save_events` calls within `DEBOUNCE_DELAY` collapse to a single
//! rebuild.
//!
//! The debouncer holds *no* state across rebuild runs other than the
//! "scheduled" flag; a fresh task is spawned each time a debounced
//! interval elapses, so a stuck rebuild can never permanently lock out
//! future scheduling.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// Quiet period before a coalesced rebuild fires. Tuned to the
/// human-perceptible "did the turn list update?" budget: a few hundred
/// ms is invisible in the UI, and 250ms is short enough that even
/// long-running tool calls (which stream events at sub-second cadence)
/// fold into one rebuild between turns.
const DEBOUNCE_DELAY: Duration = Duration::from_millis(250);

struct ScheduledState {
    /// Sessions with a rebuild task in-flight. The task drains itself
    /// from the map after acquiring the writer lock so a coalesced
    /// follow-up gets re-scheduled rather than dropped.
    scheduled: HashMap<String, ScheduledEntry>,
}

struct ScheduledEntry {
    /// Bumped every time `schedule()` is called. The in-flight worker
    /// thread reads this value after its sleep window and re-runs the
    /// sleep+check loop if it changed, so a fresh `schedule()` during
    /// the quiet period extends the debounce rather than spawning a
    /// second thread.
    generation: u64,
    /// `true` while a worker thread is sleeping or rebuilding for this
    /// session. Prevents per-call thread spawn storms under streaming
    /// agent load — at most one OS thread per session is alive at a
    /// time regardless of `schedule()` call rate.
    worker_running: bool,
}

static SCHEDULED: OnceLock<Mutex<ScheduledState>> = OnceLock::new();

fn scheduled_state() -> &'static Mutex<ScheduledState> {
    SCHEDULED.get_or_init(|| {
        Mutex::new(ScheduledState {
            scheduled: HashMap::new(),
        })
    })
}

/// Schedule a background `rebuild_turn_index` for `session_id`.
///
/// Multiple calls within [`DEBOUNCE_DELAY`] collapse into a single
/// rebuild. Failures are logged and dropped — the index is recomputed
/// from `events` on next read via `ensure_turn_index_fresh`, so a
/// dropped background rebuild does not cause data loss.
pub fn schedule(session_id: &str) {
    let session_owned = session_id.to_string();

    // Atomically bump the generation and decide whether *we* need to
    // spawn a worker thread (vs. piggy-backing on an existing one).
    let needs_worker = {
        let mut state = match scheduled_state().lock() {
            Ok(guard) => guard,
            // Poisoned mutex: another thread panicked while holding it.
            // The state itself is just a scheduling cache, so recovering
            // and continuing is strictly better than propagating the
            // panic into the writer hot path.
            Err(poisoned) => poisoned.into_inner(),
        };
        let entry = state
            .scheduled
            .entry(session_owned.clone())
            .or_insert(ScheduledEntry {
                generation: 0,
                worker_running: false,
            });
        entry.generation = entry.generation.saturating_add(1);
        if entry.worker_running {
            // Existing worker will observe the new generation after
            // its current sleep window and loop again.
            false
        } else {
            entry.worker_running = true;
            true
        }
    };

    if !needs_worker {
        return;
    }

    let session_for_task = session_owned.clone();
    let spawn_result = std::thread::Builder::new()
        .name(format!("turn-index-debounce-{session_for_task}"))
        .spawn(move || debounce_worker(session_for_task));

    // If thread spawn failed (OS thread limit hit) clear the in-flight
    // flag so the next `schedule()` call can try again; otherwise we'd
    // wedge this session's debouncer forever.
    if let Err(err) = spawn_result {
        tracing::warn!("[turn-index-debounce] failed to spawn worker for {session_owned}: {err}");
        let mut state = match scheduled_state().lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(entry) = state.scheduled.get_mut(&session_owned) {
            entry.worker_running = false;
        }
    }
}

/// Worker loop: sleep `DEBOUNCE_DELAY`, observe the generation, either
/// run the rebuild and exit or loop again if a fresh `schedule()` call
/// arrived during the quiet period.
fn debounce_worker(session: String) {
    loop {
        // Snapshot the generation we are about to "consume" by
        // sleeping; if it changes during the sleep we restart the
        // quiet period.
        let target_generation = {
            let state = match scheduled_state().lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            match state.scheduled.get(&session) {
                Some(entry) => entry.generation,
                // Spurious wake — should not happen since the
                // spawner sets `worker_running = true` before
                // spawning us, but be defensive.
                None => return,
            }
        };

        std::thread::sleep(DEBOUNCE_DELAY);

        let action = {
            let mut state = match scheduled_state().lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            match state.scheduled.get_mut(&session) {
                Some(entry) if entry.generation == target_generation => {
                    // Quiet period elapsed — clear the slot and run
                    // the rebuild outside the state lock.
                    state.scheduled.remove(&session);
                    Action::Rebuild
                }
                Some(_) => {
                    // Newer schedule() during the sleep — extend the
                    // debounce by looping.
                    Action::Reloop
                }
                // Entry vanished (shouldn't happen while we are the
                // only writer-running task for this session, but stay
                // defensive).
                None => Action::Stop,
            }
        };

        match action {
            Action::Rebuild => {
                if let Err(err) = super::turn_index::rebuild_turn_index(&session) {
                    // Read-time rebuild will recover; just log.
                    tracing::warn!("[turn-index-debounce] rebuild failed for {session}: {err}");
                }
                return;
            }
            Action::Reloop => continue,
            Action::Stop => return,
        }
    }
}

enum Action {
    Rebuild,
    Reloop,
    Stop,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedule_does_not_panic_for_unknown_session() {
        // Smoke test only — actual rebuild path exercised by integration
        // tests in `turn_index`.
        schedule("session-that-does-not-exist");
    }
}

//! [`DrainGuard`] — deferred mark-read commit returned by
//! [`super::drain_and_render_deferred`].

use crate::coordination::agent_inbox::AgentInboxStore;
use tracing::{info, warn};

/// Pending mark-read commit returned by [`super::drain_and_render_deferred`].
///
/// The guard owns the IDs of inbox rows that were materialised into the
/// turn's in-memory `messages` vector and applied as side effects, but
/// have **not yet been marked read**. Callers must invoke [`Self::commit`]
/// only after the turn has progressed past the point where a failure
/// would cause the rendered attachment to be permanently lost (i.e.
/// the user-message has been persisted and / or the turn has succeeded).
///
/// If the guard is dropped without `commit()`, the rows stay unread and
/// will be re-drained on the next turn — strictly preferable to the
/// alternative (marking read on a turn that ultimately fails, losing
/// the messages forever). Rows are only marked read after they are
/// reliably queued.
#[must_use = "DrainGuard::commit must be called after the turn succeeds; \
              dropping without commit leaves rows unread for next turn"]
pub struct DrainGuard {
    run_id: String,
    recipient_member_id: String,
    pending_ids: Vec<i64>,
    transcript_content: Option<String>,
}

impl DrainGuard {
    pub(super) fn empty(run_id: &str, recipient_member_id: &str) -> Self {
        Self {
            run_id: run_id.to_string(),
            recipient_member_id: recipient_member_id.to_string(),
            pending_ids: Vec::new(),
            transcript_content: None,
        }
    }

    pub(super) fn drained(
        run_id: &str,
        recipient_member_id: &str,
        pending_ids: Vec<i64>,
        transcript: String,
    ) -> Self {
        Self {
            run_id: run_id.to_string(),
            recipient_member_id: recipient_member_id.to_string(),
            pending_ids,
            transcript_content: Some(transcript),
        }
    }

    pub fn transcript_content(&self) -> Option<&str> {
        self.transcript_content.as_deref()
    }

    /// Number of rows that were drained-and-rendered. `0` means there
    /// was nothing to commit and `commit()` is a no-op.
    ///
    /// Used by the test-only [`super::drain_and_render`] wrapper to report
    /// the drain count after immediate commit, and by the
    /// `drain-inbox` debug endpoint so E2E scenarios can assert how
    /// many rows the call drained without re-reading the inbox after
    /// commit. Production turn code does not consult it.
    pub fn drained_count(&self) -> usize {
        self.pending_ids.len()
    }

    /// Mark all drained rows as read. Idempotent w.r.t. partial mark
    /// failures: any row that already happens to be marked read is
    /// silently skipped by the underlying store. Failures are logged
    /// and swallowed — re-drain on the next turn is the recovery.
    pub fn commit(self) {
        if self.pending_ids.is_empty() {
            return;
        }
        match AgentInboxStore::mark_many_read(&self.pending_ids) {
            Ok(updated) => {
                info!(
                    run_id = %self.run_id,
                    member_id = %self.recipient_member_id,
                    marked = updated,
                    pending = self.pending_ids.len(),
                    "[inbox_drain] marked drained rows as read after turn success"
                );
            }
            Err(err) => {
                warn!(
                    run_id = %self.run_id,
                    member_id = %self.recipient_member_id,
                    error = %err,
                    pending = self.pending_ids.len(),
                    "[inbox_drain] mark_many_read failed; rows will be re-drained next turn"
                );
            }
        }
    }
}

//! Debug-only pump entry-point for the e2e sync scenarios.

use super::{io, push_cycle, MAX_PUSHES_PER_TICK};

/// Synchronous pump for the e2e harness. Resets `last_attempted_at`
/// to NULL for every `Pending` row owned by `slug` so the backoff
/// schedule doesn't hide them from the next claim, then drives one
/// push cycle up to the standard tick cap.
pub async fn pump_once_for_project(slug: &str) -> Result<usize, String> {
    let owned = slug.to_string();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let conn = io::conn()?;
        conn.execute(
            "UPDATE outbox_entries
                SET last_attempted_at = NULL
              WHERE project_slug = ?1
                AND status = ?2",
            rusqlite::params![
                owned,
                super::super::types::OutboxStatus::Pending.as_db_str(),
            ],
        )
        .map_err(|err| format!("DB error (debug pump reset): {}", err))?;
        Ok(())
    })
    .await
    .map_err(|err| format!("debug pump join error: {}", err))??;

    push_cycle(MAX_PUSHES_PER_TICK).await
}

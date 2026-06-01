//! Active-observation LLM provider selection.
//!
//! Mirrors `super::super::provider::get_reflection_provider` but with its
//! own log prefix. Uses the shared `reflection_blacklist` table so a single
//! per-(account, model) failure is remembered across both reflection and
//! active observation.

use tracing::{debug, info, warn};

use crate::memory::reflection::blacklist as reflection_blacklist;

#[allow(clippy::type_complexity)]
pub(super) fn get_observation_provider(
    conn: &rusqlite::Connection,
    session_model: Option<&str>,
    session_account: Option<&str>,
) -> Result<Option<(Box<dyn crate::providers::traits::LLMProvider>, String)>, String> {
    let Some(model_id) = session_model.filter(|m| !m.is_empty()) else {
        debug!(
            "[active-observation] session has no model (account={:?}) — skipping",
            session_account
        );
        return Ok(None);
    };

    if let Ok(Some(prior_error)) = reflection_blacklist::check(conn, session_account, model_id) {
        debug!(
            "[active-observation] (account={:?}, model={}) is blacklisted: {} — skipping",
            session_account, model_id, prior_error
        );
        return Ok(None);
    }

    let provider = crate::providers::factory::create_provider(
        model_id,
        session_account,
    )
    .map_err(|e| {
        let msg = format!("No provider: {}", e);
        if let Err(insert_err) = reflection_blacklist::record(conn, session_account, model_id, &msg)
        {
            warn!(
                "[active-observation] Failed to record blacklist entry for (account={:?}, model={}): {}",
                session_account, model_id, insert_err
            );
        }
        msg
    })?;
    info!(
        "[active-observation] Using model={} account={:?}",
        model_id, session_account
    );
    Ok(Some((provider, model_id.to_string())))
}

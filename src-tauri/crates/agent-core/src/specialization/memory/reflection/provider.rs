//! Reflection LLM provider selection.
//!
//! Reflection reuses the session's recorded model + account so the cost and
//! quota land where the user expects. This module owns the policy for "should
//! we even attempt reflection?" — see [`get_reflection_provider`].

use tracing::{debug, info, warn};

use super::blacklist as reflection_blacklist;

/// `(provider, account_id)` pair returned by [`get_reflection_provider`] —
/// the boxed LLM client plus the account row whose key/quota was used to
/// build it. Pulled into a type alias so the function signature stays
/// readable; clippy flags the inline form as a "very complex type."
pub(super) type ReflectionProvider = (Box<dyn crate::providers::traits::LLMProvider>, String);

/// Get a provider for reflection, reusing the session's model and account.
///
/// Returns `Ok(None)` if reflection should be silently skipped. The caller
/// is expected to treat `None` as a normal outcome, not a failure:
///
/// - `session_model` missing/empty — session has no LLM binding (e.g. OS
///   Agent or sovereign-mode session). Reflection requires an LLM call, so
///   there is nothing to reuse; we do NOT fall back to a hardcoded model
///   name because we can't know whether an account / quota for that model
///   exists, and silently substituting would either fail on every session
///   end or, worse, succeed against an unrelated account and emit noise.
/// - `(account, model)` pair is in `reflection_blacklist` — a prior call
///   for this pair failed and was recorded; do not retry until the user
///   explicitly clears the row.
pub(super) fn get_reflection_provider(
    conn: &rusqlite::Connection,
    session_model: Option<&str>,
    session_account: Option<&str>,
) -> Result<Option<ReflectionProvider>, String> {
    let Some(model_id) = session_model.filter(|m| !m.is_empty()) else {
        debug!(
            "[reflection] session has no model (account={:?}) — skipping reflection",
            session_account
        );
        return Ok(None);
    };

    if let Ok(Some(prior_error)) = reflection_blacklist::check(conn, session_account, model_id) {
        debug!(
            "[reflection] (account={:?}, model={}) is blacklisted: {} — skipping",
            session_account, model_id, prior_error
        );
        return Ok(None);
    }

    let provider =
        crate::providers::factory::create_provider(model_id, session_account).map_err(|e| {
            let msg = format!("No provider: {}", e);
            if let Err(insert_err) =
                reflection_blacklist::record(conn, session_account, model_id, &msg)
            {
                warn!(
                "[reflection] Failed to record blacklist entry for (account={:?}, model={}): {}",
                session_account, model_id, insert_err
            );
            }
            msg
        })?;
    info!(
        "[reflection] Using model={} account={:?}",
        model_id, session_account
    );
    Ok(Some((provider, model_id.to_string())))
}

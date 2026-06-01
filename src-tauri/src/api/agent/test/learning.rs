//! Dev-only learning / reflection test endpoints extracted from
//! `api/agent/mod.rs` as part of split 5/8.
//!
//! Covers:
//! - `test_learning_*` (trigger / list / deprecate / status / delete / seed /
//!   consolidate / resolve_model)
//! - `test_reflection_*` (seed_messages / transcript / blacklist)
//!
//! Only compiled in dev builds; `create_routes` in `api/agent/mod.rs` calls
//! these via `test::learning::*`.

#![cfg(debug_assertions)]

use axum::Json;
use serde::Deserialize;
use tauri::Manager;

// ============================================
// Dev-only: Learning test endpoints
// ============================================

pub async fn test_learning_reflect(
    axum::extract::Path(session_id): axum::extract::Path<String>,
) -> Json<serde_json::Value> {
    let Some(handle) = crate::api::get_app_handle() else {
        return Json(serde_json::json!({ "error": "AppHandle not initialized" }));
    };
    let state = handle.state::<agent_core::state::AgentAppState>();
    match agent_core::memory::commands::session_trigger_reflection(state, session_id.clone()).await
    {
        Ok(result) => Json(serde_json::json!({
            "ok": true,
            "session_id": result.session_id,
            "learnings_stored": result.learnings_stored,
        })),
        Err(err) => Json(serde_json::json!({ "error": err })),
    }
}

pub async fn test_learning_list(
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Json<serde_json::Value> {
    let agent_scope = params.get("agent_scope").cloned();
    match agent_core::memory::commands::session_list_learnings(agent_scope).await {
        Ok(learnings) => Json(serde_json::json!({
            "ok": true,
            "learnings": learnings,
            "count": learnings.len(),
        })),
        Err(err) => Json(serde_json::json!({ "error": err })),
    }
}

#[derive(Debug, Deserialize)]
pub struct DeprecateLearningRequest {
    learning_id: String,
}

pub async fn test_learning_deprecate(
    Json(request): Json<DeprecateLearningRequest>,
) -> Json<serde_json::Value> {
    match agent_core::memory::commands::session_deprecate_learning(request.learning_id.clone())
        .await
    {
        Ok(()) => Json(serde_json::json!({
            "ok": true,
            "learning_id": request.learning_id,
        })),
        Err(err) => Json(serde_json::json!({ "error": err })),
    }
}

pub async fn test_learnings_list_filtered(
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Json<serde_json::Value> {
    let agent_scope = params.get("agent_scope").cloned();
    let status = params.get("status").cloned();
    let source = params.get("source").cloned();
    let category = params.get("category").cloned();
    let search = params.get("search").cloned();
    let limit = params.get("limit").and_then(|s| s.parse::<u32>().ok());
    match agent_core::memory::commands::learnings_list(
        agent_scope,
        status,
        source,
        category,
        search,
        limit,
    )
    .await
    {
        Ok(list) => Json(serde_json::json!({
            "ok": true,
            "learnings": list,
            "count": list.len(),
        })),
        Err(err) => Json(serde_json::json!({ "error": err })),
    }
}

#[derive(Debug, Deserialize)]
pub struct SetStatusRequest {
    learning_id: String,
    next: String,
}

pub async fn test_learnings_set_status(
    Json(request): Json<SetStatusRequest>,
) -> Json<serde_json::Value> {
    let Some(handle) = crate::api::get_app_handle() else {
        return Json(serde_json::json!({ "error": "AppHandle not initialized" }));
    };
    let state = handle.state::<agent_core::state::AgentAppState>();
    match agent_core::memory::commands::learnings_set_status(
        state,
        request.learning_id.clone(),
        request.next.clone(),
    )
    .await
    {
        Ok(()) => Json(serde_json::json!({
            "ok": true,
            "learning_id": request.learning_id,
            "next": request.next,
        })),
        Err(err) => Json(serde_json::json!({ "error": err })),
    }
}

#[derive(Debug, Deserialize)]
pub struct DeleteLearningRequest {
    learning_id: String,
}

pub async fn test_learnings_delete(
    Json(request): Json<DeleteLearningRequest>,
) -> Json<serde_json::Value> {
    let Some(handle) = crate::api::get_app_handle() else {
        return Json(serde_json::json!({ "error": "AppHandle not initialized" }));
    };
    let state = handle.state::<agent_core::state::AgentAppState>();
    match agent_core::memory::commands::learnings_delete(state, request.learning_id.clone()).await {
        Ok(()) => Json(serde_json::json!({
            "ok": true,
            "learning_id": request.learning_id,
        })),
        Err(err) => Json(serde_json::json!({ "error": err })),
    }
}

pub async fn test_learnings_get_status(
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Json<serde_json::Value> {
    let agent_scope = params.get("agent_scope").cloned();
    match agent_core::memory::commands::learnings_get_status(agent_scope).await {
        Ok(report) => Json(serde_json::json!({
            "ok": true,
            "report": report,
        })),
        Err(err) => Json(serde_json::json!({ "error": err })),
    }
}

// ============================================
// AgentLearnings test endpoints (debug-only)
// ============================================
//
// These exist only to let the Rust e2e binary exercise the AgentLearnings
// gates without standing up a Tauri-frontend pipeline:
//   - write `learnings.{enabled, extract_memories_enabled, auto_dream_enabled}`
//     into the user's global agent-config (the same file `reflection.rs`
//     and `consolidation::entry::consolidate` resolve via
//     `definitions::resolve_learnings_for`),
//   - seed a fully-materialised learning row of any status (including
//     `merged`, which the regular Tauri command refuses to mint).
//
// Consolidation always uses the source session's recorded model; there is
// no per-agent override.

/// Body for `/test/agent-config/set`. Patches a builtin agent definition's
/// `learnings` flags via `AgentDefinitionsStore::update_with_overlay`,
/// matching the single production path `ResolvedAgent::resolve` and the
/// background helpers (`reflection`, `active_learning`, `consolidation`)
/// consume.
///
/// Parsed manually per null-vs-missing: key missing → leave unchanged, key
/// present and `null` is unused (all fields are bools).
///
/// Accepts three keys: `learnings_enabled` (mapped to
/// `AgentLearningsConfig::enabled`), `extract_memories_enabled`, and
/// `auto_dream_enabled`. `agent_id` is optional and defaults to
/// `builtin:sde`; the learning suite pins it to `builtin:os` explicitly.
pub async fn test_agent_config_set(Json(raw): Json<serde_json::Value>) -> Json<serde_json::Value> {
    use agent_core::core::definitions::AgentDefinitionsStore;

    let obj = match raw.as_object() {
        Some(o) => o,
        None => return Json(serde_json::json!({ "error": "body must be an object" })),
    };

    let target_id = obj
        .get("agent_id")
        .and_then(|v| v.as_str())
        .unwrap_or(agent_core::definitions::builtin::SDE_AGENT_ID)
        .to_string();
    let store = AgentDefinitionsStore::new();
    let updated = match store.update_with_overlay(&target_id, |def| {
        let learnings = def.learnings.get_or_insert_with(Default::default);
        if let Some(val) = obj.get("learnings_enabled") {
            if let Some(b) = val.as_bool() {
                learnings.enabled = b;
            }
        }
        if let Some(val) = obj.get("extract_memories_enabled") {
            if let Some(b) = val.as_bool() {
                learnings.extract_memories_enabled = b;
            }
        }
        if let Some(val) = obj.get("auto_dream_enabled") {
            if let Some(b) = val.as_bool() {
                learnings.auto_dream_enabled = b;
            }
        }
    }) {
        Ok(def) => def,
        Err(err) => return Json(serde_json::json!({ "error": err })),
    };

    let learnings = updated.learnings.as_ref();
    Json(serde_json::json!({
        "ok": true,
        "agent_id": target_id,
        "learnings_enabled": learnings.map(|l| l.enabled),
        "extract_memories_enabled": learnings.map(|l| l.extract_memories_enabled),
        "auto_dream_enabled": learnings.map(|l| l.auto_dream_enabled),
    }))
}

/// Debug-only teardown helper: drop any builtin overlay for the given agent
/// id, reverting it to the compiled-in definition. E2E scenarios call this
/// before/after flipping memory-search flags so test N+1 isn't poisoned by
/// the overlay test N installed.
pub async fn test_agent_config_reset(
    Json(raw): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    use agent_core::core::definitions::AgentDefinitionsStore;

    let agent_id = raw
        .get("agent_id")
        .and_then(|v| v.as_str())
        .unwrap_or(agent_core::definitions::builtin::SDE_AGENT_ID)
        .to_string();
    let store = AgentDefinitionsStore::new();
    match store.reset_builtin(&agent_id) {
        Ok(()) => Json(serde_json::json!({ "ok": true, "agent_id": agent_id })),
        Err(err) => Json(serde_json::json!({ "error": err })),
    }
}

#[derive(Debug, Deserialize)]
pub struct SeedLearningRequest {
    #[serde(default = "default_seed_scope")]
    agent_scope: String,
    content: String,
    #[serde(default)]
    takeaway: Option<String>,
    #[serde(default = "default_seed_category")]
    category: String,
    #[serde(default = "default_seed_status")]
    status: String,
    #[serde(default = "default_seed_source")]
    source: String,
    #[serde(default)]
    parent_id: Option<String>,
    #[serde(default)]
    source_session_id: Option<String>,
    #[serde(default)]
    account_id: Option<String>,
}

fn default_seed_scope() -> String {
    "e2e-seed".to_string()
}
fn default_seed_category() -> String {
    "pattern".to_string()
}
fn default_seed_status() -> String {
    "active".to_string()
}
fn default_seed_source() -> String {
    "reflection".to_string()
}

pub async fn test_learnings_seed(
    Json(request): Json<SeedLearningRequest>,
) -> Json<serde_json::Value> {
    use agent_core::memory::learnings::{
        self, EvolutionType, Learning, LearningCategory, LearningSource, LearningStatus,
    };

    // E2E seed endpoint: reject typo'd wire payloads instead of
    // silently substituting defaults. The status arm already did
    // this; align category and source to the same explicit-error
    // pattern so a typo'd seed request surfaces a 200 + JSON `error`
    // payload that the test can assert on.
    let category = match LearningCategory::parse(&request.category) {
        Some(c) => c,
        None => {
            return Json(
                serde_json::json!({ "error": format!("unknown category '{}'", request.category) }),
            );
        }
    };
    let status = match request.status.as_str() {
        "pending" => LearningStatus::Pending,
        "active" => LearningStatus::Active,
        "merged" => LearningStatus::Merged,
        "deprecated" => LearningStatus::Deprecated,
        other => {
            return Json(serde_json::json!({ "error": format!("unknown status '{}'", other) }));
        }
    };
    let source = match LearningSource::parse(&request.source) {
        Some(s) => s,
        None => {
            return Json(
                serde_json::json!({ "error": format!("unknown source '{}'", request.source) }),
            );
        }
    };

    let content_hash = Some(learnings::compute_content_hash(&request.content, category));

    let learning = Learning {
        id: String::new(),
        agent_scope: request.agent_scope.clone(),
        content: request.content.clone(),
        takeaway: request.takeaway.clone(),
        category,
        importance: 0.5,
        confidence: 0.9,
        embedding: Vec::new(),
        embedding_model: None,
        status,
        content_hash,
        reinforcement_count: 1,
        source,
        account_id: request.account_id.clone(),
        evolution_type: EvolutionType::Original,
        parent_id: request.parent_id.clone(),
        last_recalled_at: None,
        source_session_id: request.source_session_id.clone(),
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    };

    let result = tokio::task::spawn_blocking(move || {
        let conn = session_persistence::get_connection()
            .map_err(|err| format!("get_connection: {}", err))?;
        learnings::insert_learning(&conn, &learning).map_err(|err| format!("insert: {}", err))
    })
    .await
    .unwrap_or_else(|err| Err(format!("spawn_blocking: {}", err)));

    match result {
        Ok(id) => Json(serde_json::json!({
            "ok": true,
            "learning_id": id,
            "agent_scope": request.agent_scope,
            "status": request.status,
        })),
        Err(err) => Json(serde_json::json!({ "error": err })),
    }
}

#[derive(Debug, Deserialize)]
pub struct ConsolidateRequest {
    agent_scope: String,
}

pub async fn test_learnings_consolidate(
    Json(request): Json<ConsolidateRequest>,
) -> Json<serde_json::Value> {
    // `consolidate()` is !Send (holds a rusqlite::Connection across .await points).
    // Mirror the background tick: run it inside a dedicated OS thread with its
    // own current-thread tokio runtime, and bridge the result back via a
    // oneshot channel so the axum handler can stay async + Send.
    let scope = request.agent_scope.clone();
    let (tx, rx) = tokio::sync::oneshot::channel::<
        Result<agent_core::intelligence::memory::consolidation::EventCounts, String>,
    >();

    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(err) => {
                let _ = tx.send(Err(format!("runtime init: {}", err)));
                return;
            }
        };
        let result = rt.block_on(async {
            use agent_core::intelligence::memory::consolidation::{
                consolidate, ConsolidationTrigger,
            };
            consolidate(&scope, ConsolidationTrigger::Manual).await
        });
        let _ = tx.send(result);
    });

    match rx.await {
        Ok(Ok(counts)) => Json(serde_json::json!({
            "ok": true,
            "agent_scope": request.agent_scope,
            "added": counts.added,
            "updated": counts.updated,
            "deleted": counts.deleted,
            "none": counts.none,
        })),
        Ok(Err(err)) => Json(serde_json::json!({ "error": err })),
        Err(err) => Json(serde_json::json!({
            "error": format!("consolidate thread dropped: {}", err)
        })),
    }
}

// ============================================
// Reflection write-path pins (debug)
// ============================================
//
// These endpoints expose internal helpers of `memory::reflection` so
// e2e scenarios can pin the invariants documented in
// `Documentation/Agent/audit-fallbacks-0421.md`:
//
//   - Transcript hygiene — `build_transcript` must exclude tool_call /
//     tool_result rows and tail-truncate (never head-truncate per-message).
//   - Blacklist persistence — `reflection_blacklist` persists
//     `(account, model)` failures so a second reflection attempt skips
//     silently without re-calling the provider.
//
// The "transcript" endpoint is a **symbol-pinning probe** (Wiring
// Checklist Rule 16): it calls the real `reflection::build_transcript`
// rather than re-implementing the SQL, so any drift in the real helper's
// role filter / tail-cap is observable from E2E. It does NOT exercise
// the production caller (`maybe_reflect_on_session`) — that path is
// covered separately by the reflection LLM scenarios.

#[derive(Debug, Deserialize)]
pub struct SeedMessagesRequest {
    session_id: String,
    #[serde(default)]
    messages: Vec<SeedMessageRow>,
}

#[derive(Debug, Deserialize)]
pub struct SeedMessageRow {
    role: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    tool_input: Option<String>,
    #[serde(default)]
    tool_output: Option<String>,
}

/// Seed arbitrary rows into `agent_messages` for reflection e2e. Used to
/// build a transcript that mixes user/assistant/tool_call/tool_result rows
/// and assert what `build_transcript` actually returns.
pub async fn test_reflection_seed_messages(
    Json(request): Json<SeedMessagesRequest>,
) -> Json<serde_json::Value> {
    let session_id = request.session_id.clone();
    let messages = request.messages;

    let result = tokio::task::spawn_blocking(move || -> Result<usize, String> {
        let conn = session_persistence::get_connection()
            .map_err(|err| format!("get_connection: {}", err))?;

        // Ensure the parent session row exists so FK-shape queries in
        // `reflection.rs` don't fail with "Session not found". We only need
        // the columns build_transcript reads (none from agent_sessions),
        // but maybe_reflect_on_session would also look up model/account.
        conn.execute(
            "INSERT OR IGNORE INTO agent_sessions (session_id, name, status, created_at, updated_at)
             VALUES (?1, ?2, 'idle', ?3, ?3)",
            rusqlite::params![
                &session_id,
                format!("e2e-reflection-{}", session_id),
                chrono::Utc::now().to_rfc3339(),
            ],
        )
        .map_err(|err| format!("insert agent_sessions: {}", err))?;

        let mut inserted = 0usize;
        for (idx, msg) in messages.iter().enumerate() {
            let id = format!("{}-msg-{}", session_id, idx);
            conn.execute(
                "INSERT INTO agent_messages
                    (id, session_id, role, content, tool_input, tool_output, sequence, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    id,
                    &session_id,
                    &msg.role,
                    &msg.content,
                    msg.tool_input.as_deref(),
                    msg.tool_output.as_deref(),
                    idx as i64,
                    chrono::Utc::now().to_rfc3339(),
                ],
            )
            .map_err(|err| format!("insert agent_messages[{}]: {}", idx, err))?;
            inserted += 1;
        }
        Ok(inserted)
    })
    .await
    .unwrap_or_else(|err| Err(format!("spawn_blocking: {}", err)));

    match result {
        Ok(n) => Json(serde_json::json!({
            "ok": true,
            "session_id": request.session_id,
            "inserted": n,
        })),
        Err(err) => Json(serde_json::json!({ "error": err })),
    }
}

#[derive(Debug, Deserialize)]
pub struct TranscriptRequest {
    session_id: String,
}

/// Run the real `reflection::build_transcript` against the seeded
/// messages and return the string. This is a **symbol-pinning probe**
/// — not a caller-path probe: it invokes the helper directly, not via
/// `maybe_reflect_on_session`. The contract being pinned is "the
/// helper's SQL / role filter / tail-cap shape", which is enough to
/// catch silent drift, but not enough to catch wiring regressions
/// where the production reflection caller stops invoking it.
pub async fn test_reflection_transcript(
    Json(request): Json<TranscriptRequest>,
) -> Json<serde_json::Value> {
    let session_id = request.session_id.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let conn = session_persistence::get_connection()
            .map_err(|err| format!("get_connection: {}", err))?;
        agent_core::memory::reflection::build_transcript(&conn, &session_id)
    })
    .await
    .unwrap_or_else(|err| Err(format!("spawn_blocking: {}", err)));

    match result {
        Ok(transcript) => Json(serde_json::json!({
            "ok": true,
            "session_id": request.session_id,
            "transcript": transcript,
            "len": transcript.len(),
        })),
        Err(err) => Json(serde_json::json!({ "error": err })),
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum BlacklistRequest {
    Record {
        #[serde(default)]
        account_id: Option<String>,
        model_id: String,
        #[serde(default)]
        error: Option<String>,
    },
    Check {
        #[serde(default)]
        account_id: Option<String>,
        model_id: String,
    },
}

/// Record or check an `(account, model)` pair in `reflection_blacklist`.
/// Returns `{ ok, hit, error_message }` for `check`, or `{ ok: true }` for
/// `record`.
pub async fn test_reflection_blacklist(
    Json(request): Json<BlacklistRequest>,
) -> Json<serde_json::Value> {
    let result = tokio::task::spawn_blocking(move || -> Result<serde_json::Value, String> {
        use agent_core::memory::reflection::blacklist as reflection_blacklist;
        let conn = session_persistence::get_connection()
            .map_err(|err| format!("get_connection: {}", err))?;
        match request {
            BlacklistRequest::Record {
                account_id,
                model_id,
                error,
            } => {
                reflection_blacklist::record(
                    &conn,
                    account_id.as_deref(),
                    &model_id,
                    error.as_deref().unwrap_or(""),
                )
                .map_err(|err| format!("record: {}", err))?;
                Ok(serde_json::json!({ "ok": true, "action": "record" }))
            }
            BlacklistRequest::Check {
                account_id,
                model_id,
            } => {
                let hit = reflection_blacklist::check(&conn, account_id.as_deref(), &model_id)
                    .map_err(|err| format!("check: {}", err))?;
                Ok(serde_json::json!({
                    "ok": true,
                    "action": "check",
                    "hit": hit.is_some(),
                    "error_message": hit,
                }))
            }
        }
    })
    .await
    .unwrap_or_else(|err| Err(format!("spawn_blocking: {}", err)));

    match result {
        Ok(payload) => Json(payload),
        Err(err) => Json(serde_json::json!({ "error": err })),
    }
}

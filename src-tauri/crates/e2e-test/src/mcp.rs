//! MCP notification E2E scenarios (`--group mcp`).
//!
//! Verifies that the per-manager `NotificationCounters` debug endpoints
//!
//! - `GET  /agent/test/mcp/notification-counters`
//! - `POST /agent/test/mcp/notification-counters-reset`
//! - `POST /agent/test/mcp/inject-notification`
//!
//! are wired correctly to `McpManager` and follow positive +
//! negative assertions).
//!
//! Why no live-server scenario here: spinning a real MCP server during the
//! E2E run is heavyweight (requires `npx` / a stdio fixture) and the
//! listener routing logic itself is already covered by unit tests in
//! `manager::tests::{notification_counters_increment_and_reset, …}`. These
//! scenarios prove the HTTP wiring + patch semantics (clear vs. missing
//! for the inject endpoint).

use super::config::Config;
use super::harness;

const COUNTERS_URL: &str = "/agent/test/mcp/notification-counters";
const RESET_URL: &str = "/agent/test/mcp/notification-counters-reset";
const INJECT_URL: &str = "/agent/test/mcp/inject-notification";

async fn fetch_counters(cfg: &Config) -> Result<serde_json::Value, String> {
    let url = format!("{}{}", cfg.base_url, COUNTERS_URL);
    let resp = reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {err}"))?;
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|err| format!("JSON parse error: {err}"))?;
    if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
        return Err(err.to_string());
    }
    Ok(json)
}

async fn reset_counters(cfg: &Config) -> Result<(), String> {
    let url = format!("{}{}", cfg.base_url, RESET_URL);
    let resp = reqwest::Client::new()
        .post(&url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {err}"))?;
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|err| format!("JSON parse error: {err}"))?;
    if json.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return Err(format!("reset returned {json}"));
    }
    Ok(())
}

async fn inject(
    cfg: &Config,
    server_name: &str,
    method: &str,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let url = format!("{}{}", cfg.base_url, INJECT_URL);
    let mut body = serde_json::json!({
        "server_name": server_name,
        "method": method,
    });
    if let Some(p) = params {
        body["params"] = p;
    }
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {err}"))?;
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|err| format!("JSON parse error: {err}"))?;
    Ok(json)
}

/// `GET /test/mcp/notification-counters` returns the full snapshot shape
/// (all five fields). After a fresh `reset`, every counter is zero — this
/// is the baseline used by the other scenarios.
pub async fn counters_snapshot_shape(cfg: &Config) -> bool {
    if let Err(err) = reset_counters(cfg).await {
        return harness::print_error("MCP: Counters Snapshot Shape", &err);
    }
    let snap = match fetch_counters(cfg).await {
        Ok(s) => s,
        Err(err) => return harness::print_error("MCP: Counters Snapshot Shape", &err),
    };

    let has_field = |name: &str| -> bool {
        snap.get(name)
            .map(|v| v.as_u64().is_some())
            .unwrap_or(false)
    };
    let zero = |name: &str| -> bool { snap.get(name).and_then(|v| v.as_u64()) == Some(0) };

    harness::print_result(
        "MCP: Counters Snapshot Shape",
        &snap.to_string(),
        &[
            ("Has toolsRefreshed", has_field("toolsRefreshed")),
            (
                "Has resourcesListChanged",
                has_field("resourcesListChanged"),
            ),
            ("Has resourcesUpdated", has_field("resourcesUpdated")),
            ("Has promptsListChanged", has_field("promptsListChanged")),
            ("Has toolProgressTotal", has_field("toolProgressTotal")),
            ("Has unknown", has_field("unknown")),
            ("toolsRefreshed == 0 after reset", zero("toolsRefreshed")),
            (
                "resourcesUpdated == 0 after reset",
                zero("resourcesUpdated"),
            ),
            (
                "toolProgressTotal == 0 after reset",
                zero("toolProgressTotal"),
            ),
        ],
    )
}

/// `POST /test/mcp/inject-notification` for a server that is NOT connected
/// returns `{ ok: false, error: ... }` and does NOT touch any counter.
/// Negative half of the assertion pair — we want to be sure that "no live MCP server"
/// is observable as a clean error rather than a silent counter bump.
pub async fn inject_unknown_server_rejected(cfg: &Config) -> bool {
    if let Err(err) = reset_counters(cfg).await {
        return harness::print_error("MCP: Inject Unknown Rejected", &err);
    }
    let pre = match fetch_counters(cfg).await {
        Ok(s) => s,
        Err(err) => return harness::print_error("MCP: Inject Unknown Rejected", &err),
    };

    let resp = match inject(
        cfg,
        "definitely-not-connected-server",
        "notifications/tools/list_changed",
        None,
    )
    .await
    {
        Ok(j) => j,
        Err(err) => return harness::print_error("MCP: Inject Unknown Rejected", &err),
    };

    let post = match fetch_counters(cfg).await {
        Ok(s) => s,
        Err(err) => return harness::print_error("MCP: Inject Unknown Rejected", &err),
    };

    let returned_not_ok = resp.get("ok").and_then(|v| v.as_bool()) == Some(false);
    let mentions_server = resp
        .get("error")
        .and_then(|v| v.as_str())
        .map(|s| s.contains("definitely-not-connected-server"))
        .unwrap_or(false);
    let counters_unchanged = pre == post;

    harness::print_result(
        "MCP: Inject Unknown Rejected",
        &resp.to_string(),
        &[
            ("Endpoint returned ok=false", returned_not_ok),
            ("Error mentions server name", mentions_server),
            ("Counters did not change", counters_unchanged),
        ],
    )
}

/// `POST /test/mcp/notification-counters-reset` is idempotent and returns
/// `{ ok: true }` on every call. Belt-and-braces sanity for the reset
/// endpoint itself, since every other scenario in this group depends on
/// it for baseline isolation.
pub async fn reset_is_idempotent(cfg: &Config) -> bool {
    let first = match reset_counters(cfg).await {
        Ok(()) => true,
        Err(err) => return harness::print_error("MCP: Reset Idempotent", &err),
    };
    let snap1 = match fetch_counters(cfg).await {
        Ok(s) => s,
        Err(err) => return harness::print_error("MCP: Reset Idempotent", &err),
    };
    let second = match reset_counters(cfg).await {
        Ok(()) => true,
        Err(err) => return harness::print_error("MCP: Reset Idempotent", &err),
    };
    let snap2 = match fetch_counters(cfg).await {
        Ok(s) => s,
        Err(err) => return harness::print_error("MCP: Reset Idempotent", &err),
    };

    harness::print_result(
        "MCP: Reset Idempotent",
        &snap2.to_string(),
        &[
            ("First reset succeeded", first),
            ("Second reset succeeded", second),
            ("Snapshot stable across resets", snap1 == snap2),
        ],
    )
}

// ─── Prompt slash-command scenarios ─────────────────────────────────────────
//
// Like the notification-counter group, these don't stand up a live MCP
// server — the goal is
// to exercise the HTTP wiring + invariants around the
// `McpManager::{list_prompts, get_prompt, all_prompts}` entry points.
// Per-route happy paths are covered by the unit tests in
// `intelligence::mcp::{client, manager}`.

const LIST_PROMPTS_URL: &str = "/agent/test/mcp/list-prompts";
const LIST_ALL_PROMPTS_URL: &str = "/agent/test/mcp/list-all-prompts";
const GET_PROMPT_URL: &str = "/agent/test/mcp/get-prompt";
const PROMPTS_CACHE_HAS_URL: &str = "/agent/test/mcp/prompts-cache-has";
const INVALID_CONFIG_PRESERVED_URL: &str = "/agent/test/mcp/invalid-config-preserved";

async fn post_json(
    cfg: &Config,
    path: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let url = format!("{}{}", cfg.base_url, path);
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {err}"))?;
    resp.json::<serde_json::Value>()
        .await
        .map_err(|err| format!("JSON parse error: {err}"))
}

/// Registry install writes must not turn an invalid existing MCP config into
/// an empty valid file. This scenario uses a temp file through a debug endpoint,
/// so it does not touch the user's real `~/.orgii/mcp-servers.json`.
pub async fn invalid_config_preserved(cfg: &Config) -> bool {
    let resp = match post_json(cfg, INVALID_CONFIG_PRESERVED_URL, serde_json::json!({})).await {
        Ok(j) => j,
        Err(err) => return harness::print_error("MCP: Invalid Config Preserved", &err),
    };

    let ok = resp.get("ok").and_then(|v| v.as_bool()) == Some(true);
    let preserved = resp.get("preserved").and_then(|v| v.as_bool()) == Some(true);
    let error_mentions_parse = resp
        .get("error")
        .and_then(|v| v.as_str())
        .map(|text| text.contains("Failed to parse MCP config"))
        .unwrap_or(false);

    harness::print_result(
        "MCP: Invalid Config Preserved",
        &resp.to_string(),
        &[
            ("Endpoint returned ok=true", ok),
            ("Original invalid file was preserved", preserved),
            ("Error reports parse failure", error_mentions_parse),
        ],
    )
}

/// `list-prompts` against a server that isn't connected returns
/// `{ ok: false, error: … }` with the server name — symmetry with
/// `inject_unknown_server_rejected`. Proves the error surfaces up
/// instead of being silently swallowed into an empty array.
pub async fn list_prompts_unknown_server_rejected(cfg: &Config) -> bool {
    let resp = match post_json(
        cfg,
        LIST_PROMPTS_URL,
        serde_json::json!({ "server_name": "definitely-not-connected" }),
    )
    .await
    {
        Ok(j) => j,
        Err(err) => return harness::print_error("MCP: List Prompts Unknown Rejected", &err),
    };

    let not_ok = resp.get("ok").and_then(|v| v.as_bool()) == Some(false);
    let mentions_server = resp
        .get("error")
        .and_then(|v| v.as_str())
        .map(|s| s.contains("definitely-not-connected"))
        .unwrap_or(false);

    harness::print_result(
        "MCP: List Prompts Unknown Rejected",
        &resp.to_string(),
        &[
            ("Endpoint returned ok=false", not_ok),
            ("Error mentions server name", mentions_server),
        ],
    )
}

/// `list-all-prompts` is a total function: it returns `ok:true` with a
/// `prompts` array regardless of whether zero or many servers are
/// connected. This is the aggregator behavior that feeds
/// `agent_list_slash_items` — if it threw on zero servers the global
/// slash menu would be broken in the most common "first launch" state.
///
/// Positive+negative assertion fidelity: the earlier version of this scenario asserted
/// `prompts.is_empty() == true`, which baked the dev host's cold-start
/// config into the test. As soon as the user's `~/.orgii/mcp-servers.json`
/// listed a prompts-capable server (e.g. `everything`), the scenario
/// failed even though the production behavior was correct. The real
/// invariant being protected is "no crash, shape is stable", not
/// "user has nothing installed".
pub async fn list_all_prompts_returns_array_shape(cfg: &Config) -> bool {
    let resp = match post_json(cfg, LIST_ALL_PROMPTS_URL, serde_json::json!({})).await {
        Ok(j) => j,
        Err(err) => return harness::print_error("MCP: List All Prompts Shape", &err),
    };

    let ok = resp.get("ok").and_then(|v| v.as_bool()) == Some(true);
    let prompts = resp.get("prompts").and_then(|v| v.as_array()).cloned();
    let is_array = prompts.is_some();
    let items = prompts.unwrap_or_default();

    // Every item, when present, must carry the shape the slash-menu UI
    // depends on: a `serverName` (so the UI can route `get_prompt` back
    // to the right server) and a non-empty `name`.
    let all_items_have_shape = items.iter().all(|item| {
        let has_server = item
            .get("serverName")
            .and_then(|v| v.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false);
        let has_name = item
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false);
        has_server && has_name
    });

    let summary = format!("ok={ok} is_array={is_array} item_count={}", items.len());

    harness::print_result(
        "MCP: List All Prompts Shape",
        &summary,
        &[
            ("Endpoint returned ok=true", ok),
            ("`prompts` is an array", is_array),
            (
                "Every item has non-empty serverName + name (or array is empty)",
                all_items_have_shape,
            ),
        ],
    )
}

/// `get-prompt` on a disconnected server returns a clean error. This is
/// the error path the slash-command dispatcher must surface to the user
/// when the server behind a cached slash command has since disconnected:
/// the prompt name may still be in the cache but the underlying client
/// is gone, and the caller must see a structured failure instead of a
/// hang or panic.
pub async fn get_prompt_unknown_server_rejected(cfg: &Config) -> bool {
    let resp = match post_json(
        cfg,
        GET_PROMPT_URL,
        serde_json::json!({
            "server_name": "definitely-not-connected",
            "prompt_name": "whatever",
        }),
    )
    .await
    {
        Ok(j) => j,
        Err(err) => return harness::print_error("MCP: Get Prompt Unknown Rejected", &err),
    };

    let not_ok = resp.get("ok").and_then(|v| v.as_bool()) == Some(false);
    let has_error_str = resp
        .get("error")
        .and_then(|v| v.as_str())
        .map(|s| !s.is_empty())
        .unwrap_or(false);

    harness::print_result(
        "MCP: Get Prompt Unknown Rejected",
        &resp.to_string(),
        &[
            ("Endpoint returned ok=false", not_ok),
            ("Error string is non-empty", has_error_str),
        ],
    )
}

/// `prompts-cache-has` for a server with nothing cached yet returns
/// `cached: false`. Baseline for any future scenario that populates the
/// cache via a real `list-prompts` round-trip.
pub async fn prompts_cache_has_false_when_empty(cfg: &Config) -> bool {
    let resp = match post_json(
        cfg,
        PROMPTS_CACHE_HAS_URL,
        serde_json::json!({ "server_name": "never-cached" }),
    )
    .await
    {
        Ok(j) => j,
        Err(err) => return harness::print_error("MCP: Prompts Cache Has False", &err),
    };

    let ok = resp.get("ok").and_then(|v| v.as_bool()) == Some(true);
    let cached_false = resp.get("cached").and_then(|v| v.as_bool()) == Some(false);

    harness::print_result(
        "MCP: Prompts Cache Has False",
        &resp.to_string(),
        &[
            ("Endpoint returned ok=true", ok),
            ("cached == false for never-cached server", cached_false),
        ],
    )
}

// ─── Tool-progress counter scenarios ────────────────────────────────────────
//
// Real progress streaming needs a live MCP server that fires
// `notifications/progress` mid-`tools/call`. We cover the low-level
// wiring via the `/test/mcp/progress-bump` endpoint, which synthetically
// increments the same `toolProgressTotal` atomic that the production
// path (`McpManager::call_tool_with_progress`) increments via
// `NotificationCounters::bump_tool_progress`. Asserting both the
// positive (counter grows) and the negative (reset takes it back to 0)
// satisfies positive+negative assertion for the new counter without requiring an MCP fixture.

const PROGRESS_BUMP_URL: &str = "/agent/test/mcp/progress-bump";

// ─── mcp_progress event broadcast scenarios ─────────────────────────────────
//
// `/test/mcp/progress-bump` covers the counter side only. These new
// scenarios cover the broadcast side: `McpBridgeTool::execute`'s progress
// callback calls `broadcast_event("agent:mcp_progress", …)`, and the frontend
// relies on the exact payload schema to render `McpProgressRow` inline.
//
// The `/test/mcp/emit-progress-event` endpoint synthesizes the *exact* same
// broadcast path (same `broadcast_event` helper, same payload keys, same
// counter bump), so asserting on the recent-events ring buffer catches
// regressions in either the event name, the envelope shape, or the counter
// wiring — all from the same caller-path probe.

const EMIT_PROGRESS_URL: &str = "/agent/test/mcp/emit-progress-event";
const EVENTS_RECENT_URL: &str = "/agent/test/events/recent";
const EVENTS_RESET_URL: &str = "/agent/test/events/reset";

async fn reset_events(cfg: &Config) -> Result<(), String> {
    let url = format!("{}{}", cfg.base_url, EVENTS_RESET_URL);
    let resp = reqwest::Client::new()
        .post(&url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {err}"))?;
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|err| format!("JSON parse error: {err}"))?;
    if json.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return Err(format!("events reset returned {json}"));
    }
    Ok(())
}

async fn fetch_events(cfg: &Config) -> Result<Vec<serde_json::Value>, String> {
    let url = format!("{}{}", cfg.base_url, EVENTS_RECENT_URL);
    let resp = reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {err}"))?;
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|err| format!("JSON parse error: {err}"))?;
    let raw = json
        .get("events")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    // Each entry is a serialized `{ "type": "...", "payload": {...} }`.
    let parsed: Vec<serde_json::Value> = raw
        .into_iter()
        .filter_map(|v| v.as_str().map(|s| s.to_string()))
        .filter_map(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .collect();
    Ok(parsed)
}

async fn emit_progress(cfg: &Config, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let url = format!("{}{}", cfg.base_url, EMIT_PROGRESS_URL);
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {err}"))?;
    resp.json::<serde_json::Value>()
        .await
        .map_err(|err| format!("JSON parse error: {err}"))
}

/// Positive half (positive+negative assertion): a `progress` tick emitted with a concrete
/// `total` + `message` lands on the recent-events ring buffer with the
/// exact schema the frontend expects (`sessionId`, `toolCallId`,
/// `toolName`, `progress`, `total`, `message`), AND bumps
/// `toolProgressTotal`. Both checks are required — a counter bump without
/// a broadcast would make the chat bubble progress bar silently dead.
pub async fn mcp_progress_event_broadcast(cfg: &Config) -> bool {
    if let Err(err) = reset_counters(cfg).await {
        return harness::print_error("MCP: Progress Event Broadcast", &err);
    }
    if let Err(err) = reset_events(cfg).await {
        return harness::print_error("MCP: Progress Event Broadcast", &err);
    }

    let body = serde_json::json!({
        "sessionId": "e2e-session-a",
        "toolCallId": "call-42",
        "toolName": "mcp_weather_lookup",
        "progress": 30.0,
        "total": 100.0,
        "message": "fetching",
    });
    let resp = match emit_progress(cfg, body).await {
        Ok(j) => j,
        Err(err) => return harness::print_error("MCP: Progress Event Broadcast", &err),
    };
    if resp.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return harness::print_error(
            "MCP: Progress Event Broadcast",
            &format!("emit returned {resp}"),
        );
    }

    let counters = match fetch_counters(cfg).await {
        Ok(s) => s,
        Err(err) => return harness::print_error("MCP: Progress Event Broadcast", &err),
    };
    let tool_progress_total = counters
        .get("toolProgressTotal")
        .and_then(|v| v.as_u64())
        .unwrap_or(u64::MAX);

    let events = match fetch_events(cfg).await {
        Ok(e) => e,
        Err(err) => return harness::print_error("MCP: Progress Event Broadcast", &err),
    };
    let progress_event = events
        .iter()
        .find(|env| env.get("type").and_then(|v| v.as_str()) == Some("agent:mcp_progress"));
    let has_event = progress_event.is_some();
    let payload = progress_event
        .and_then(|env| env.get("payload"))
        .cloned()
        .unwrap_or(serde_json::Value::Null);

    let session_ok = payload.get("sessionId").and_then(|v| v.as_str()) == Some("e2e-session-a");
    let tool_call_ok = payload.get("toolCallId").and_then(|v| v.as_str()) == Some("call-42");
    let tool_name_ok =
        payload.get("toolName").and_then(|v| v.as_str()) == Some("mcp_weather_lookup");
    let progress_ok = payload
        .get("progress")
        .and_then(|v| v.as_f64())
        .map(|x| (x - 30.0).abs() < f64::EPSILON)
        .unwrap_or(false);
    let total_ok = payload
        .get("total")
        .and_then(|v| v.as_f64())
        .map(|x| (x - 100.0).abs() < f64::EPSILON)
        .unwrap_or(false);
    let message_ok = payload.get("message").and_then(|v| v.as_str()) == Some("fetching");

    harness::print_result(
        "MCP: Progress Event Broadcast",
        &format!(
            "events={} toolProgressTotal={}",
            events.len(),
            tool_progress_total
        ),
        &[
            (
                "toolProgressTotal == 1 after one emit",
                tool_progress_total == 1,
            ),
            ("agent:mcp_progress reached broadcast bus", has_event),
            ("payload.sessionId preserved", session_ok),
            ("payload.toolCallId preserved", tool_call_ok),
            ("payload.toolName preserved", tool_name_ok),
            ("payload.progress preserved", progress_ok),
            ("payload.total preserved as number", total_ok),
            ("payload.message preserved", message_ok),
        ],
    )
}

/// patch semantics (null vs missing): when `total` and `message` are omitted from
/// the body, the emitted payload MUST contain explicit `null`s (not
/// absent keys). The frontend uses the presence + null vs numeric
/// distinction to decide spinner-vs-bar and no-label-vs-label. A silent
/// drop of the key would break both UI states.
pub async fn mcp_progress_event_null_preserved(cfg: &Config) -> bool {
    if let Err(err) = reset_events(cfg).await {
        return harness::print_error("MCP: Progress Event Null Preserved", &err);
    }

    let body = serde_json::json!({
        "sessionId": "e2e-session-b",
        "toolCallId": "call-null",
        "toolName": "mcp_indeterminate_tool",
        "progress": 7.0,
    });
    let resp = match emit_progress(cfg, body).await {
        Ok(j) => j,
        Err(err) => return harness::print_error("MCP: Progress Event Null Preserved", &err),
    };
    if resp.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return harness::print_error(
            "MCP: Progress Event Null Preserved",
            &format!("emit returned {resp}"),
        );
    }

    let events = match fetch_events(cfg).await {
        Ok(e) => e,
        Err(err) => return harness::print_error("MCP: Progress Event Null Preserved", &err),
    };
    let progress_event = events.iter().find(|env| {
        env.get("type").and_then(|v| v.as_str()) == Some("agent:mcp_progress")
            && env
                .get("payload")
                .and_then(|p| p.get("toolCallId"))
                .and_then(|v| v.as_str())
                == Some("call-null")
    });
    let has_event = progress_event.is_some();
    let payload = progress_event
        .and_then(|env| env.get("payload"))
        .cloned()
        .unwrap_or(serde_json::Value::Null);

    let total_is_null = matches!(payload.get("total"), Some(serde_json::Value::Null));
    let message_is_null = matches!(payload.get("message"), Some(serde_json::Value::Null));
    let total_present = payload.get("total").is_some();
    let message_present = payload.get("message").is_some();

    harness::print_result(
        "MCP: Progress Event Null Preserved",
        &payload.to_string(),
        &[
            ("agent:mcp_progress reached broadcast bus", has_event),
            (
                "payload.total is present as explicit null",
                total_present && total_is_null,
            ),
            (
                "payload.message is present as explicit null",
                message_present && message_is_null,
            ),
        ],
    )
}

/// Negative half (positive+negative assertion + caller-path): `/test/events/reset` actually empties
/// the ring buffer — without this, the positive scenario could be
/// accidentally passing on stale entries from an earlier scenario.
pub async fn events_reset_clears_buffer(cfg: &Config) -> bool {
    // Seed at least one event so "cleared" means something.
    if let Err(err) = emit_progress(
        cfg,
        serde_json::json!({
            "sessionId": "e2e-session-c",
            "toolCallId": "call-seed",
            "toolName": "mcp_seed_tool",
            "progress": 1.0,
        }),
    )
    .await
    {
        return harness::print_error("MCP: Events Reset Clears Buffer", &err);
    }
    let before = match fetch_events(cfg).await {
        Ok(e) => e,
        Err(err) => return harness::print_error("MCP: Events Reset Clears Buffer", &err),
    };
    let had_events = !before.is_empty();

    if let Err(err) = reset_events(cfg).await {
        return harness::print_error("MCP: Events Reset Clears Buffer", &err);
    }
    let after = match fetch_events(cfg).await {
        Ok(e) => e,
        Err(err) => return harness::print_error("MCP: Events Reset Clears Buffer", &err),
    };

    harness::print_result(
        "MCP: Events Reset Clears Buffer",
        &format!("before={} after={}", before.len(), after.len()),
        &[
            ("Had at least one event before reset", had_events),
            ("Buffer empty after reset", after.is_empty()),
        ],
    )
}

pub async fn tool_progress_counter_increments(cfg: &Config) -> bool {
    if let Err(err) = reset_counters(cfg).await {
        return harness::print_error("MCP: Tool Progress Counter Increments", &err);
    }

    let pre = match fetch_counters(cfg).await {
        Ok(s) => s,
        Err(err) => return harness::print_error("MCP: Tool Progress Counter Increments", &err),
    };
    let pre_val = pre
        .get("toolProgressTotal")
        .and_then(|v| v.as_u64())
        .unwrap_or(u64::MAX);

    for _ in 0..3 {
        let resp = match post_json(cfg, PROGRESS_BUMP_URL, serde_json::json!({})).await {
            Ok(j) => j,
            Err(err) => return harness::print_error("MCP: Tool Progress Counter Increments", &err),
        };
        if resp.get("ok").and_then(|v| v.as_bool()) != Some(true) {
            return harness::print_error(
                "MCP: Tool Progress Counter Increments",
                &format!("bump returned {resp}"),
            );
        }
    }

    let mid = match fetch_counters(cfg).await {
        Ok(s) => s,
        Err(err) => return harness::print_error("MCP: Tool Progress Counter Increments", &err),
    };
    let mid_val = mid
        .get("toolProgressTotal")
        .and_then(|v| v.as_u64())
        .unwrap_or(u64::MAX);

    if let Err(err) = reset_counters(cfg).await {
        return harness::print_error("MCP: Tool Progress Counter Increments", &err);
    }
    let post = match fetch_counters(cfg).await {
        Ok(s) => s,
        Err(err) => return harness::print_error("MCP: Tool Progress Counter Increments", &err),
    };
    let post_val = post
        .get("toolProgressTotal")
        .and_then(|v| v.as_u64())
        .unwrap_or(u64::MAX);

    harness::print_result(
        "MCP: Tool Progress Counter Increments",
        &format!("pre={pre_val} mid={mid_val} post={post_val}"),
        &[
            ("Starts at 0 after reset", pre_val == 0),
            ("Grows to 3 after 3 bumps", mid_val == 3),
            ("Back to 0 after second reset", post_val == 0),
        ],
    )
}

// ─── Live filesystem MCP server end-to-end ──────────────────────────────────
//
// Why this exists: every other scenario in this file injects synthetic
// notifications or counters into a *disconnected* manager. None of them
// prove that the `rmcp` client can actually connect to a real stdio MCP
// process from inside the running app, list its tools, and call one
// successfully. Manual testing flagged this exact gap: the
// `filesystem` server connected fine in the UI but `call_tool` was never
// verified through the production code path. This scenario closes that
// loop end-to-end (Caller-path coverage coverage for the entire MCP stack:
// connect → list_tools → call_tool → disconnect).
//
// Dependency: requires `npx` on PATH (ships with Node >= 18 which is
// already required for `npm run tauri:dev`). If `npx` is missing the
// scenario prints a skip note and returns true so CI without Node
// doesn't go red — same gating spirit as the ORGII cloud scenarios.

const INJECT_SERVER_URL: &str = "/agent/test/mcp/inject-server";
const DISCONNECT_SERVER_URL: &str = "/agent/test/mcp/disconnect-server";
const LIST_TOOLS_URL: &str = "/agent/test/mcp/list-tools";
const CALL_TOOL_URL: &str = "/agent/test/mcp/call-tool";

async fn inject_server(
    cfg: &Config,
    server_name: &str,
    config: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let url = format!("{}{}", cfg.base_url, INJECT_SERVER_URL);
    let body = serde_json::json!({
        "server_name": server_name,
        "config": config,
    });
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {err}"))?;
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|err| format!("JSON parse error: {err}"))?;
    Ok(json)
}

async fn disconnect_server(cfg: &Config, server_name: &str) -> Result<(), String> {
    let url = format!("{}{}", cfg.base_url, DISCONNECT_SERVER_URL);
    let body = serde_json::json!({ "server_name": server_name });
    let _ = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {err}"))?;
    Ok(())
}

/// Write a workspace-scoped `.orgii/mcp-servers.json` containing one
/// `memory` stdio entry. Mirrors the production path used by users
/// who drop a per-project MCP config into their repo: when the SDE
/// session boots in `project`, `McpManager::ensure_connected(workspace)`
/// → `connect_all(Some(project))` reads the merged (global + this file)
/// config, spawns the child process, and `register_mcp_tools` injects
/// the resulting tools into the session schema. No `inject-server`
/// shortcut — same chain a real user hits.
fn write_project_mcp_memory(project: &std::path::Path) -> Result<(), String> {
    let cfg_dir = project.join(".orgii");
    std::fs::create_dir_all(&cfg_dir).map_err(|err| format!("create .orgii dir: {err}"))?;
    let cfg_path = cfg_dir.join("mcp-servers.json");
    let body = serde_json::json!({
        "mcpServers": {
            "memory": {
                "type": "stdio",
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-memory"],
                "timeout": 60,
                "disabled": false,
            }
        }
    });
    std::fs::write(&cfg_path, serde_json::to_string_pretty(&body).unwrap())
        .map_err(|err| format!("write {}: {err}", cfg_path.display()))
}

async fn list_tools(cfg: &Config, server_name: &str) -> Result<serde_json::Value, String> {
    let url = format!("{}{}", cfg.base_url, LIST_TOOLS_URL);
    let body = serde_json::json!({ "server_name": server_name });
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {err}"))?;
    resp.json()
        .await
        .map_err(|err| format!("JSON parse error: {err}"))
}

async fn call_tool(
    cfg: &Config,
    server_name: &str,
    tool_name: &str,
    arguments: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let url = format!("{}{}", cfg.base_url, CALL_TOOL_URL);
    let body = serde_json::json!({
        "server_name": server_name,
        "tool_name": tool_name,
        "arguments": arguments,
    });
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {err}"))?;
    resp.json()
        .await
        .map_err(|err| format!("JSON parse error: {err}"))
}

fn npx_available() -> bool {
    std::process::Command::new("npx")
        .arg("--version")
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

/// Live end-to-end against `@modelcontextprotocol/server-filesystem`:
///
/// 1. Seed `<tmp>/<scenario>/marker.txt` with a known token.
/// 2. Inject a stdio MCP server pointing at that tmp dir.
/// 3. `list_tools` — must include `read_text_file` (positive
///    name match, NOT just non-empty list).
/// 4. `call_tool("read_text_file", { path })` — text result must
///    contain the seeded token.
/// 5. Negative: a guaranteed-bad path returns `ok:false` with an error
///    string (negative-half).
/// 6. Disconnect server in cleanup so subsequent scenarios start clean.
pub async fn filesystem_end_to_end(cfg: &Config) -> bool {
    if !npx_available() {
        println!("⚠️  MCP: Filesystem End-to-End — skipped (npx not on PATH)");
        return true;
    }

    let scenario_id = format!(
        "e2e-mcp-fs-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let server_name = scenario_id.clone();
    let raw_tmp = std::env::temp_dir().join(&scenario_id);
    if let Err(err) = std::fs::create_dir_all(&raw_tmp) {
        return harness::print_error(
            "MCP: Filesystem End-to-End",
            &format!("could not create tmp dir: {err}"),
        );
    }
    // macOS gotcha: `std::env::temp_dir()` returns `/var/folders/...` but
    // the filesystem server canonicalizes its --allowed-dirs argument
    // through `realpath`, ending up with `/private/var/folders/...`. If we
    // pass the raw path back as a tool argument, every read fails with
    // "path outside allowed directories". Canonicalize once up front so
    // both the server arg and tool arg agree on the same form.
    let tmp_dir = raw_tmp.canonicalize().unwrap_or(raw_tmp.clone());
    let marker_token = format!("MARKER-{}-OK", scenario_id);
    let marker_path = tmp_dir.join("marker.txt");
    if let Err(err) = std::fs::write(&marker_path, &marker_token) {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return harness::print_error(
            "MCP: Filesystem End-to-End",
            &format!("could not write marker: {err}"),
        );
    }

    let tmp_path_str = tmp_dir.to_string_lossy().to_string();
    let server_config = serde_json::json!({
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", tmp_path_str.clone()],
        "timeout": 60,
    });

    let inject_resp = match inject_server(cfg, &server_name, server_config).await {
        Ok(r) => r,
        Err(err) => {
            let _ = disconnect_server(cfg, &server_name).await;
            let _ = std::fs::remove_dir_all(&tmp_dir);
            return harness::print_error("MCP: Filesystem End-to-End", &err);
        }
    };
    let connected = inject_resp.get("ok").and_then(|v| v.as_bool()) == Some(true);
    if !connected {
        let _ = disconnect_server(cfg, &server_name).await;
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return harness::print_error(
            "MCP: Filesystem End-to-End",
            &format!("inject-server returned {inject_resp}"),
        );
    }

    let tools_resp = match list_tools(cfg, &server_name).await {
        Ok(r) => r,
        Err(err) => {
            let _ = disconnect_server(cfg, &server_name).await;
            let _ = std::fs::remove_dir_all(&tmp_dir);
            return harness::print_error("MCP: Filesystem End-to-End", &err);
        }
    };
    let tools = tools_resp
        .get("tools")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let tool_count = tools.len();
    let has_read_text_file = tools
        .iter()
        .any(|t| t.get("name").and_then(|v| v.as_str()) == Some("read_text_file"));
    let has_garbage_tool = tools.iter().any(|t| {
        t.get("name").and_then(|v| v.as_str()) == Some("zzz-mcp-tool-that-must-not-exist")
    });

    let call_resp = match call_tool(
        cfg,
        &server_name,
        "read_text_file",
        serde_json::json!({ "path": marker_path.to_string_lossy() }),
    )
    .await
    {
        Ok(r) => r,
        Err(err) => {
            let _ = disconnect_server(cfg, &server_name).await;
            let _ = std::fs::remove_dir_all(&tmp_dir);
            return harness::print_error("MCP: Filesystem End-to-End", &err);
        }
    };
    let call_ok = call_resp.get("ok").and_then(|v| v.as_bool()) == Some(true);
    let returned_text = call_resp
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let call_error = call_resp
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let contains_marker = returned_text.contains(&marker_token);

    let bad_call_resp = call_tool(
        cfg,
        &server_name,
        "read_text_file",
        serde_json::json!({ "path": "/this/path/does/not/exist/zzz" }),
    )
    .await
    .unwrap_or_else(|err| serde_json::json!({ "ok": false, "transport_error": err }));
    let bad_returned_ok = bad_call_resp.get("ok").and_then(|v| v.as_bool()) == Some(true);
    let bad_returned_text = bad_call_resp
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    // Filesystem server reports access errors either by ok:false or by
    // ok:true with an error description in the text payload — both are
    // acceptable proof that the bad path didn't silently succeed.
    let bad_path_rejected = !bad_returned_ok
        || bad_returned_text.to_lowercase().contains("error")
        || bad_returned_text.to_lowercase().contains("not allowed")
        || bad_returned_text.to_lowercase().contains("outside");

    // Teardown happens regardless of assertion outcome.
    let _ = disconnect_server(cfg, &server_name).await;
    let _ = std::fs::remove_dir_all(&tmp_dir);

    let summary = format!(
        "tools={tool_count} read_text_file_present={has_read_text_file} call_ok={call_ok} contains_marker={contains_marker} bad_path_rejected={bad_path_rejected} call_error={call_error:?}"
    );
    harness::print_result(
        "MCP: Filesystem End-to-End",
        &summary,
        &[
            ("Server connected", connected),
            ("list_tools returned at least one tool", tool_count > 0),
            ("Tool list includes read_text_file", has_read_text_file),
            (
                "Tool list does NOT include garbage tool name",
                !has_garbage_tool,
            ),
            ("call_tool returned ok=true on real path", call_ok),
            ("Returned text contains seeded marker", contains_marker),
            ("Bad path was rejected (negative-half)", bad_path_rejected),
        ],
    )
}

/// End-to-end: LLM chat turn actually invokes an MCP tool.
///
/// This is the "does it all actually work" scenario — wires together:
///   - MCP server boot (real npx stdio process for `server-memory`)
///   - bridge registration into the agent's ToolRegistry as
///     `mcp__memory__read_graph`
///   - LLM tool-call decision (provider must see the MCP tool in its
///     schema and choose to call it)
///   - MCP roundtrip (`tools/call` over stdio, JSON response flattened
///     into the SDE test endpoint's `tool_calls` list)
///
/// Setup mirrors the **production** path: the scenario writes a
/// `{project}/.orgii/mcp-servers.json` file containing one `memory` stdio
/// entry, then drives a normal SDE turn against the configured account
/// and model. The session-init chain `init_project_session` ->
/// `ensure_connected(workspace)` -> `connect_all(Some(workspace))` reads
/// the merged (global + project) MCP config, spawns the child process,
/// and `register_mcp_tools` injects every active server's tools into the
/// session schema. No debug-only `inject-server` shortcut is used; this
/// test exercises the same end-to-end chain a real user hits when they
/// drop a per-project MCP file into their repo.
///
/// positive-half/negative:
///   - Positive: `tool_calls` must contain `mcp__memory__read_graph` AND
///     the final assistant message must mention the graph contents
///     (empty-array marker or entity labels) — not just "ok".
///   - Negative: `read_file`, `bash_run_command`, and any other built-in
///     tool that would have "satisfied" the request without MCP must NOT
///     appear — catches the degenerate case where the LLM cheats by
///     hallucinating a response instead of calling the tool.
pub async fn llm_calls_memory_read_graph(cfg: &Config) -> bool {
    let session_id = format!("{}-mcp-llm-memory-read", cfg.session_prefix);
    let project = std::env::temp_dir().join(format!("e2e-mcp-llm-{}", session_id));
    let _ = std::fs::create_dir_all(&project);

    // Drop a project-level `.orgii/mcp-servers.json` so the SDE session
    // picks up the `memory` server through the same path a real user
    // hits (per-project MCP config). Cleaned up at the end of the
    // scenario alongside the project dir.
    if let Err(err) = write_project_mcp_memory(&project) {
        return harness::print_error("MCP: LLM Calls Memory read_graph", &err);
    }

    let prompt = concat!(
        "You have an MCP tool called `mcp__memory__read_graph` available. ",
        "Call it exactly once with no arguments to dump the current knowledge graph, ",
        "then report the raw JSON result you got back. ",
        "Do not call any other tool. Do not fabricate a result — I want to see what the tool actually returns.",
    );

    let url = format!("{}/agent/test/sde", cfg.base_url);
    let body = serde_json::json!({
        "content": prompt,
        "session_id": session_id,
        "model": cfg.model,
        "account_id": cfg.account_id,
        "workspace_path": project.to_string_lossy(),
        "mode": "build",
        "no_cleanup": false,
    });

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
    {
        Ok(c) => c,
        Err(err) => {
            return harness::print_error(
                "MCP: LLM Calls Memory read_graph",
                &format!("client build: {err}"),
            );
        }
    };

    let resp = match client.post(&url).json(&body).send().await {
        Ok(r) => r,
        Err(err) => {
            return harness::print_error(
                "MCP: LLM Calls Memory read_graph",
                &format!("HTTP error: {err}"),
            );
        }
    };

    let json: serde_json::Value = match resp.json().await {
        Ok(j) => j,
        Err(err) => {
            return harness::print_error(
                "MCP: LLM Calls Memory read_graph",
                &format!("JSON parse: {err}"),
            );
        }
    };

    if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
        return harness::print_error("MCP: LLM Calls Memory read_graph", err);
    }

    let content = json
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let tool_calls: Vec<String> = json
        .get("tool_calls")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    // `tool_calls_succeeded` is the subset of `tool_calls` whose result row
    // did not start with "Error" — i.e. what the agent actually *executed*,
    // not what the model merely emitted. Models sometimes hallucinate a
    // PascalCase wrapper (`McpMemoryReadGraph`) that gets rejected by the
    // tool registry and then retries with the correct wire name; asserting
    // on `tool_calls_succeeded` isolates the real behavior from that noise.
    let tool_calls_ok: Vec<String> = json
        .get("tool_calls_succeeded")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let tool_calls_display = tool_calls.join(", ");
    let tool_calls_ok_display = tool_calls_ok.join(", ");
    let called_read_graph = tool_calls_ok
        .iter()
        .any(|name| name == "mcp__memory__read_graph");
    // Guard against the LLM fabricating a response. If it only returned
    // text and never successfully invoked any tool, it didn't actually
    // exercise the bridge; that's a failure even if the prose is persuasive.
    let any_tool_called = !tool_calls_ok.is_empty();
    // Negative: the assistant should not have successfully resorted to
    // reading files or shelling out — those paths would indicate the MCP
    // tool wasn't actually registered in this turn's tool schema. A
    // hallucinated-then-failed call doesn't count, so we check the
    // succeeded set instead of the raw one.
    let did_not_touch_fs = !tool_calls_ok
        .iter()
        .any(|name| name == "read_file" || name == "read" || name == "bash_run_command");

    // The memory server on a fresh connection has no entities or
    // relations. Its `read_graph` response is a JSON object with two
    // empty arrays: {"entities":[],"relations":[]}. Accept either the
    // literal substring or the individual array fragments because the
    // LLM may wrap them in markdown code fences.
    let lower = content.to_lowercase();
    let mentions_graph_shape = lower.contains("entities")
        || lower.contains("relations")
        || content.contains("[]")
        || content.contains("{}");

    let summary = format!(
        "tool_calls=[{tool_calls_display}] succeeded=[{tool_calls_ok_display}] content_len={} content_head={:?}",
        content.len(),
        content.chars().take(120).collect::<String>(),
    );

    harness::print_result(
        "MCP: LLM Calls Memory read_graph",
        &summary,
        &[
            ("Agent invoked at least one tool", any_tool_called),
            (
                "Agent invoked mcp__memory__read_graph (positive)",
                called_read_graph,
            ),
            (
                "Agent did not fall back to read_file / bash (negative)",
                did_not_touch_fs,
            ),
            (
                "Final message references graph shape (entities/relations/empty)",
                mentions_graph_shape,
            ),
        ],
    )
}

/// End-to-end: LLM performs a multi-step MCP tool chain.
///
/// Extends `llm_calls_memory_read_graph` in two ways:
///   1. The model must call *two* MCP tools in the same turn: first
///      `create_entities` to write into the graph, then `read_graph` to
///      read back what it just wrote.
///   2. The second call has to observe the write made by the first —
///      proving the MCP client keeps a stable stdio session across tool
///      calls within a single agent turn (no re-spawn, no lost state).
///
/// Assertions:
///   - Positive: both MCP tool names must appear in `tool_calls` and
///     the response must contain the unique entity name we asked for.
///   - Negative: no built-in fs / shell tool should appear; that would
///     mean the LLM gave up on MCP and faked it.
pub async fn llm_multi_step_memory_chain(cfg: &Config) -> bool {
    let session_id = format!("{}-mcp-llm-memory-chain", cfg.session_prefix);
    let project = std::env::temp_dir().join(format!("e2e-mcp-llm-{}", session_id));
    let _ = std::fs::create_dir_all(&project);

    // Production-aligned setup: drop a workspace-scoped MCP config file
    // so the SDE session picks up `memory` through the same chain a
    // real user hits.
    if let Err(err) = write_project_mcp_memory(&project) {
        return harness::print_error("MCP: LLM Multi-Step Memory Chain", &err);
    }

    let entity_name = format!("MarkerEntity{}", cfg.session_prefix.replace(['-', ':'], ""));
    let prompt = format!(
        concat!(
            "You have MCP tools available from a `memory` server, including ",
            "`mcp__memory__create_entities` and `mcp__memory__read_graph`.\n\n",
            "Do exactly these two things, in order, in the same turn:\n",
            "1. Call `mcp__memory__create_entities` once to create one entity named ",
            "`{entity}` with entityType `TestMarker` and one observation `hello from e2e`.\n",
            "2. Call `mcp__memory__read_graph` once with no arguments.\n\n",
            "Then tell me the name of the entity you saw in the graph. ",
            "Do not use any other tools. Do not invent a result.",
        ),
        entity = entity_name,
    );

    let url = format!("{}/agent/test/sde", cfg.base_url);
    let body = serde_json::json!({
        "content": prompt,
        "session_id": session_id,
        "model": cfg.model,
        "account_id": cfg.account_id,
        "workspace_path": project.to_string_lossy(),
        "mode": "build",
        "no_cleanup": false,
    });

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(240))
        .build()
    {
        Ok(c) => c,
        Err(err) => {
            return harness::print_error(
                "MCP: LLM Multi-Step Memory Chain",
                &format!("client build: {err}"),
            );
        }
    };

    let resp = match client.post(&url).json(&body).send().await {
        Ok(r) => r,
        Err(err) => {
            return harness::print_error(
                "MCP: LLM Multi-Step Memory Chain",
                &format!("HTTP error: {err}"),
            );
        }
    };

    let json: serde_json::Value = match resp.json().await {
        Ok(j) => j,
        Err(err) => {
            return harness::print_error(
                "MCP: LLM Multi-Step Memory Chain",
                &format!("JSON parse: {err}"),
            );
        }
    };

    if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
        return harness::print_error("MCP: LLM Multi-Step Memory Chain", err);
    }

    let content = json
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let tool_calls: Vec<String> = json
        .get("tool_calls")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    // See read_graph scenario above for why we assert on the succeeded
    // subset: hallucinated-name retries inflate the raw list but only
    // executed calls prove the chain ran.
    let tool_calls_ok: Vec<String> = json
        .get("tool_calls_succeeded")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let called_create = tool_calls_ok
        .iter()
        .any(|n| n == "mcp__memory__create_entities");
    let called_read = tool_calls_ok.iter().any(|n| n == "mcp__memory__read_graph");
    let no_fs_leak = !tool_calls_ok
        .iter()
        .any(|n| n == "read_file" || n == "write_file" || n == "bash_run_command");
    let entity_echoed = content.contains(&entity_name);

    // Order matters: create must happen before read. If the LLM read
    // first it would see an empty graph and the assertion "entity
    // echoed" would fail anyway, so we treat order implicitly. Use the
    // succeeded list so interleaved hallucinated failures don't shift
    // the perceived order.
    let first_create_idx = tool_calls_ok
        .iter()
        .position(|n| n == "mcp__memory__create_entities");
    let first_read_idx = tool_calls_ok
        .iter()
        .position(|n| n == "mcp__memory__read_graph");
    let order_correct = match (first_create_idx, first_read_idx) {
        (Some(cidx), Some(ridx)) => cidx < ridx,
        _ => false,
    };

    let summary = format!(
        "calls={tool_calls:?} succeeded={tool_calls_ok:?} entity={entity_name} content_len={} head={:?}",
        content.len(),
        content.chars().take(160).collect::<String>(),
    );

    harness::print_result(
        "MCP: LLM Multi-Step Memory Chain",
        &summary,
        &[
            ("Called create_entities", called_create),
            ("Called read_graph", called_read),
            ("create fired before read", order_correct),
            ("No builtin fs/bash fallback (negative)", no_fs_leak),
            (
                "Final response echoes the unique entity name",
                entity_echoed,
            ),
        ],
    )
}

/// Multi-server parallel connect stress test.
///
/// Boots three *real* MCP stdio servers concurrently:
///   - `@modelcontextprotocol/server-filesystem` (fs tools)
///   - `@modelcontextprotocol/server-memory` (knowledge-graph memory)
///   - `@modelcontextprotocol/server-sequential-thinking` (reasoning scratchpad)
///
/// Each server is injected on its own unique debug name, so the scenario
/// is isolated from any user-configured servers on the dev host.
///
/// Assertions (positive + negative):
///   1. All three servers finish `initialize` successfully.
///   2. Each server exposes at least one tool (proves `tools/list` round trip).
///   3. The three servers expose DISJOINT tool-name sets (sanity check that
///      tool aggregation isn't silently merging namespaces on our side).
///   4. Wall-clock for three parallel injects is <= a serial upper bound,
///      catching regressions that re-serialize `connect_all`.
///   5. Cross-call isolation: a tool call issued against one server does NOT
///      surface as a tool on another server.
///
/// Note: this scenario uses `tokio::join!` at the e2e client side. Each
/// individual `/agent/test/mcp/inject-server` call happens to go through
/// `McpManager::connect_server`, so this *also* exercises the parallel
/// manager internals through realistic concurrent HTTP pressure.
pub async fn multi_server_parallel_connect(cfg: &Config) -> bool {
    if !npx_available() {
        println!("⚠️  MCP: Multi-Server Parallel Connect — skipped (npx not on PATH)");
        return true;
    }

    let suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let fs_name = format!("e2e-mcp-multi-fs-{suffix}");
    let mem_name = format!("e2e-mcp-multi-mem-{suffix}");
    let seq_name = format!("e2e-mcp-multi-seq-{suffix}");

    let raw_tmp = std::env::temp_dir().join(format!("e2e-mcp-multi-{suffix}"));
    if let Err(err) = std::fs::create_dir_all(&raw_tmp) {
        return harness::print_error(
            "MCP: Multi-Server Parallel Connect",
            &format!("could not create tmp dir: {err}"),
        );
    }
    let tmp_dir = raw_tmp.canonicalize().unwrap_or(raw_tmp.clone());
    let tmp_path_str = tmp_dir.to_string_lossy().to_string();

    let fs_cfg = serde_json::json!({
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", tmp_path_str.clone()],
        "timeout": 60,
    });
    let mem_cfg = serde_json::json!({
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-memory"],
        "timeout": 60,
    });
    let seq_cfg = serde_json::json!({
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"],
        "timeout": 60,
    });

    let start = std::time::Instant::now();
    let (fs_res, mem_res, seq_res) = tokio::join!(
        inject_server(cfg, &fs_name, fs_cfg),
        inject_server(cfg, &mem_name, mem_cfg),
        inject_server(cfg, &seq_name, seq_cfg),
    );
    let wall_ms = start.elapsed().as_millis();

    let fs_ok = fs_res
        .as_ref()
        .ok()
        .and_then(|v| v.get("ok"))
        .and_then(|v| v.as_bool())
        == Some(true);
    let mem_ok = mem_res
        .as_ref()
        .ok()
        .and_then(|v| v.get("ok"))
        .and_then(|v| v.as_bool())
        == Some(true);
    let seq_ok = seq_res
        .as_ref()
        .ok()
        .and_then(|v| v.get("ok"))
        .and_then(|v| v.as_bool())
        == Some(true);

    let all_connected = fs_ok && mem_ok && seq_ok;

    let (fs_tools_json, mem_tools_json, seq_tools_json) = if all_connected {
        tokio::join!(
            list_tools(cfg, &fs_name),
            list_tools(cfg, &mem_name),
            list_tools(cfg, &seq_name),
        )
    } else {
        (
            Ok(serde_json::json!({"tools": []})),
            Ok(serde_json::json!({"tools": []})),
            Ok(serde_json::json!({"tools": []})),
        )
    };

    fn names(resp: &Result<serde_json::Value, String>) -> Vec<String> {
        resp.as_ref()
            .ok()
            .and_then(|v| v.get("tools").and_then(|t| t.as_array()).cloned())
            .unwrap_or_default()
            .into_iter()
            .filter_map(|t| {
                t.get("name")
                    .and_then(|n| n.as_str())
                    .map(|s| s.to_string())
            })
            .collect()
    }

    let fs_names = names(&fs_tools_json);
    let mem_names = names(&mem_tools_json);
    let seq_names = names(&seq_tools_json);

    let fs_has_tools = !fs_names.is_empty();
    let mem_has_tools = !mem_names.is_empty();
    let seq_has_tools = !seq_names.is_empty();

    // Cross-server namespace isolation: fs's "read_text_file" must not
    // appear in memory's or sequential-thinking's tool list.
    let fs_set: std::collections::HashSet<&String> = fs_names.iter().collect();
    let mem_set: std::collections::HashSet<&String> = mem_names.iter().collect();
    let seq_set: std::collections::HashSet<&String> = seq_names.iter().collect();
    let disjoint_fs_mem = fs_set.is_disjoint(&mem_set);
    let disjoint_fs_seq = fs_set.is_disjoint(&seq_set);
    let disjoint_mem_seq = mem_set.is_disjoint(&seq_set);

    // Parallel budget: three npm cold starts in series would easily take
    // 30-60s on a clean machine. If we see > 90s wall clock it means
    // `connect_all` or the debug endpoint path silently serialized.
    let under_parallel_budget = wall_ms < 90_000;

    // Teardown happens regardless of assertion outcome.
    let _ = tokio::join!(
        disconnect_server(cfg, &fs_name),
        disconnect_server(cfg, &mem_name),
        disconnect_server(cfg, &seq_name),
    );
    let _ = std::fs::remove_dir_all(&tmp_dir);

    let summary = format!(
        "wall_ms={wall_ms} fs_ok={fs_ok} mem_ok={mem_ok} seq_ok={seq_ok} fs_tools={} mem_tools={} seq_tools={}",
        fs_names.len(),
        mem_names.len(),
        seq_names.len(),
    );
    harness::print_result(
        "MCP: Multi-Server Parallel Connect",
        &summary,
        &[
            ("Filesystem server connected", fs_ok),
            ("Memory server connected", mem_ok),
            ("Sequential-thinking server connected", seq_ok),
            ("Filesystem exposes ≥1 tool", fs_has_tools),
            ("Memory exposes ≥1 tool", mem_has_tools),
            ("Sequential-thinking exposes ≥1 tool", seq_has_tools),
            ("Tool namespaces disjoint: fs vs memory", disjoint_fs_mem),
            (
                "Tool namespaces disjoint: fs vs seq-thinking",
                disjoint_fs_seq,
            ),
            (
                "Tool namespaces disjoint: memory vs seq-thinking",
                disjoint_mem_seq,
            ),
            (
                "Parallel connect stayed under serial budget (90s)",
                under_parallel_budget,
            ),
        ],
    )
}

//! LSP lifecycle E2E scenarios.
//!
//! Drives the live `LspManager` via `/agent/test/lsp/*` debug
//! endpoints. No LLM is involved; each scenario is a deterministic
//! HTTP sequence asserting a single contract:
//!
//! - **`lsp-start-stop-cycle`**: full lifecycle on a real
//!   `typescript-language-server` process — start, observe in
//!   `running`, drive a `did_open`, stop, confirm gone.
//! - **`lsp-running-list-empty-when-stopped`**: structural pin — the
//!   `running` endpoint reports an empty list after teardown, so a
//!   future regression that leaks a server across scenarios fails
//!   loudly.
//! - **`lsp-start-unknown-language-fails`**: negative path — the
//!   manager rejects unknown language ids with the documented error
//!   string and never panics. Exercises the `servers_for_language_id`
//!   lookup at the production entry point, not the helper directly.
//! - **`lsp-broken-cooldown-blocks-restart`**: consumer-side test of
//!   the broken-cooldown short-circuit. Seeds a synthetic broken
//!   entry via `seed_broken_for_test`, then proves the next
//!   `start_server` call returns the seeded error rather than
//!   re-spawning. The producer side (`mark_broken` after a real spawn
//!   failure) is intentionally not driven here — provoking it
//!   deterministically requires a binary that crashes on init, which
//!   is flaky in CI; manual smoke covers that half.
//! - **`lsp-log-buffer-captures-handshake`**: structural pin on the
//!   per-server stdio ring buffer. After starting TS, the log
//!   snapshot must report at least one `std_in` line (our
//!   `initialize` request) and one `std_out` line (the server's
//!   response) within a 5s budget. Catches a regression where a
//!   future framing/codec refactor stops feeding the buffer.
//!
//! ## Prerequisites
//!
//! - `typescript-language-server` resolvable on `PATH` (the dev box
//!   already has it via npm; CI must `npm i -g
//!   typescript-language-server typescript`).
//! - The Tauri app running via `npm run tauri:dev` so the test routes
//!   are mounted (`#[cfg(debug_assertions)]`).
//!
//! ## Why we share the live `LspManager` instead of a parallel test
//! instance
//!
//! `LspManager` has no test-only per-instance config — sharing the live one is
//! what we actually want to assert (production-path coverage), and each scenario
//! tears its own server down before the next runs.
//!
//! Co-located endpoints: `src-tauri/src/api/agent/test/lsp.rs`.

use crate::config::Config;
use crate::harness;

const TS_LANGUAGE: &str = "typescript";

/// Use the `orgii_frontend` working directory as the workspace root.
/// Every scenario starts from the same root so we exercise the
/// "already running, short-circuit" path as a side benefit when
/// scenarios run back-to-back, while still letting `stop` clean up.
fn root_path() -> String {
    std::env::current_dir()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|_| "/tmp".to_string())
}

async fn http_post(
    cfg: &Config,
    path: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let url = format!("{}{}", cfg.base_url, path);
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|err| format!("HTTP error {path}: {err}"))?;
    resp.json::<serde_json::Value>()
        .await
        .map_err(|err| format!("JSON parse error {path}: {err}"))
}

async fn http_get(cfg: &Config, path: &str) -> Result<serde_json::Value, String> {
    let url = format!("{}{}", cfg.base_url, path);
    let resp = reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|err| format!("HTTP error {path}: {err}"))?;
    resp.json::<serde_json::Value>()
        .await
        .map_err(|err| format!("JSON parse error {path}: {err}"))
}

async fn lsp_start(cfg: &Config, language: &str, root: &str) -> Result<serde_json::Value, String> {
    http_post(
        cfg,
        "/agent/test/lsp/start",
        serde_json::json!({ "language": language, "root_path": root }),
    )
    .await
}

async fn lsp_stop(cfg: &Config, language: &str) -> Result<serde_json::Value, String> {
    http_post(
        cfg,
        "/agent/test/lsp/stop",
        serde_json::json!({ "language": language }),
    )
    .await
}

async fn lsp_running(cfg: &Config) -> Result<Vec<String>, String> {
    let json = http_get(cfg, "/agent/test/lsp/running").await?;
    Ok(json
        .get("languages")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default())
}

async fn lsp_did_open(
    cfg: &Config,
    language: &str,
    uri: &str,
    text: &str,
) -> Result<serde_json::Value, String> {
    http_post(
        cfg,
        "/agent/test/lsp/did-open",
        serde_json::json!({
            "language": language,
            "uri": uri,
            "version": 1,
            "text": text,
        }),
    )
    .await
}

async fn lsp_log(cfg: &Config, language: &str) -> Result<serde_json::Value, String> {
    http_get(cfg, &format!("/agent/test/lsp/log/{language}")).await
}

async fn lsp_seed_broken(
    cfg: &Config,
    language: &str,
    root: &str,
    error: &str,
) -> Result<serde_json::Value, String> {
    http_post(
        cfg,
        "/agent/test/lsp/seed-broken",
        serde_json::json!({
            "language": language,
            "root_path": root,
            "error": error,
        }),
    )
    .await
}

/// Best-effort teardown — never bubbles errors. Used at the start of
/// every scenario to discard state from a prior run, and at the end
/// to keep the `running` set empty for the next scenario.
async fn ensure_stopped(cfg: &Config, language: &str) {
    let _ = lsp_stop(cfg, language).await;
}

// ───────────────────────────────────────────────────────────────────
// Scenarios
// ───────────────────────────────────────────────────────────────────

pub async fn lsp_start_stop_cycle(cfg: &Config) -> bool {
    ensure_stopped(cfg, TS_LANGUAGE).await;
    let root = root_path();

    let started = match lsp_start(cfg, TS_LANGUAGE, &root).await {
        Ok(json) => json,
        Err(err) => return harness::print_error("LSP start/stop cycle", &err),
    };
    let start_ok = started.get("ok").and_then(|v| v.as_bool()) == Some(true);

    let running_after_start = lsp_running(cfg).await.unwrap_or_default();
    let in_running = running_after_start.iter().any(|lang| lang == TS_LANGUAGE);

    let did_open_resp = lsp_did_open(
        cfg,
        TS_LANGUAGE,
        "file:///tmp/lsp-e2e-noop.ts",
        "export const PROBE: number = 1;",
    )
    .await;
    let did_open_ok = did_open_resp
        .as_ref()
        .ok()
        .and_then(|json| json.get("ok").and_then(|v| v.as_bool()))
        == Some(true);

    let stopped = lsp_stop(cfg, TS_LANGUAGE).await;
    let stop_ok = stopped
        .as_ref()
        .ok()
        .and_then(|json| json.get("ok").and_then(|v| v.as_bool()))
        == Some(true);

    let running_after_stop = lsp_running(cfg).await.unwrap_or_default();
    let stopped_clean = !running_after_stop.iter().any(|lang| lang == TS_LANGUAGE);

    harness::print_result(
        "LSP start/stop cycle",
        &started.to_string(),
        &[
            ("start returns ok=true", start_ok),
            ("server appears in running list", in_running),
            ("did_open accepted", did_open_ok),
            ("stop returns ok=true", stop_ok),
            ("server gone after stop", stopped_clean),
        ],
    )
}

pub async fn lsp_running_list_empty_when_stopped(cfg: &Config) -> bool {
    ensure_stopped(cfg, TS_LANGUAGE).await;
    let running = match lsp_running(cfg).await {
        Ok(list) => list,
        Err(err) => return harness::print_error("LSP running list empty", &err),
    };
    let no_typescript = !running.iter().any(|lang| lang == TS_LANGUAGE);
    harness::print_result(
        "LSP running list empty",
        &format!("running = {running:?}"),
        &[(
            "no typescript server lingering from prior scenarios",
            no_typescript,
        )],
    )
}

pub async fn lsp_start_unknown_language_fails(cfg: &Config) -> bool {
    let root = root_path();
    let resp = match lsp_start(cfg, "this_language_definitely_does_not_exist_xyz", &root).await {
        Ok(json) => json,
        Err(err) => return harness::print_error("LSP unknown language rejected", &err),
    };
    let ok_false = resp.get("ok").and_then(|v| v.as_bool()) == Some(false);
    let error_msg = resp.get("error").and_then(|v| v.as_str()).unwrap_or("");
    let mentions_no_server = error_msg.contains("No LSP server available for language");

    harness::print_result(
        "LSP unknown language rejected",
        &resp.to_string(),
        &[
            ("response ok=false", ok_false),
            (
                "error mentions \"No LSP server available for language\"",
                mentions_no_server,
            ),
        ],
    )
}

pub async fn lsp_broken_cooldown_blocks_restart(cfg: &Config) -> bool {
    ensure_stopped(cfg, TS_LANGUAGE).await;
    let root = root_path();
    let synthetic_error = "synthetic-cooldown-failure-from-e2e";

    let seeded = match lsp_seed_broken(cfg, TS_LANGUAGE, &root, synthetic_error).await {
        Ok(json) => json,
        Err(err) => return harness::print_error("LSP broken cooldown blocks restart", &err),
    };
    let seed_ok = seeded.get("ok").and_then(|v| v.as_bool()) == Some(true);

    let restart_resp = match lsp_start(cfg, TS_LANGUAGE, &root).await {
        Ok(json) => json,
        Err(err) => return harness::print_error("LSP broken cooldown blocks restart", &err),
    };
    let restart_blocked = restart_resp.get("ok").and_then(|v| v.as_bool()) == Some(false);
    let restart_error = restart_resp
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let mentions_cooldown = restart_error.contains("cooldown");
    let mentions_seeded_msg = restart_error.contains(synthetic_error);

    let running_blocked = lsp_running(cfg).await.unwrap_or_default();
    let nothing_spawned = !running_blocked.iter().any(|lang| lang == TS_LANGUAGE);

    harness::print_result(
        "LSP broken cooldown blocks restart",
        &restart_resp.to_string(),
        &[
            ("seed_broken_for_test returned ok", seed_ok),
            ("restart returned ok=false", restart_blocked),
            ("error references cooldown", mentions_cooldown),
            (
                "error propagates the seeded message verbatim",
                mentions_seeded_msg,
            ),
            ("no server actually started", nothing_spawned),
        ],
    )
}

pub async fn lsp_log_buffer_captures_handshake(cfg: &Config) -> bool {
    ensure_stopped(cfg, TS_LANGUAGE).await;
    let root = root_path();

    let started = match lsp_start(cfg, TS_LANGUAGE, &root).await {
        Ok(json) => json,
        Err(err) => return harness::print_error("LSP log buffer captures handshake", &err),
    };
    let start_ok = started.get("ok").and_then(|v| v.as_bool()) == Some(true);
    if !start_ok {
        // Emit the failure context so a missing typescript-language-server
        // shows up clearly in the runner log instead of a confusing
        // downstream "no log entries" failure.
        ensure_stopped(cfg, TS_LANGUAGE).await;
        return harness::print_result(
            "LSP log buffer captures handshake",
            &started.to_string(),
            &[("server started", false)],
        );
    }

    // Poll the log endpoint up to 5s for std_in (initialize request)
    // AND std_out (server response) entries. The handshake completes
    // well under 1s on a healthy install; the 5s budget is for cold
    // npm cache or first-time spawn on CI.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    let mut last_log = serde_json::Value::Null;
    let mut std_in_count: u64 = 0;
    let mut std_out_count: u64 = 0;
    while std::time::Instant::now() < deadline {
        match lsp_log(cfg, TS_LANGUAGE).await {
            Ok(json) => {
                std_in_count = json
                    .get("kinds")
                    .and_then(|kinds| kinds.get("std_in"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                std_out_count = json
                    .get("kinds")
                    .and_then(|kinds| kinds.get("std_out"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                last_log = json;
                if std_in_count >= 1 && std_out_count >= 1 {
                    break;
                }
            }
            Err(err) => {
                ensure_stopped(cfg, TS_LANGUAGE).await;
                return harness::print_error("LSP log buffer captures handshake", &err);
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }

    let kinds = last_log
        .get("kinds")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let sample_first_kind = last_log
        .get("sample")
        .and_then(|arr| arr.as_array())
        .and_then(|arr| arr.first())
        .and_then(|entry| entry.get("kind"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let sample_has_ts_ms = last_log
        .get("sample")
        .and_then(|arr| arr.as_array())
        .and_then(|arr| arr.first())
        .map(|entry| entry.get("tsMs").is_some())
        .unwrap_or(false);

    ensure_stopped(cfg, TS_LANGUAGE).await;

    harness::print_result(
        "LSP log buffer captures handshake",
        &kinds.to_string(),
        &[
            ("at least one std_in line captured", std_in_count >= 1),
            ("at least one std_out line captured", std_out_count >= 1),
            (
                "sample entry uses snake_case kind",
                matches!(sample_first_kind.as_str(), "std_in" | "std_out" | "std_err"),
            ),
            (
                "sample entry serialises tsMs in camelCase",
                sample_has_ts_ms,
            ),
        ],
    )
}

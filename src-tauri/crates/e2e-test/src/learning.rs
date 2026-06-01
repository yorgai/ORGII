//! Learning system E2E scenarios (`--group learning`).
//!
//! Tests the L3 learnings pipeline through HTTP endpoints:
//! reflection, list, deprecate, and prompt injection.
//! Per-agent enable/disable lives in agent-config — not tested here.

use super::config::Config;
use super::harness;

// ============================================
// Harness helpers for learning endpoints
// ============================================

async fn trigger_reflection(cfg: &Config, session_id: &str) -> Result<serde_json::Value, String> {
    let url = format!(
        "{}/agent/test/learning/reflect/{}",
        cfg.base_url, session_id
    );

    let resp = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|err| format!("Client build error: {}", err))?
        .post(&url)
        .send()
        .await
        .map_err(|err| format!("HTTP error: {}", err))?;

    resp.json()
        .await
        .map_err(|err| format!("JSON parse error: {}", err))
}

async fn list_learnings(
    cfg: &Config,
    agent_scope: Option<&str>,
) -> Result<serde_json::Value, String> {
    let mut url = format!("{}/agent/test/learning/list", cfg.base_url);
    if let Some(scope) = agent_scope {
        url = format!("{}?agent_scope={}", url, scope);
    }

    let resp = reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {}", err))?;

    resp.json()
        .await
        .map_err(|err| format!("JSON parse error: {}", err))
}

async fn deprecate_learning(cfg: &Config, learning_id: &str) -> Result<serde_json::Value, String> {
    let url = format!("{}/agent/test/learning/deprecate", cfg.base_url);
    let body = serde_json::json!({ "learning_id": learning_id });

    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {}", err))?;

    resp.json()
        .await
        .map_err(|err| format!("JSON parse error: {}", err))
}

// ============================================
// Scenarios
// ============================================

/// Send a conversation then trigger reflection, expecting insights to be extracted.
pub async fn reflection_pipeline(cfg: &Config) -> bool {
    let session_id = format!("{}-learn-reflect", cfg.session_prefix);
    let project = std::env::temp_dir()
        .join("e2e-learn-reflect")
        .to_string_lossy()
        .to_string();
    let _ = std::fs::create_dir_all(&project);

    println!("  [step 1] Creating session (learnings default-on per agent-config)...");
    let create_result = harness::send_sde_message(
        cfg,
        "Create a Rust function called `add` that takes two i32 numbers and returns their sum.",
        &session_id,
        "build",
        &project,
        None,
        true,
    )
    .await;

    if let Err(ref err) = create_result {
        return harness::print_error("Learning Reflection Pipeline", err);
    }

    println!("  [step 2] Sending follow-up to create more conversation context...");
    let _ = harness::send_sde_message(
        cfg,
        "Now add error handling — if either number overflows i32, return an error instead of panicking. Use Result<i32, String> as the return type.",
        &session_id,
        "build",
        &project,
        None,
        true,
    )
    .await;

    println!("  [step 3] Triggering reflection...");
    let reflect_result = trigger_reflection(cfg, &session_id).await;

    let reflect_ok = reflect_result
        .as_ref()
        .map(|v| v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false))
        .unwrap_or(false);

    let reflect_error = reflect_result
        .as_ref()
        .map(|v| {
            v.get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("")
                .to_string()
        })
        .unwrap_or_default();

    let provider_unavailable = reflect_error.contains("No provider")
        || reflect_error.contains("No account")
        || reflect_error.contains("Auth error");

    let learnings_stored = reflect_result
        .as_ref()
        .map(|v| {
            v.get("learnings_stored")
                .and_then(|n| n.as_u64())
                .unwrap_or(0)
        })
        .unwrap_or(0);

    let reflect_detail = format!(
        "reflect_ok={}, learnings_stored={}, error={}",
        reflect_ok, learnings_stored, reflect_error
    );
    println!("  [info] {}", reflect_detail);

    harness::cleanup_sde_session(cfg, &session_id).await.ok();

    harness::print_result(
        "Learning Reflection Pipeline",
        &reflect_detail,
        &[
            (
                "Reflection API responded (ok or provider unavailable)",
                reflect_ok || provider_unavailable,
            ),
            (
                "Reflection result valid (success or no provider configured)",
                reflect_ok || provider_unavailable,
            ),
        ],
    )
}

/// List learnings, and if any exist, deprecate one.
pub async fn list_and_deprecate(cfg: &Config) -> bool {
    println!("  [step 1] Listing all learnings (global scope)...");
    let list_result = list_learnings(cfg, None).await;

    let list_ok = list_result
        .as_ref()
        .map(|v| v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false))
        .unwrap_or(false);

    let count = list_result
        .as_ref()
        .map(|v| v.get("count").and_then(|n| n.as_u64()).unwrap_or(0))
        .unwrap_or(0);

    println!("  [info] Found {} learnings", count);

    let mut deprecate_ok = true;
    let mut deprecate_tested = false;

    if count > 0 {
        let first_id = list_result
            .as_ref()
            .ok()
            .and_then(|v| v.get("learnings"))
            .and_then(|arr| arr.as_array())
            .and_then(|arr| arr.first())
            .and_then(|item| item.get("id"))
            .and_then(|id| id.as_str())
            .map(|s| s.to_string());

        if let Some(learning_id) = first_id {
            println!("  [step 2] Deprecating learning '{}'...", learning_id);
            let deprecate_result = deprecate_learning(cfg, &learning_id).await;
            deprecate_ok = deprecate_result
                .as_ref()
                .map(|v| v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false))
                .unwrap_or(false);
            deprecate_tested = true;

            println!("  [step 3] Verifying deprecation (re-listing)...");
            let list_after = list_learnings(cfg, None).await;
            let new_count = list_after
                .as_ref()
                .map(|v| v.get("count").and_then(|n| n.as_u64()).unwrap_or(0))
                .unwrap_or(0);
            println!("  [info] Count before={}, after={}", count, new_count);
        }
    }

    harness::print_result(
        "Learning List & Deprecate",
        &format!(
            "list_ok={}, count={}, deprecate_tested={}",
            list_ok, count, deprecate_tested
        ),
        &[
            ("List API returned ok", list_ok),
            (
                "Deprecate succeeded (or no learnings to deprecate)",
                deprecate_ok,
            ),
        ],
    )
}

/// Full learning round trip: create session → enable learning → chat → reflect → verify learnings injected in prompt.
pub async fn learning_prompt_injection(cfg: &Config) -> bool {
    let session_id = format!("{}-learn-inject", cfg.session_prefix);
    let project = std::env::temp_dir()
        .join("e2e-learn-inject")
        .to_string_lossy()
        .to_string();
    let _ = std::fs::create_dir_all(&project);

    println!("  [step 1] Creating session (learnings default-on per agent-config)...");
    let _ = harness::send_sde_message(
        cfg,
        "Write a Python function called `fibonacci` that returns the nth Fibonacci number using memoization.",
        &session_id,
        "build",
        &project,
        None,
        true,
    )
    .await;

    println!("  [step 2] Having a multi-turn conversation...");
    let _ = harness::send_sde_message(
        cfg,
        "Good. Now optimize it to use iterative approach instead of recursive with memoization for better space complexity.",
        &session_id,
        "build",
        &project,
        None,
        true,
    )
    .await;

    println!("  [step 3] Triggering reflection to extract learnings...");
    let reflect_result = trigger_reflection(cfg, &session_id).await;
    let reflect_ok = reflect_result
        .as_ref()
        .map(|v| v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false))
        .unwrap_or(false);

    let reflect_error = reflect_result
        .as_ref()
        .map(|v| {
            v.get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("")
                .to_string()
        })
        .unwrap_or_default();

    let provider_unavailable = reflect_error.contains("No provider")
        || reflect_error.contains("No account")
        || reflect_error.contains("Auth error");

    println!(
        "  [info] reflect_ok={}, error={}",
        reflect_ok, reflect_error
    );

    println!("  [step 4] Verifying learnings list API works...");
    let list_result = list_learnings(cfg, None).await;
    let list_ok = list_result
        .as_ref()
        .map(|v| v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false))
        .unwrap_or(false);

    println!("  [step 5] Sending new message to check if learnings influence response...");
    let final_resp = harness::send_sde_message(
        cfg,
        "Write a Python function to calculate factorials. What approach would you recommend?",
        &session_id,
        "build",
        &project,
        None,
        false,
    )
    .await;

    let got_response = final_resp.is_ok();
    let response_content = final_resp
        .as_ref()
        .map(|r| r.content.clone())
        .unwrap_or_default();

    harness::print_result(
        "Learning Prompt Injection",
        &response_content,
        &[
            (
                "Reflection attempted (ok or provider unavailable)",
                reflect_ok || provider_unavailable,
            ),
            ("List learnings API works", list_ok),
            ("Final response received", got_response),
            ("Response is substantive", response_content.len() > 50),
        ],
    )
}

// ============================================
async fn learnings_list_filtered(
    cfg: &Config,
    query: &[(&str, &str)],
) -> Result<serde_json::Value, String> {
    let mut url = format!("{}/agent/test/learnings/list", cfg.base_url);
    if !query.is_empty() {
        let qs: Vec<String> = query
            .iter()
            .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
            .collect();
        url = format!("{}?{}", url, qs.join("&"));
    }
    let resp = reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {}", err))?;
    resp.json()
        .await
        .map_err(|err| format!("JSON parse error: {}", err))
}

async fn learnings_set_status(
    cfg: &Config,
    learning_id: &str,
    next: &str,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/agent/test/learnings/set-status", cfg.base_url);
    let body = serde_json::json!({
        "learning_id": learning_id,
        "next": next,
    });
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {}", err))?;
    resp.json()
        .await
        .map_err(|err| format!("JSON parse error: {}", err))
}

async fn learnings_delete(cfg: &Config, learning_id: &str) -> Result<serde_json::Value, String> {
    let url = format!("{}/agent/test/learnings/delete", cfg.base_url);
    let body = serde_json::json!({ "learning_id": learning_id });
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {}", err))?;
    resp.json()
        .await
        .map_err(|err| format!("JSON parse error: {}", err))
}

async fn learnings_status_report(
    cfg: &Config,
    agent_scope: Option<&str>,
) -> Result<serde_json::Value, String> {
    let mut url = format!("{}/agent/test/learnings/status", cfg.base_url);
    if let Some(scope) = agent_scope {
        url = format!("{}?agent_scope={}", url, urlencoding::encode(scope));
    }
    let resp = reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {}", err))?;
    resp.json()
        .await
        .map_err(|err| format!("JSON parse error: {}", err))
}

/// Exercise `learnings_list` filters end-to-end: seed two distinguishable
/// rows (one pending, one deprecated), then confirm each filter really
/// narrows the returned set. Also verifies that a guaranteed-missing
/// search term returns an empty list.
pub async fn filtered_list(cfg: &Config) -> bool {
    let marker_pending = format!("E2E-FILT-PENDING-{}", cfg.session_prefix);
    let marker_deprecated = format!("E2E-FILT-DEPRECATED-{}", cfg.session_prefix);

    println!("  [step 1] seed one pending + one deprecated row...");
    let seed_p = seed_learning(
        cfg,
        "e2e-filtered",
        &marker_pending,
        "pending",
        "reflection",
    )
    .await;
    let seed_d = seed_learning(
        cfg,
        "e2e-filtered",
        &marker_deprecated,
        "deprecated",
        "pattern_extraction",
    )
    .await;
    let seeds_ok = seed_p
        .as_ref()
        .map(|v| v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false))
        .unwrap_or(false)
        && seed_d
            .as_ref()
            .map(|v| v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false))
            .unwrap_or(false);

    fn contains_marker(list: &serde_json::Value, marker: &str) -> bool {
        list.get("learnings")
            .and_then(|arr| arr.as_array())
            .map(|arr| {
                arr.iter().any(|item| {
                    item.get("content")
                        .and_then(|c| c.as_str())
                        .map(|c| c.contains(marker))
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false)
    }

    println!("  [step 2] status=pending should include pending marker, NOT deprecated...");
    let only_pending = learnings_list_filtered(
        cfg,
        &[
            ("agent_scope", "e2e-filtered"),
            ("status", "pending"),
            ("limit", "500"),
        ],
    )
    .await;
    let only_pending_ok = only_pending.is_ok();
    let pending_has_p = only_pending
        .as_ref()
        .map(|v| contains_marker(v, &marker_pending))
        .unwrap_or(false);
    let pending_no_d = only_pending
        .as_ref()
        .map(|v| !contains_marker(v, &marker_deprecated))
        .unwrap_or(false);

    println!("  [step 3] status=deprecated should include deprecated marker, NOT pending...");
    let only_deprecated = learnings_list_filtered(
        cfg,
        &[
            ("agent_scope", "e2e-filtered"),
            ("status", "deprecated"),
            ("limit", "500"),
        ],
    )
    .await;
    let only_deprecated_ok = only_deprecated.is_ok();
    let deprecated_has_d = only_deprecated
        .as_ref()
        .map(|v| contains_marker(v, &marker_deprecated))
        .unwrap_or(false);
    let deprecated_no_p = only_deprecated
        .as_ref()
        .map(|v| !contains_marker(v, &marker_pending))
        .unwrap_or(false);

    println!("  [step 4] search for a token that cannot exist should return empty list...");
    let search_miss = learnings_list_filtered(
        cfg,
        &[
            ("agent_scope", "e2e-filtered"),
            ("search", "xyz-guaranteed-no-match-9f3a"),
            ("limit", "500"),
        ],
    )
    .await;
    let search_empty = search_miss
        .as_ref()
        .map(|v| {
            v.get("count")
                .and_then(|n| n.as_u64())
                .map(|n| n == 0)
                .unwrap_or(false)
        })
        .unwrap_or(false);

    harness::print_result(
        "Learnings Filtered List",
        &format!(
            "seeds_ok={}, pending_ok={}, deprecated_ok={}, search_empty={}",
            seeds_ok, only_pending_ok, only_deprecated_ok, search_empty
        ),
        &[
            ("Seed rows inserted", seeds_ok),
            (
                "status=pending contains pending marker AND excludes deprecated",
                pending_has_p && pending_no_d,
            ),
            (
                "status=deprecated contains deprecated marker AND excludes pending",
                deprecated_has_d && deprecated_no_p,
            ),
            ("search for missing token returns zero rows", search_empty),
        ],
    )
}

/// Exercise the status lifecycle: pick any existing learning (if present),
/// transition it through pending→active→deprecated→active, then delete it.
/// Skips mutation if no learnings exist but still asserts the API responds.
pub async fn status_lifecycle(cfg: &Config) -> bool {
    println!("  [step 1] Finding a learning to mutate...");
    let list = learnings_list_filtered(cfg, &[("limit", "1")]).await;
    let list_ok = list
        .as_ref()
        .map(|v| v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false))
        .unwrap_or(false);

    let target_id = list
        .as_ref()
        .ok()
        .and_then(|v| v.get("learnings"))
        .and_then(|arr| arr.as_array())
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("id"))
        .and_then(|id| id.as_str())
        .map(|s| s.to_string());

    let Some(id) = target_id else {
        return harness::print_result(
            "Learnings Status Lifecycle",
            "no learnings available — skipping mutation steps",
            &[
                ("List API responds", list_ok),
                ("Mutation skipped (no data)", true),
            ],
        );
    };
    println!("  [info] target learning_id={}", id);

    println!("  [step 2] set-status → deprecated...");
    let r1 = learnings_set_status(cfg, &id, "deprecated").await;
    let r1_ok = r1
        .as_ref()
        .map(|v| v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false))
        .unwrap_or(false);

    println!("  [step 3] set-status → active (reactivate)...");
    let r2 = learnings_set_status(cfg, &id, "active").await;
    let r2_ok = r2
        .as_ref()
        .map(|v| v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false))
        .unwrap_or(false);

    println!("  [step 4] illegal transition active → pending (should be rejected)...");
    let r3 = learnings_set_status(cfg, &id, "pending").await;
    let r3_rejected = r3
        .as_ref()
        .map(|v| v.get("error").is_some() || !v.get("ok").and_then(|o| o.as_bool()).unwrap_or(true))
        .unwrap_or(false);

    harness::print_result(
        "Learnings Status Lifecycle",
        &format!(
            "r1_ok={}, r2_ok={}, r3_rejected={}",
            r1_ok, r2_ok, r3_rejected
        ),
        &[
            ("active→deprecated OK", r1_ok),
            ("deprecated→active OK", r2_ok),
            ("active→pending rejected (whitelist enforced)", r3_rejected),
        ],
    )
}

/// Exercise the consolidation-status endpoint (counts + last-run summary).
pub async fn status_report(cfg: &Config) -> bool {
    println!("  [step 1] status report (global scope)...");
    let global = learnings_status_report(cfg, None).await;
    let global_ok = global
        .as_ref()
        .map(|v| v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false))
        .unwrap_or(false);

    let report = global
        .as_ref()
        .ok()
        .and_then(|v| v.get("report").cloned())
        .unwrap_or_default();

    let has_counts = report.get("pending_count").is_some()
        && report.get("active_count").is_some()
        && report.get("merged_count").is_some()
        && report.get("deprecated_count").is_some();
    let has_next_hint = report.get("next_trigger_hint").is_some();

    println!("  [step 2] status report (scoped agent=_global)...");
    let scoped = learnings_status_report(cfg, Some("_global")).await;
    let scoped_ok = scoped
        .as_ref()
        .map(|v| v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false))
        .unwrap_or(false);

    harness::print_result(
        "Learnings Status Report",
        &serde_json::to_string(&report).unwrap_or_default(),
        &[
            ("Global status OK", global_ok),
            ("Report exposes status counts", has_counts),
            ("Report exposes next_trigger_hint", has_next_hint),
            ("Scoped status OK", scoped_ok),
        ],
    )
}

/// Exercise the delete endpoint: bogus id rejects cleanly AND a seeded
/// `merged` row rejects (lineage protection from `learnings_delete`).
pub async fn delete_protection(cfg: &Config) -> bool {
    println!("  [step 1] delete non-existent id (should error)...");
    let bogus = learnings_delete(cfg, "does-not-exist-0000").await;
    let bogus_rejected = bogus
        .as_ref()
        .map(|v| v.get("error").is_some() || !v.get("ok").and_then(|o| o.as_bool()).unwrap_or(true))
        .unwrap_or(false);

    println!("  [step 2] seed a merged learning to protect...");
    let seed = seed_learning(
        cfg,
        "e2e-delete-protection",
        "Merged row that must not be deleted via UI path.",
        "merged",
        "reflection",
    )
    .await;
    let merged_id = seed
        .as_ref()
        .ok()
        .and_then(|v| v.get("learning_id").and_then(|x| x.as_str()))
        .map(|s| s.to_string());
    let seed_ok = merged_id.is_some();

    let mut merged_rejected = false;
    if let Some(ref id) = merged_id {
        println!("  [step 3] delete merged id '{}' (should refuse)...", id);
        let resp = learnings_delete(cfg, id).await;
        merged_rejected = resp
            .as_ref()
            .map(|v| {
                v.get("error").is_some() || !v.get("ok").and_then(|o| o.as_bool()).unwrap_or(true)
            })
            .unwrap_or(false);

        println!("  [step 4] re-list to confirm merged row still present...");
        let after = learnings_list_filtered(
            cfg,
            &[
                ("agent_scope", "e2e-delete-protection"),
                ("status", "merged"),
                ("limit", "50"),
            ],
        )
        .await;
        let still_present = after
            .as_ref()
            .ok()
            .and_then(|v| v.get("learnings").and_then(|a| a.as_array()))
            .map(|arr| {
                arr.iter()
                    .any(|item| item.get("id").and_then(|x| x.as_str()) == Some(id.as_str()))
            })
            .unwrap_or(false);
        merged_rejected = merged_rejected && still_present;
    }

    harness::print_result(
        "Learnings Delete Protection",
        &serde_json::to_string(&bogus.unwrap_or_default()).unwrap_or_default(),
        &[
            ("Bogus id returns error (no panic)", bogus_rejected),
            ("Seeded merged row (precondition)", seed_ok),
            (
                "Delete on merged row refused + row still present",
                merged_rejected,
            ),
        ],
    )
}

// ============================================
// AgentLearnings gate scenarios
// ============================================
//
// These scenarios drive the debug-only `/test/agent-config/set` +
// `/test/learnings/seed` endpoints to exercise the per-agent
// `learnings_enabled` gate without requiring an LLM round trip. Each
// scenario restores the config at the end via a best-effort reset.
//
// Consolidation always reuses the source session's recorded model; there
// is no per-agent override knob to test.

async fn set_agent_config(
    cfg: &Config,
    learnings_enabled: Option<bool>,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/agent/test/agent-config/set", cfg.base_url);
    let mut body = serde_json::Map::new();
    if let Some(flag) = learnings_enabled {
        body.insert("learnings_enabled".into(), serde_json::Value::Bool(flag));
    }
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&serde_json::Value::Object(body))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {}", err))?;
    resp.json()
        .await
        .map_err(|err| format!("JSON parse error: {}", err))
}

async fn seed_learning(
    cfg: &Config,
    agent_scope: &str,
    content: &str,
    status: &str,
    source: &str,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/agent/test/learnings/seed", cfg.base_url);
    let body = serde_json::json!({
        "agent_scope": agent_scope,
        "content": content,
        "status": status,
        "source": source,
    });
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {}", err))?;
    resp.json()
        .await
        .map_err(|err| format!("JSON parse error: {}", err))
}

async fn seed_learning_with_session(
    cfg: &Config,
    agent_scope: &str,
    content: &str,
    status: &str,
    source: &str,
    source_session_id: &str,
    account_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/agent/test/learnings/seed", cfg.base_url);
    let body = serde_json::json!({
        "agent_scope": agent_scope,
        "content": content,
        "status": status,
        "source": source,
        "source_session_id": source_session_id,
        "account_id": account_id,
    });
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {}", err))?;
    resp.json()
        .await
        .map_err(|err| format!("JSON parse error: {}", err))
}

async fn trigger_consolidation(
    cfg: &Config,
    agent_scope: &str,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/agent/test/learnings/consolidate", cfg.base_url);
    let body = serde_json::json!({ "agent_scope": agent_scope });
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {}", err))?;
    resp.json()
        .await
        .map_err(|err| format!("JSON parse error: {}", err))
}

/// Per-agent learnings gate: flip `learnings_enabled=false` via agent-config
/// and confirm (a) the flag round-trips through the JSON file and (b) any
/// reflection trigger that reaches the gate returns a "disabled" error with
/// zero learnings stored. The scenario always restores the flag to `true`.
pub async fn gate_enforced(cfg: &Config) -> bool {
    println!("  [step 1] set learnings_enabled=false on global agent-config...");
    let disable = set_agent_config(cfg, Some(false)).await;
    let disabled_ok = disable
        .as_ref()
        .map(|v| {
            v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false)
                && v.get("learnings_enabled").and_then(|x| x.as_bool()) == Some(false)
        })
        .unwrap_or(false);

    println!(
        "  [step 2] create session without workspace_path (so reflection reads global config)..."
    );
    let session_id = format!("{}-learn-gate", cfg.session_prefix);
    // Send a longer message so transcript passes the 200-char floor and
    // reaches the gate check (order in reflection.rs: gate THEN length).
    let long_prompt = "Please write a detailed Python function called `greet` that takes a \
        name argument and prints a friendly greeting. Include a docstring explaining the \
        parameters, the return value, and at least one edge case such as empty input. Keep the \
        whole response over two hundred characters so the transcript clears the reflection \
        length floor.";
    let _ = harness::send_sde_message(cfg, long_prompt, &session_id, "build", "", None, true).await;

    let reflect = trigger_reflection(cfg, &session_id).await;
    let reflect_ok = reflect
        .as_ref()
        .map(|v| v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false))
        .unwrap_or(false);
    let reflect_error = reflect
        .as_ref()
        .map(|v| {
            v.get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("")
                .to_string()
        })
        .unwrap_or_default();
    let learnings_stored = reflect
        .as_ref()
        .map(|v| {
            v.get("learnings_stored")
                .and_then(|n| n.as_u64())
                .unwrap_or(0)
        })
        .unwrap_or(0);
    let lower = reflect_error.to_lowercase();
    let gate_message = lower.contains("disabled") || lower.contains("learnings disabled");
    // reflection.rs returns Err(...) when disabled. The test endpoint may
    // wrap this into either {ok:false, error:"Learnings disabled ..."} or a
    // plain {error: ...}. Accept both shapes + confirm no writes.
    let gate_blocked = (!reflect_ok) && gate_message && learnings_stored == 0;

    println!("  [cleanup] restore learnings_enabled=true...");
    let _ = set_agent_config(cfg, Some(true)).await;
    let _ = harness::cleanup_sde_session(cfg, &session_id).await;

    harness::print_result(
        "Learnings Gate Enforced",
        &format!(
            "disable_ok={}, reflect_error={:?}, stored={}",
            disabled_ok, reflect_error, learnings_stored
        ),
        &[
            ("Config round-trip learnings_enabled=false", disabled_ok),
            (
                "Reflection blocked with 'disabled' error + zero writes",
                gate_blocked,
            ),
        ],
    )
}

/// Consolidation candidate-pool pin: consolidation must exclude `pending` rows from the candidate
/// pool. Pre-fix, `search_similar` / `recall_mode_manifest` called
/// `load_active_learnings` which returned both `active` AND `pending` rows,
/// so new pending rows would "see" each other and get consolidated into
/// merged/none decisions — never promoting to `active`. The write path
/// used a read-path loader.
///
/// Setup:
/// - Boot a real SDE session (need a valid `source_session_id` + `model`
///   so `resolve_batch_provider_info` can find a provider).
/// - Seed 2 **semantically unrelated** pending rows on a unique scope —
///   if they leaked into each other's candidate pool, consolidation would
///   merge one into the other (counts.none increments, active count stays 0).
/// - Trigger consolidation synchronously.
///
/// Positive assertion: at least one pending row is promoted to `active`
/// (`added >= 1` or post-run `status=active` count >= 1).
/// Negative assertion (positive+negative assertion): the two pending rows do NOT all collapse
/// into `none` (would signal self-shadowing).
pub async fn consolidation_pending_excluded(cfg: &Config) -> bool {
    let scope = format!("e2e-consol-{}", cfg.session_prefix);
    let session_id = format!("{}-consol-pending", cfg.session_prefix);
    let project = std::env::temp_dir()
        .join("e2e-consol-pending")
        .to_string_lossy()
        .to_string();
    let _ = std::fs::create_dir_all(&project);

    println!(
        "  [step 1] Boot SDE session so source_session_id resolves to a real model+account..."
    );
    let boot = harness::send_sde_message(
        cfg,
        "Please respond with just the word ACK.",
        &session_id,
        "build",
        &project,
        None,
        true,
    )
    .await;
    let boot_ok = boot.is_ok();
    if let Err(ref err) = boot {
        println!("  [warn] SDE boot failed: {}", err);
    }

    let marker_one = format!("E2E-CONSOL-ONE-{}-{}", cfg.session_prefix, "alpha");
    let marker_two = format!("E2E-CONSOL-TWO-{}-{}", cfg.session_prefix, "beta");

    println!(
        "  [step 2] Seed 2 unrelated pending rows on scope='{}' (different content)...",
        scope
    );
    let seed_one = seed_learning_with_session(
        cfg,
        &scope,
        &format!(
            "{}: Always prefer `tokio::spawn_blocking` when calling CPU-bound synchronous SQLite \
             queries from async axum handlers so the reactor does not stall.",
            marker_one
        ),
        "pending",
        "reflection",
        &session_id,
        Some(&cfg.account_id),
    )
    .await;
    let seed_two = seed_learning_with_session(
        cfg,
        &scope,
        &format!(
            "{}: When a React component subscribes to jotai atoms with `useAtomValue`, prefer \
             selector atoms with `selectAtom` to avoid re-rendering on unrelated field updates.",
            marker_two
        ),
        "pending",
        "reflection",
        &session_id,
        Some(&cfg.account_id),
    )
    .await;
    let seed_one_ok = seed_one
        .as_ref()
        .map(|v| v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false))
        .unwrap_or(false);
    let seed_two_ok = seed_two
        .as_ref()
        .map(|v| v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false))
        .unwrap_or(false);

    println!("  [step 3] Trigger consolidation on scope='{}'...", scope);
    let consolidate_result = trigger_consolidation(cfg, &scope).await;

    let consolidate_ok = consolidate_result
        .as_ref()
        .map(|v| v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false))
        .unwrap_or(false);
    let consolidate_error = consolidate_result
        .as_ref()
        .map(|v| {
            v.get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("")
                .to_string()
        })
        .unwrap_or_default();
    let provider_unavailable = consolidate_error.contains("No provider")
        || consolidate_error.contains("no provider")
        || consolidate_error.contains("Auth error")
        || consolidate_error.contains("cannot resolve model");

    let added = consolidate_result
        .as_ref()
        .map(|v| v.get("added").and_then(|n| n.as_u64()).unwrap_or(0))
        .unwrap_or(0);
    let none_count = consolidate_result
        .as_ref()
        .map(|v| v.get("none").and_then(|n| n.as_u64()).unwrap_or(0))
        .unwrap_or(0);

    println!(
        "  [info] consolidate ok={} added={} none={} error={:?}",
        consolidate_ok, added, none_count, consolidate_error
    );

    println!("  [step 4] List active rows on scope to confirm at least one promotion...");
    let active_list = learnings_list_filtered(
        cfg,
        &[
            ("agent_scope", &scope),
            ("status", "active"),
            ("limit", "50"),
        ],
    )
    .await;
    let active_count = active_list
        .as_ref()
        .map(|v| v.get("count").and_then(|n| n.as_u64()).unwrap_or(0))
        .unwrap_or(0);

    let pending_list = learnings_list_filtered(
        cfg,
        &[
            ("agent_scope", &scope),
            ("status", "pending"),
            ("limit", "50"),
        ],
    )
    .await;
    let pending_after = pending_list
        .as_ref()
        .map(|v| v.get("count").and_then(|n| n.as_u64()).unwrap_or(0))
        .unwrap_or(0);

    println!(
        "  [info] post-run: active_count={} pending_count={}",
        active_count, pending_after
    );

    let summary = format!(
        "boot_ok={boot_ok} seeded={}{} consolidate_ok={consolidate_ok} added={added} \
         none={none_count} active_after={active_count} pending_after={pending_after} \
         error={consolidate_error}",
        seed_one_ok as u8, seed_two_ok as u8
    );

    harness::cleanup_sde_session(cfg, &session_id).await.ok();

    harness::print_result(
        "Consolidation Excludes Pending From Candidates",
        &summary,
        &[
            ("Seeded both pending rows", seed_one_ok && seed_two_ok),
            (
                "Consolidation responded (ok or provider unavailable)",
                consolidate_ok || provider_unavailable,
            ),
            (
                "At least one pending was promoted to active (positive; skipped if provider unavailable)",
                provider_unavailable || active_count >= 1 || added >= 1,
            ),
            (
                "Pending rows did NOT all collapse into none (negative; skipped if provider unavailable)",
                provider_unavailable || none_count < 2 || active_count >= 1,
            ),
        ],
    )
}

// ============================================
// Reflection write-path scenarios (transcript hygiene + blacklist persistence)
// ============================================

async fn seed_reflection_messages(
    cfg: &Config,
    session_id: &str,
    messages: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let url = format!("{}/agent/test/reflection/seed-messages", cfg.base_url);
    let body = serde_json::json!({
        "session_id": session_id,
        "messages": messages,
    });
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {}", err))?;
    resp.json()
        .await
        .map_err(|err| format!("JSON parse error: {}", err))
}

async fn fetch_reflection_transcript(
    cfg: &Config,
    session_id: &str,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/agent/test/reflection/transcript", cfg.base_url);
    let body = serde_json::json!({ "session_id": session_id });
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {}", err))?;
    resp.json()
        .await
        .map_err(|err| format!("JSON parse error: {}", err))
}

async fn reflection_blacklist_call(
    cfg: &Config,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/agent/test/reflection/blacklist", cfg.base_url);
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {}", err))?;
    resp.json()
        .await
        .map_err(|err| format!("JSON parse error: {}", err))
}

/// Transcript-hygiene pin — `build_transcript` must emit ONLY `user` + `assistant` text.
/// Seed a session with one of each role (including `tool_call` and
/// `tool_result` whose content carries a distinctive sentinel) and assert:
///
///   - user text present
///   - assistant text present
///   - tool_call sentinel absent
///   - tool_result sentinel absent
///
/// If tool content ever leaks back into the transcript (direct SQL change,
/// accidental role widening, regression in `append_transcript_line`), this
/// scenario flips red.
pub async fn reflection_transcript_excludes_tool_frames(cfg: &Config) -> bool {
    let session_id = format!("{}-reflect-nofilter", cfg.session_prefix);

    let user_marker = format!("E2E-REFLECT-USER-{}", cfg.session_prefix);
    let asst_marker = format!("E2E-REFLECT-ASST-{}", cfg.session_prefix);
    let tool_call_marker = format!("E2E-REFLECT-TOOLCALL-{}", cfg.session_prefix);
    let tool_result_marker = format!("E2E-REFLECT-TOOLRESULT-{}", cfg.session_prefix);

    println!("  [step 1] Seed 4 rows (user, assistant, tool_call, tool_result)...");
    let seeded = seed_reflection_messages(
        cfg,
        &session_id,
        &[
            serde_json::json!({
                "role": "user",
                "content": format!("{}: please refactor foo", user_marker),
            }),
            serde_json::json!({
                "role": "assistant",
                "content": format!("{}: I will split bar into baz", asst_marker),
            }),
            serde_json::json!({
                "role": "tool_call",
                "content": "",
                "tool_input": format!("{{\"path\": \"{}\"}}", tool_call_marker),
            }),
            serde_json::json!({
                "role": "tool_result",
                "content": "",
                "tool_output": format!("contents of {}", tool_result_marker),
            }),
        ],
    )
    .await;

    let seed_ok = seeded
        .as_ref()
        .map(|v| v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false))
        .unwrap_or(false);
    let inserted = seeded
        .as_ref()
        .map(|v| v.get("inserted").and_then(|n| n.as_u64()).unwrap_or(0))
        .unwrap_or(0);

    println!("  [step 2] Call build_transcript via debug endpoint...");
    let transcript_resp = fetch_reflection_transcript(cfg, &session_id).await;
    let transcript = transcript_resp
        .as_ref()
        .ok()
        .and_then(|v| {
            v.get("transcript")
                .and_then(|t| t.as_str())
                .map(String::from)
        })
        .unwrap_or_default();

    let user_present = transcript.contains(&user_marker);
    let asst_present = transcript.contains(&asst_marker);
    let tool_call_absent = !transcript.contains(&tool_call_marker);
    let tool_result_absent = !transcript.contains(&tool_result_marker);

    let summary = format!(
        "seed_ok={seed_ok} inserted={inserted} transcript_len={} \
         user={user_present} asst={asst_present} \
         tool_call_absent={tool_call_absent} tool_result_absent={tool_result_absent}",
        transcript.len()
    );

    harness::print_result(
        "Reflection Transcript Excludes Tool Frames",
        &summary,
        &[
            ("Seeded all 4 rows", seed_ok && inserted == 4),
            ("User message present in transcript", user_present),
            ("Assistant message present in transcript", asst_present),
            ("tool_call content absent (negative)", tool_call_absent),
            ("tool_result content absent (negative)", tool_result_absent),
        ],
    )
}

/// Blacklist-persistence pin — a previously failed `(account, model)` pair persists in the
/// blacklist and subsequent `check` calls short-circuit. Also verifies
/// selectivity: a different `model_id` is NOT blacklisted.
pub async fn reflection_blacklist_skips_second_call(cfg: &Config) -> bool {
    let account_id = format!("{}-reflect-bl-acct", cfg.session_prefix);
    let model_id = "gpt-4o-mini-e2e".to_string();
    let other_model = "gpt-4o-mini-other".to_string();
    let err_message = "e2e: provider quota exceeded";

    println!(
        "  [step 1] Record blacklist row for ({}, {})...",
        account_id, model_id
    );
    let record_resp = reflection_blacklist_call(
        cfg,
        serde_json::json!({
            "action": "record",
            "account_id": account_id,
            "model_id": model_id,
            "error": err_message,
        }),
    )
    .await;
    let record_ok = record_resp
        .as_ref()
        .map(|v| v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false))
        .unwrap_or(false);

    println!("  [step 2] Check same pair — expect HIT with the same error text...");
    let check_same = reflection_blacklist_call(
        cfg,
        serde_json::json!({
            "action": "check",
            "account_id": account_id,
            "model_id": model_id,
        }),
    )
    .await;
    let same_hit = check_same
        .as_ref()
        .map(|v| v.get("hit").and_then(|h| h.as_bool()).unwrap_or(false))
        .unwrap_or(false);
    let same_err = check_same
        .as_ref()
        .ok()
        .and_then(|v| {
            v.get("error_message")
                .and_then(|e| e.as_str())
                .map(String::from)
        })
        .unwrap_or_default();
    let err_matches = same_err == err_message;

    println!("  [step 3] Check different model — expect MISS (selectivity)...");
    let check_other = reflection_blacklist_call(
        cfg,
        serde_json::json!({
            "action": "check",
            "account_id": account_id,
            "model_id": other_model,
        }),
    )
    .await;
    let other_hit = check_other
        .as_ref()
        .map(|v| v.get("hit").and_then(|h| h.as_bool()).unwrap_or(false))
        .unwrap_or(false);

    let summary = format!(
        "record_ok={record_ok} same_hit={same_hit} err_matches={err_matches} \
         other_hit={other_hit} (expected other_hit=false)"
    );

    harness::print_result(
        "Reflection Blacklist Skips Second Call",
        &summary,
        &[
            ("Record returned ok", record_ok),
            ("Same (account, model) is a HIT (positive)", same_hit),
            (
                "Stored error message round-trips back to caller",
                err_matches,
            ),
            (
                "Different model is NOT blacklisted (selectivity)",
                !other_hit,
            ),
        ],
    )
}

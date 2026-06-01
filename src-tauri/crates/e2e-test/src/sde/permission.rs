//! E2E scenarios for the permission system:
//! - Deny → agent continues with denial message
//! - Allow → tool executes, agent uses result
//! - AlwaysAllow → rule persisted, subsequent calls auto-approved
//! - Permission ask visibility

use super::tmp_workspace_path;
use crate::config::Config;
use crate::harness;

const CONFIRMATION_COMMAND: &str = "git push --dry-run origin HEAD";

/// Spawn a background poller that waits for a permission request on the given
/// session and responds with the specified action. Returns a JoinHandle whose
/// output is `(responded: bool, request_id: Option<String>)`.
fn spawn_permission_responder(
    cfg: &Config,
    session_id: &str,
    response: &str,
    tool_name: Option<&str>,
    tool_args: Option<serde_json::Value>,
) -> tokio::task::JoinHandle<(bool, Option<String>)> {
    let base_url = cfg.base_url.clone();
    let sid = session_id.to_string();
    let resp_str = response.to_string();
    let tname = tool_name.map(String::from);
    let targs = tool_args;

    tokio::spawn(async move {
        for _ in 0..120 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;

            let pending = match harness::check_permission_pending(&base_url, &sid).await {
                Ok(p) => p,
                Err(_) => continue,
            };

            if pending.pending && !pending.request_ids.is_empty() {
                let req_id = &pending.request_ids[0];
                let ok = harness::send_permission_response(
                    &base_url,
                    &sid,
                    req_id,
                    &resp_str,
                    tname.as_deref(),
                    targs,
                )
                .await
                .unwrap_or(false);

                return (ok, Some(req_id.clone()));
            }
        }
        (false, None)
    })
}

/// Permission Deny — when user denies a tool, agent should continue
/// with a denial message instead of freezing.
pub async fn permission_deny(cfg: &Config) -> bool {
    let session_id = format!("{}-perm-deny", cfg.session_prefix);
    let project = tmp_workspace_path("perm-deny");

    println!("  [step 1] Starting agent with tool that needs permission + deny poller...");
    let responder = spawn_permission_responder(
        cfg,
        &session_id,
        "deny",
        Some("run_shell"),
        Some(serde_json::json!({ "command": CONFIRMATION_COMMAND })),
    );

    let result = harness::send_sde_message(
        cfg,
        &format!("Run this exact shell command and report the result: {CONFIRMATION_COMMAND}"),
        &session_id,
        "build",
        &project,
        None,
        false,
    )
    .await;

    let (responded, _req_id) = responder.await.unwrap_or((false, None));

    match result {
        Err(err) => harness::print_error("Permission Deny", &err),
        Ok(resp) => {
            let content = resp.content.to_lowercase();
            let agent_continued = !content.is_empty();
            let mentions_denied = content.contains("denied")
                || content.contains("permission")
                || content.contains("refused")
                || content.contains("cannot")
                || content.contains("not allowed")
                || content.contains("unable");

            harness::print_result(
                "Permission Deny",
                &resp.content,
                &[
                    ("Poller responded to permission request", responded),
                    ("Agent continued (did NOT freeze)", agent_continued),
                    ("Response acknowledges denial", mentions_denied),
                ],
            )
        }
    }
}

/// Permission Allow — when user allows a tool, it executes normally.
pub async fn permission_allow(cfg: &Config) -> bool {
    let session_id = format!("{}-perm-allow", cfg.session_prefix);
    let project = tmp_workspace_path("perm-allow");

    println!("  [step 1] Starting agent with tool that needs permission + allow poller...");
    let responder = spawn_permission_responder(
        cfg,
        &session_id,
        "allow",
        Some("run_shell"),
        Some(serde_json::json!({ "command": CONFIRMATION_COMMAND })),
    );

    let result = harness::send_sde_message(
        cfg,
        &format!("Run this exact shell command and report the result: {CONFIRMATION_COMMAND}"),
        &session_id,
        "build",
        &project,
        None,
        false,
    )
    .await;

    let (responded, _req_id) = responder.await.unwrap_or((false, None));

    match result {
        Err(err) => harness::print_error("Permission Allow", &err),
        Ok(resp) => {
            let content = resp.content.to_lowercase();
            let used_shell = harness::assert_sde_tool_used(&resp, "run_shell");
            let did_not_short_circuit = !content.contains("requires confirmation before execution")
                && !content.contains("permission denied");

            harness::print_result(
                "Permission Allow",
                &resp.content,
                &[
                    ("Poller responded to permission request", responded),
                    ("run_shell was called", used_shell),
                    (
                        "Command was not pre-emptively denied",
                        did_not_short_circuit,
                    ),
                ],
            )
        }
    }
}

pub async fn permission_command_confirmation_allow(cfg: &Config) -> bool {
    let session_id = format!("{}-perm-command-confirm", cfg.session_prefix);
    let project = tmp_workspace_path("perm-command-confirm");
    println!("  [step 1] Starting agent with confirmation command + allow poller...");
    let responder = spawn_permission_responder(
        cfg,
        &session_id,
        "allow",
        Some("run_shell"),
        Some(serde_json::json!({ "command": CONFIRMATION_COMMAND })),
    );

    let result = harness::send_sde_message(
        cfg,
        &format!("Run this exact shell command and report the result: {CONFIRMATION_COMMAND}"),
        &session_id,
        "build",
        &project,
        None,
        false,
    )
    .await;

    let (responded, _req_id) = responder.await.unwrap_or((false, None));

    match result {
        Err(err) => harness::print_error("Permission Command Confirmation Allow", &err),
        Ok(resp) => {
            let content = resp.content.to_lowercase();
            let used_shell = harness::assert_sde_tool_used(&resp, "run_shell");
            let did_not_short_circuit = !content.contains("requires confirmation before execution")
                && !content.contains("permission denied");

            harness::print_result(
                "Permission Command Confirmation Allow",
                &resp.content,
                &[
                    ("Poller responded to permission request", responded),
                    ("run_shell was called", used_shell),
                    (
                        "Command was not pre-emptively denied",
                        did_not_short_circuit,
                    ),
                ],
            )
        }
    }
}

/// Permission AlwaysAllow — first call prompts, second call auto-approves.
/// Validates that session rules are applied for subsequent tool calls.
pub async fn permission_always_allow(cfg: &Config) -> bool {
    let session_id = format!("{}-perm-always", cfg.session_prefix);
    let project = tmp_workspace_path("perm-always");

    // Clean up any persisted permissions from previous runs so turn 1 is fresh
    let orgii_dir = std::path::Path::new(&project).join(".orgii");
    let perm_file = orgii_dir.join("permissions.json");
    if perm_file.exists() {
        let _ = std::fs::remove_file(&perm_file);
        println!("  [cleanup] Removed stale {}", perm_file.display());
    }

    // Turn 1: AlwaysAllow the first permission request
    println!("  [step 1] Turn 1: AlwaysAllow for first shell command...");
    let responder = spawn_permission_responder(
        cfg,
        &session_id,
        "always_allow",
        Some("run_shell"),
        Some(serde_json::json!({ "command": CONFIRMATION_COMMAND })),
    );

    let turn1 = harness::send_sde_message(
        cfg,
        &format!("Run this exact shell command and report the result: {CONFIRMATION_COMMAND}"),
        &session_id,
        "build",
        &project,
        None,
        true, // keep session alive
    )
    .await;

    let (responded_t1, _) = responder.await.unwrap_or((false, None));

    // Turn 2: Should auto-approve because of the AlwaysAllow rule
    println!("  [step 2] Turn 2: Should auto-approve (no permission prompt)...");

    // We do NOT spawn a responder — if auto-approve works, no prompt appears.
    // If it fails, the request will time out.
    let turn2 = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        harness::send_sde_message(
            cfg,
            &format!("Run this exact shell command and report the result: {CONFIRMATION_COMMAND}"),
            &session_id,
            "build",
            &project,
            None,
            false,
        ),
    )
    .await;

    let turn2_ok = match &turn2 {
        Ok(Ok(resp)) => {
            let lower = resp.content.to_lowercase();
            !lower.contains("requires confirmation before execution")
                && !lower.contains("permission denied")
        }
        _ => false,
    };

    let turn2_content = match &turn2 {
        Ok(Ok(resp)) => resp.content.clone(),
        Ok(Err(err)) => format!("Error: {err}"),
        Err(_) => "Timed out (permission not auto-approved)".to_string(),
    };

    harness::print_result(
        "Permission AlwaysAllow",
        &turn2_content,
        &[
            ("Turn 1: poller responded to permission", responded_t1),
            ("Turn 1: got response", turn1.is_ok()),
            ("Turn 2: auto-approved (no prompt needed)", turn2_ok),
        ],
    )
}

/// Permission Ask Visibility — verify that tools with Ask verdict appear
/// in tool schemas (not hidden from the LLM).
pub async fn permission_ask_visibility(cfg: &Config) -> bool {
    let session_id = format!("{}-perm-ask-vis", cfg.session_prefix);
    let project = tmp_workspace_path("perm-ask-vis");
    let _ = std::fs::create_dir_all(&project);

    println!("  [step 1] Initializing session...");

    // Spawn a responder in case the greeting triggers a tool call
    let responder = spawn_permission_responder(cfg, &session_id, "allow", None, None);

    let init = harness::send_sde_message(
        cfg,
        "Say hello. Just a brief greeting.",
        &session_id,
        "build",
        &project,
        None,
        true,
    )
    .await;

    // Cancel the responder — we don't care about its result
    responder.abort();

    if let Err(err) = &init {
        return harness::print_error("Permission Ask Visibility", err);
    }

    println!("  [step 2] Fetching session-scoped effective tools...");
    match harness::fetch_effective_tools(cfg, &session_id, "build").await {
        Err(err) => harness::print_error("Permission Ask Visibility", &err),
        Ok(effective_tools) => {
            let has_tool = |name: &str| -> bool {
                effective_tools
                    .prompt_tool_names
                    .iter()
                    .any(|tool_name| tool_name == name)
            };

            let has_run_shell = has_tool("run_shell");
            let has_read_file = has_tool("read_file");
            let has_edit_file = has_tool("edit_file");

            harness::print_result(
                "Permission Ask Visibility",
                &format!(
                    "Prompt tool count: {}",
                    effective_tools.prompt_tool_names.len()
                ),
                &[
                    (
                        "run_shell present in effective tools (Ask verdict does NOT hide it)",
                        has_run_shell,
                    ),
                    (
                        "read_file present in effective tools (Allow verdict)",
                        has_read_file,
                    ),
                    (
                        "edit_file present in effective tools (Allow verdict)",
                        has_edit_file,
                    ),
                    (
                        "Has effective prompt tools",
                        !effective_tools.prompt_tool_names.is_empty(),
                    ),
                ],
            )
        }
    }
}

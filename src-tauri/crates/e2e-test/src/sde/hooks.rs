//! E2E scenarios for hook runtime behavior.

use super::tmp_workspace_path;
use crate::config::Config;
use crate::harness;
use std::path::Path;

/// Hook Stop Event — verify that `HookEvent::Stop` fires at turn end
/// by configuring a command hook that writes a marker file. After a single-turn
/// SDE message, the marker file should exist on disk.
pub async fn hook_stop_fires(cfg: &Config) -> bool {
    let session_id = format!("{}-hook-stop", cfg.session_prefix);
    let project = tmp_workspace_path("hook-stop");
    let _ = std::fs::create_dir_all(&project);

    let orgii_dir = Path::new(&project).join(".orgii");
    let _ = std::fs::create_dir_all(&orgii_dir);

    let marker_path = Path::new(&project).join("stop_hook_fired.txt");
    let _ = std::fs::remove_file(&marker_path);

    let hooks_config = serde_json::json!({
        "hooks": {
            "stop": [
                {
                    "type": "command",
                    "command": format!(
                        "echo \"turn=$ORGII_TURN_ID tokens=$ORGII_TOTAL_TOKENS\" > {}",
                        marker_path.display()
                    ),
                    "timeout_ms": 5000
                }
            ]
        }
    });

    if let Err(err) = std::fs::write(
        orgii_dir.join("hooks.json"),
        serde_json::to_string_pretty(&hooks_config).unwrap(),
    ) {
        return harness::print_error(
            "Hook Stop Fires",
            &format!("Failed to write hooks.json: {err}"),
        );
    }

    match harness::send_sde_message(
        cfg,
        "Say hello and nothing else.",
        &session_id,
        "build",
        &project,
        None,
        false,
    )
    .await
    {
        Err(err) => harness::print_error("Hook Stop Fires", &err),
        Ok(resp) => {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;

            let marker_exists = marker_path.exists();
            let marker_content = if marker_exists {
                match std::fs::read_to_string(&marker_path) {
                    Ok(content) => content,
                    Err(err) => {
                        println!(
                            "  [warn] hook marker exists but read failed: {} ({err})",
                            marker_path.display()
                        );
                        String::new()
                    }
                }
            } else {
                String::new()
            };

            harness::print_result(
                "Hook Stop Fires",
                &resp.content,
                &[
                    ("Got response", !resp.content.is_empty()),
                    ("Stop hook marker file created", marker_exists),
                    ("Marker contains turn ID", marker_content.contains("turn=")),
                    (
                        "Marker contains token count",
                        marker_content.contains("tokens="),
                    ),
                ],
            )
        }
    }
}

/// Hook Deny Blocks Tool — a `pre_tool_use` hook returning
/// `{"decision":"deny"}` should block the tool call and the agent should
/// see the block message and not execute the tool.
pub async fn hook_deny_blocks_tool(cfg: &Config) -> bool {
    let session_id = format!("{}-hook-deny", cfg.session_prefix);
    let project = tmp_workspace_path("hook-deny");
    let _ = std::fs::create_dir_all(&project);

    let orgii_dir = Path::new(&project).join(".orgii");
    let _ = std::fs::create_dir_all(&orgii_dir);

    let hooks_config = serde_json::json!({
        "hooks": {
            "pre_tool_use": [
                {
                    "type": "command",
                    "command": "echo '{\"decision\":\"deny\",\"message\":\"Dangerous command blocked by policy\"}'",
                    "timeout_ms": 5000
                }
            ]
        }
    });

    if let Err(err) = std::fs::write(
        orgii_dir.join("hooks.json"),
        serde_json::to_string_pretty(&hooks_config).unwrap(),
    ) {
        return harness::print_error(
            "Hook Deny Blocks Tool",
            &format!("Failed to write hooks.json: {err}"),
        );
    }

    match harness::send_sde_message(
        cfg,
        "Run `echo hello` in the shell.",
        &session_id,
        "build",
        &project,
        None,
        false,
    )
    .await
    {
        Err(err) => harness::print_error("Hook Deny Blocks Tool", &err),
        Ok(resp) => {
            let content_lower = resp.content.to_lowercase();
            harness::print_result(
                "Hook Deny Blocks Tool",
                &resp.content,
                &[
                    ("Got response", !resp.content.is_empty()),
                    (
                        "Agent mentions blocked/denied/policy",
                        content_lower.contains("block")
                            || content_lower.contains("denied")
                            || content_lower.contains("policy"),
                    ),
                ],
            )
        }
    }
}

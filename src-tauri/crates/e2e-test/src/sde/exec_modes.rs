//! `AgentExecMode` policy-enforcement scenarios for the SDE endpoint.
//!
//! These pin the end-to-end contract that mode-specific tool policy is enforced
//! at turn execution time. UI-only plan lifecycle flows belong in WDIO.

use super::tmp_workspace_path;
use crate::config::Config;
use crate::harness;

/// Plan mode must hide source-write tools from the prompt tool surface while
/// still exposing plan-authoring tools.
pub async fn plan_mode_denies_writes(cfg: &Config) -> bool {
    let session_id = format!("{}-plan-denies-writes", cfg.session_prefix);
    let project = tmp_workspace_path("plan-denies-writes");

    let target_rel = "PLAN_MODE_TARGET.md";
    let target_abs = std::path::Path::new(&project).join(target_rel);
    let _ = std::fs::write(&target_abs, "original contents\n");

    let prompt = format!(
        "You are in plan mode. The file to target is exactly `{}`. \
         Explain whether you can edit it in this mode. Do not use shell tools.",
        target_abs.display()
    );

    let resp =
        harness::send_sde_message(cfg, &prompt, &session_id, "plan", &project, None, true).await;
    let effective_tools = harness::fetch_effective_tools(cfg, &session_id, "plan").await;
    let _ = harness::cleanup_sde_session(cfg, &session_id).await;

    let (content, edit_called, shell_called) =
        resp.as_ref()
            .map_or((String::new(), true, true), |response| {
                (
                    response.content.clone(),
                    harness::assert_sde_tool_used(response, "edit_file"),
                    harness::assert_sde_tool_used(response, "run_shell"),
                )
            });

    let file_unchanged = std::fs::read_to_string(&target_abs)
        .map(|contents| !contents.contains("EDIT ATTEMPT"))
        .unwrap_or(false);

    let (
        effective_mode,
        registered_has_edit_file,
        prompt_has_create_plan,
        prompt_has_edit_file,
        prompt_has_run_shell,
    ) = effective_tools
        .as_ref()
        .map_or((String::new(), false, false, true, true), |tools| {
            (
                tools.agent_exec_mode.clone(),
                tools
                    .registered_tool_names
                    .iter()
                    .any(|name| name == "edit_file"),
                tools
                    .prompt_tool_names
                    .iter()
                    .any(|name| name == "create_plan"),
                tools
                    .prompt_tool_names
                    .iter()
                    .any(|name| name == "edit_file"),
                tools
                    .prompt_tool_names
                    .iter()
                    .any(|name| name == "run_shell"),
            )
        });

    harness::print_result(
        "Plan mode hides source-write tools from prompt surface",
        &content,
        &[
            ("HTTP succeeded", resp.is_ok()),
            ("Got non-empty response", !content.is_empty()),
            ("Effective tools HTTP succeeded", effective_tools.is_ok()),
            ("Effective mode is plan", effective_mode == "plan"),
            (
                "Registry still contains edit_file for other modes",
                registered_has_edit_file,
            ),
            ("Prompt tools include create_plan", prompt_has_create_plan),
            ("Prompt tools exclude edit_file", !prompt_has_edit_file),
            ("Prompt tools exclude run_shell", !prompt_has_run_shell),
            ("edit_file was NOT called", !edit_called),
            ("run_shell was NOT called", !shell_called),
            ("Non-plan target file unchanged on disk", file_unchanged),
        ],
    )
}

/// Plan mode must write the draft plan through `create_plan`, producing a
/// real file under `{project}/.orgii/plans/*.plan.md`.
pub async fn plan_mode_writes_to_plan_file(cfg: &Config) -> bool {
    let session_id = format!("{}-plan-writes", cfg.session_prefix);
    let project = tmp_workspace_path("plan-writes");

    let plans_dir = std::path::Path::new(&project).join(".orgii").join("plans");
    let _ = std::fs::remove_dir_all(&plans_dir);

    let marker = "REFACTOR_HTTP_CLIENT_MODULE";
    let prompt = format!(
        "You are in plan mode. Draft a short implementation plan titled \
         '{marker}'. Use the `create_plan` tool to persist it. The plan \
         body should cover: context, approach, and risks."
    );

    let resp =
        harness::send_sde_message(cfg, &prompt, &session_id, "plan", &project, None, false).await;

    let (content, create_called, edit_called, shell_called) =
        resp.as_ref()
            .map_or((String::new(), false, true, true), |response| {
                (
                    response.content.clone(),
                    harness::assert_sde_tool_used(response, "create_plan"),
                    harness::assert_sde_tool_used(response, "edit_file"),
                    harness::assert_sde_tool_used(response, "run_shell"),
                )
            });

    let plan_files: Vec<std::path::PathBuf> = std::fs::read_dir(&plans_dir)
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok())
                .map(|entry| entry.path())
                .filter(|path| {
                    path.file_name()
                        .and_then(|name| name.to_str())
                        .map(|name| name.ends_with(".plan.md"))
                        .unwrap_or(false)
                })
                .collect()
        })
        .unwrap_or_default();

    let plan_file = plan_files.first().cloned();
    let has_one_plan_file = plan_files.len() == 1;
    let plan_nonempty = plan_file
        .as_ref()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|contents| !contents.trim().is_empty())
        .unwrap_or(false);
    let plan_contains_title = plan_file
        .as_ref()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|contents| contents.contains(marker))
        .unwrap_or(false);

    let no_stray_md_at_root = std::fs::read_dir(&project)
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok())
                .filter(|entry| {
                    entry
                        .path()
                        .extension()
                        .and_then(|extension| extension.to_str())
                        .map(|extension| extension.eq_ignore_ascii_case("md"))
                        .unwrap_or(false)
                })
                .count()
                == 0
        })
        .unwrap_or(false);

    harness::print_result(
        "Plan mode writes draft to .orgii/plans/*.plan.md",
        &content,
        &[
            ("HTTP succeeded", resp.is_ok()),
            ("create_plan WAS called", create_called),
            ("edit_file was NOT called", !edit_called),
            ("run_shell was NOT called", !shell_called),
            (
                "Exactly one plan file under .orgii/plans",
                has_one_plan_file,
            ),
            ("Plan file non-empty", plan_nonempty),
            (
                "Plan file contains the requested title",
                plan_contains_title,
            ),
            (
                "No stray .md at workspace root (plan lives in .orgii/plans)",
                no_stray_md_at_root,
            ),
        ],
    )
}

/// `create_plan` must mark the pending approval snapshot ready on its own.
pub async fn create_plan_marks_ready_for_approval(cfg: &Config) -> bool {
    let session_id = format!("{}-plan-create-mark-ready", cfg.session_prefix);
    let project = tmp_workspace_path("plan-create-mark-ready");

    let prompt = "You are in plan mode. Use `create_plan` to draft and persist \
        a one-page plan titled 'SCAFFOLD_NEW_MODULE'. Do NOT call any other \
        tools after `create_plan` — it will submit the plan for review \
        automatically.";

    let resp =
        harness::send_sde_message(cfg, prompt, &session_id, "plan", &project, None, true).await;

    let snap = harness::wait_for_plan_approval(&cfg.base_url, &session_id, 30)
        .await
        .unwrap_or(harness::PlanApprovalPending {
            pending: false,
            plan_path: None,
            plan_title: None,
            plan_content: None,
            tool_call_id: None,
        });

    let approve_ok = if snap.pending {
        harness::send_plan_approval_response(&cfg.base_url, &session_id, "approve", None)
            .await
            .is_ok()
    } else {
        false
    };

    let post_consume = harness::wait_for_plan_approval(&cfg.base_url, &session_id, 2)
        .await
        .map(|snapshot| snapshot.pending)
        .unwrap_or(true);
    let snapshot_consumed = !post_consume;

    let _ = harness::cleanup_sde_session(cfg, &session_id).await;

    let (content, create_called) = resp.as_ref().map_or((String::new(), false), |response| {
        (
            response.content.clone(),
            harness::assert_sde_tool_used(response, "create_plan"),
        )
    });

    let plan_file_exists = snap
        .plan_path
        .as_deref()
        .map(|path| std::path::Path::new(path).exists())
        .unwrap_or(false);
    let plan_title_matches = snap
        .plan_title
        .as_deref()
        .map(|title| title.contains("SCAFFOLD_NEW_MODULE") || title.contains("scaffold"))
        .unwrap_or(false);
    let plan_content_non_empty = snap
        .plan_content
        .as_deref()
        .map(|content| !content.trim().is_empty())
        .unwrap_or(false);
    let tool_call_id_set = snap
        .tool_call_id
        .as_deref()
        .map(|tool_call_id| !tool_call_id.is_empty())
        .unwrap_or(false);

    let parent_create_plan_id = resp.as_ref().ok().and_then(|response| {
        response
            .last_tool_call_id("create_plan")
            .map(|id| id.to_string())
    });
    let snapshot_id = snap.tool_call_id.clone();
    let tool_call_ids_match = match (parent_create_plan_id.as_deref(), snapshot_id.as_deref()) {
        (Some(parent_id), Some(snapshot_id)) => {
            !parent_id.is_empty() && !snapshot_id.is_empty() && parent_id == snapshot_id
        }
        _ => false,
    };

    harness::print_result(
        "create_plan marks the snapshot ready; Build consumes it",
        &content,
        &[
            ("HTTP succeeded", resp.is_ok()),
            ("create_plan WAS called", create_called),
            (
                "Pending plan-approval snapshot is visible after the turn",
                snap.pending,
            ),
            ("Approve (Build) response succeeded", approve_ok),
            (
                "Snapshot cleared after Build (take_pending consumed it)",
                snapshot_consumed,
            ),
            (
                "Plan file reported by endpoint exists on disk",
                plan_file_exists,
            ),
            (
                "Pending snapshot carried a plan title matching the prompt",
                plan_title_matches,
            ),
            (
                "Pending snapshot carried non-empty plan content",
                plan_content_non_empty,
            ),
            (
                "Pending snapshot carried a tool_call_id for UI correlation",
                tool_call_id_set,
            ),
            (
                "Pending snapshot tool_call_id matches the parent's create_plan tool_call_id",
                tool_call_ids_match,
            ),
        ],
    )
}

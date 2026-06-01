//! E2E scenarios for the session-workspace mutators.
//!
//! These scenarios drive `POST /agent/test/session/workspace/*`
//! directly (no LLM turn) so they run in sub-second time and are
//! deterministic. Each scenario bootstraps a real SDE session with
//! `no_cleanup: true` so the in-memory `SessionRuntime` (and its
//! `workspace_state` handle) is alive for the subsequent mutator
//! calls, then cleans up at the end.
//!
//! Two pins:
//!
//! 1. `workspace-add-directory-persists` — positive + negative path:
//!    * adding a new directory returns `inserted=true` AND surfaces
//!      in the `list` view with the caller-specified source;
//!    * re-adding the same path returns `inserted=false`
//!      (first-writer-wins: the original `source` tag for the entry is
//!      preserved) AND does NOT duplicate the list entry;
//!    * an unrelated control path does NOT appear (negative-half
//!      match — proves the list actually filters to what we added).
//!
//! 2. `workspace-remove-directory` — positive + negative path:
//!    * removing an added directory returns `removed=true` AND drops
//!      it from `list`;
//!    * removing the same path again returns `removed=false`
//!      (idempotent no-op, not an error);
//!    * a sibling directory we deliberately kept survives the remove
//!      (negative-half match — proves remove only touches the key
//!      it was asked about).

use super::tmp_workspace_path;
use crate::config::Config;
use crate::harness;

/// Bootstrap an SDE session so the in-memory `SessionRuntime` exists.
/// Uses an intentionally trivial prompt to keep the turn short; the
/// scenarios don't care about the LLM output, only that the runtime
/// (and its `workspace_state`) has been created.
async fn bootstrap_runtime(cfg: &Config, session_id: &str, project: &str) -> Result<(), String> {
    harness::send_sde_message(
        cfg,
        "Reply with the single word READY and do not call any tools.",
        session_id,
        "build",
        project,
        None,
        true,
    )
    .await
    .map(|_| ())
}

pub async fn workspace_add_directory_persists(cfg: &Config) -> bool {
    let session_id = format!("{}-ws-add", cfg.session_prefix);
    let project = tmp_workspace_path("ws-add");

    if let Err(err) = bootstrap_runtime(cfg, &session_id, &project).await {
        return harness::print_error("Workspace: add-directory persists", &err);
    }

    // Two distinct paths under /tmp — one we'll add, one we won't
    // touch so we can prove the list only reflects real mutations.
    let added_path = std::env::temp_dir()
        .join("e2e-ws-add-peer")
        .to_string_lossy()
        .to_string();
    let control_path = std::env::temp_dir()
        .join("e2e-ws-add-CONTROL-never-added")
        .to_string_lossy()
        .to_string();

    // ── 1. add with explicit "localSettings" source ─────────────────
    let add_first = match harness::workspace_add_directory(
        cfg,
        &session_id,
        &added_path,
        Some("localSettings"),
    )
    .await
    {
        Ok(r) => r,
        Err(err) => {
            let _ = harness::cleanup_sde_session(cfg, &session_id).await;
            return harness::print_error("Workspace: add-directory persists", &err);
        }
    };
    let first_ok = add_first.ok && add_first.inserted;

    // ── 2. re-add same path: inserted must be false ────────────────
    let add_second = match harness::workspace_add_directory(
        cfg,
        &session_id,
        &added_path,
        Some("session"),
    )
    .await
    {
        Ok(r) => r,
        Err(err) => {
            let _ = harness::cleanup_sde_session(cfg, &session_id).await;
            return harness::print_error("Workspace: add-directory persists", &err);
        }
    };
    let second_ok = add_second.ok && !add_second.inserted;

    // ── 3. list view: positive + negative presence ─────────────────
    let list = match harness::workspace_list(cfg, &session_id).await {
        Ok(r) => r,
        Err(err) => {
            let _ = harness::cleanup_sde_session(cfg, &session_id).await;
            return harness::print_error("Workspace: add-directory persists", &err);
        }
    };
    let list_ok = list.ok;
    let contains_added = list.additional_paths.iter().any(|p| p == &added_path);
    let does_not_contain_control = !list.additional_paths.iter().any(|p| p == &control_path);
    // First writer wins: the original "localSettings" source must
    // persist even after the second add tried to overwrite with
    // "session".
    let source_first_writer_wins = list
        .additional_paths
        .iter()
        .zip(list.additional_sources.iter())
        .any(|(path, source)| path == &added_path && source == "localSettings");
    // No duplicates: the added path appears exactly once.
    let no_duplicates = list
        .additional_paths
        .iter()
        .filter(|p| *p == &added_path)
        .count()
        == 1;

    let combined = format!(
        "first={:?} err={:?}\nsecond={:?} err={:?}\nlist_paths={:?}\nlist_sources={:?}\nlist_err={:?}",
        add_first,
        add_first.error,
        add_second,
        add_second.error,
        list.additional_paths,
        list.additional_sources,
        list.error,
    );

    let _ = harness::cleanup_sde_session(cfg, &session_id).await;

    harness::print_result(
        "Workspace: add-directory persists",
        &combined,
        &[
            ("First add returns ok=true, inserted=true", first_ok),
            ("Duplicate add returns ok=true, inserted=false", second_ok),
            ("List endpoint returns ok=true", list_ok),
            ("List contains added path", contains_added),
            (
                "List does NOT contain unrelated control path",
                does_not_contain_control,
            ),
            (
                "Source of added path is 'localSettings' (first-writer-wins)",
                source_first_writer_wins,
            ),
            ("Added path appears exactly once in list", no_duplicates),
        ],
    )
}

pub async fn workspace_remove_directory(cfg: &Config) -> bool {
    let session_id = format!("{}-ws-rm", cfg.session_prefix);
    let project = tmp_workspace_path("ws-rm");

    if let Err(err) = bootstrap_runtime(cfg, &session_id, &project).await {
        return harness::print_error("Workspace: remove-directory", &err);
    }

    let target_path = std::env::temp_dir()
        .join("e2e-ws-rm-target")
        .to_string_lossy()
        .to_string();
    // A sibling directory we keep around through the remove; proves
    // `remove_directory` is path-specific and doesn't nuke the whole
    // map.
    let sibling_path = std::env::temp_dir()
        .join("e2e-ws-rm-sibling")
        .to_string_lossy()
        .to_string();

    // Seed two additional dirs so we have something to contrast
    // against.
    if let Err(err) = harness::workspace_add_directory(cfg, &session_id, &target_path, None).await {
        let _ = harness::cleanup_sde_session(cfg, &session_id).await;
        return harness::print_error("Workspace: remove-directory", &err);
    }
    if let Err(err) = harness::workspace_add_directory(cfg, &session_id, &sibling_path, None).await
    {
        let _ = harness::cleanup_sde_session(cfg, &session_id).await;
        return harness::print_error("Workspace: remove-directory", &err);
    }

    // ── 1. first remove: removed=true ──────────────────────────────
    let remove_first =
        match harness::workspace_remove_directory(cfg, &session_id, &target_path).await {
            Ok(r) => r,
            Err(err) => {
                let _ = harness::cleanup_sde_session(cfg, &session_id).await;
                return harness::print_error("Workspace: remove-directory", &err);
            }
        };
    let first_removed = remove_first.ok && remove_first.removed;

    // ── 2. second remove on same path: removed=false (idempotent) ─
    let remove_second =
        match harness::workspace_remove_directory(cfg, &session_id, &target_path).await {
            Ok(r) => r,
            Err(err) => {
                let _ = harness::cleanup_sde_session(cfg, &session_id).await;
                return harness::print_error("Workspace: remove-directory", &err);
            }
        };
    let second_is_noop = remove_second.ok && !remove_second.removed;

    // ── 3. list: target gone, sibling kept ─────────────────────────
    let list = match harness::workspace_list(cfg, &session_id).await {
        Ok(r) => r,
        Err(err) => {
            let _ = harness::cleanup_sde_session(cfg, &session_id).await;
            return harness::print_error("Workspace: remove-directory", &err);
        }
    };
    let target_gone = !list.additional_paths.iter().any(|p| p == &target_path);
    let sibling_kept = list.additional_paths.iter().any(|p| p == &sibling_path);

    let combined = format!(
        "first_remove={:?} err={:?}\nsecond_remove={:?} err={:?}\nlist_paths={:?}",
        remove_first, remove_first.error, remove_second, remove_second.error, list.additional_paths,
    );

    let _ = harness::cleanup_sde_session(cfg, &session_id).await;

    harness::print_result(
        "Workspace: remove-directory",
        &combined,
        &[
            ("First remove returns ok=true, removed=true", first_removed),
            (
                "Second remove returns ok=true, removed=false (idempotent)",
                second_is_noop,
            ),
            ("Target path no longer in list", target_gone),
            ("Sibling path still in list", sibling_kept),
        ],
    )
}

/// Prove that `add_workspace_directory` mid-session
/// surfaces in the next-turn SDE system prompt `## Environment`
/// block. Rules covered:
///
/// - positive-half: seeded path appears in the rendered block
///   after the mutator call.
/// - negative-half: an unrelated control path does NOT appear
///   (the block only lists what was actually added).
/// - Pre-mutation negative: before `add_workspace_directory`
///   is called, the block must NOT already contain the header —
///   proves the "empty → omit" code path and that we're not
///   leaking some stale default.
/// - Caller-path coverage: drives the same `UnifiedPromptBuilder`
///   the processor invokes in `build_system_prompt`, not the
///   section helper in isolation. The debug endpoint reads
///   `runtime.workspace_state` directly — same source the hot
///   path does — so a passing test proves the whole chain
///   `mutator → Arc<RwLock<SessionWorkspace>> → SystemPromptConfig
///   → build_project_environment` is wired.
pub async fn prompt_surfaces_additional_dirs(cfg: &Config) -> bool {
    let session_id = format!("{}-ws-prompt", cfg.session_prefix);
    let project = tmp_workspace_path("ws-prompt");

    if let Err(err) = bootstrap_runtime(cfg, &session_id, &project).await {
        return harness::print_error("Workspace: prompt surfaces additional dirs", &err);
    }

    let added_path = std::env::temp_dir()
        .join("e2e-ws-prompt-added")
        .to_string_lossy()
        .to_string();
    let control_path = std::env::temp_dir()
        .join("e2e-ws-prompt-CONTROL-never-added")
        .to_string_lossy()
        .to_string();

    let before = match harness::prompt_environment_block(cfg, &session_id).await {
        Ok(r) => r,
        Err(err) => {
            let _ = harness::cleanup_sde_session(cfg, &session_id).await;
            return harness::print_error("Workspace: prompt surfaces additional dirs", &err);
        }
    };
    let before_env = before.environment.clone().unwrap_or_default();
    let before_block_absent = !before_env.contains("Additional working directories");

    if let Err(err) =
        harness::workspace_add_directory(cfg, &session_id, &added_path, Some("localSettings")).await
    {
        let _ = harness::cleanup_sde_session(cfg, &session_id).await;
        return harness::print_error("Workspace: prompt surfaces additional dirs", &err);
    }

    let after = match harness::prompt_environment_block(cfg, &session_id).await {
        Ok(r) => r,
        Err(err) => {
            let _ = harness::cleanup_sde_session(cfg, &session_id).await;
            return harness::print_error("Workspace: prompt surfaces additional dirs", &err);
        }
    };
    let after_env = after.environment.clone().unwrap_or_default();

    let endpoint_ok = before.ok && after.ok;
    let block_header_present = after_env.contains("Additional working directories");
    let added_path_present = after_env.contains(&added_path);
    let control_path_absent = !after_env.contains(&control_path);

    let combined = format!(
        "before_ok={} before_env=\n{}\n\nafter_ok={} after_env=\n{}\n\nbefore_err={:?} after_err={:?}",
        before.ok, before_env, after.ok, after_env, before.error, after.error,
    );

    let _ = harness::cleanup_sde_session(cfg, &session_id).await;

    harness::print_result(
        "Workspace: prompt surfaces additional dirs",
        &combined,
        &[
            ("Both endpoint calls returned ok=true", endpoint_ok),
            (
                "Before mutation, block is absent (empty → omit)",
                before_block_absent,
            ),
            (
                "After mutation, 'Additional working directories' header is present",
                block_header_present,
            ),
            ("After mutation, added path is listed", added_path_present),
            (
                "Control path is NOT listed (block filters to real mutations)",
                control_path_absent,
            ),
        ],
    )
}

/// prove the launch-time seeding path in
/// `session_launch_impl` (Step 1b) mirrors
/// `SessionLaunchParams.additional_directories` into the persisted
/// `SessionWorkspace` before the first LLM turn — the frontend-facing
/// invariant that multi-root IDE workspaces are visible to tools
/// from the very first message.
///
/// Caller-path coverage: drives the real `session_launch_impl` via
/// `POST /test/session/launch-seed-only` (with `content=""` so the
/// send_message turn is skipped), then asserts on what actually
/// landed in `agent_sessions.workspace_additional_json` via
/// `load_workspace` — **not** the in-memory runtime handle. This
/// pins the full chain `SessionLaunchParams → launch_rust_agent
/// Step 1b → save_workspace → DB row`.
///
/// Positive+negative: seeds two distinct paths AND asserts a third control
/// path does NOT appear, so an implementation that silently ignores
/// `additional_directories` (or writes a default set) fails fast.
pub async fn launch_seeds_additional_directories(cfg: &Config) -> bool {
    let session_hint = format!("{}-ws-launch-seed", cfg.session_prefix);
    let project = tmp_workspace_path("ws-launch-seed");

    let seeded_a = std::env::temp_dir()
        .join("e2e-ws-launch-seed-ALPHA")
        .to_string_lossy()
        .to_string();
    let seeded_b = std::env::temp_dir()
        .join("e2e-ws-launch-seed-BETA")
        .to_string_lossy()
        .to_string();
    let control = std::env::temp_dir()
        .join("e2e-ws-launch-seed-CONTROL-never-passed")
        .to_string_lossy()
        .to_string();

    let seeds = vec![seeded_a.clone(), seeded_b.clone()];

    let launch = match harness::launch_seed_only(cfg, &project, &seeds, Some(&session_hint)).await {
        Ok(r) => r,
        Err(err) => return harness::print_error("Workspace: launch seeds additional dirs", &err),
    };
    let launch_ok = launch.ok;
    let session_id = launch.session_id.clone().unwrap_or_default();
    let launch_returned_sid = !session_id.is_empty();
    let launch_project_ok = launch
        .workspace_path
        .as_deref()
        .map(|p| p == project)
        .unwrap_or(false);

    let list = if launch_returned_sid {
        match harness::workspace_list_from_db(cfg, &session_id).await {
            Ok(r) => r,
            Err(err) => {
                let _ = harness::cleanup_sde_session(cfg, &session_id).await;
                return harness::print_error("Workspace: launch seeds additional dirs", &err);
            }
        }
    } else {
        harness::WorkspaceListFromDbResponse {
            ok: false,
            has_workspace: false,
            workspace_root: None,
            working_dir: None,
            additional_paths: Vec::new(),
            additional_sources: Vec::new(),
            error: Some("launch did not return a session_id".to_string()),
        }
    };

    let list_ok = list.ok;
    let has_workspace = list.has_workspace;
    let workspace_root_matches = list
        .workspace_root
        .as_deref()
        .map(|p| p == project)
        .unwrap_or(false);
    let contains_a = list.additional_paths.iter().any(|p| p == &seeded_a);
    let contains_b = list.additional_paths.iter().any(|p| p == &seeded_b);
    let does_not_contain_control = !list.additional_paths.iter().any(|p| p == &control);
    // Every seeded entry must carry the launch-time scope
    // (`DirectorySource::Session` — serialised as `"session"`).
    let sources_all_session = !list.additional_sources.is_empty()
        && list.additional_sources.iter().all(|s| s == "session");
    // Exactly 2 entries — proves we didn't double-insert or pick up
    // anything else.
    let exact_count = list.additional_paths.len() == 2;

    let combined = format!(
        "launch_ok={} launch_err={:?} session_id={:?} workspace_path={:?}\nlist_ok={} list_err={:?} has_workspace={} workspace_root={:?} working_dir={:?}\nadditional_paths={:?}\nadditional_sources={:?}",
        launch.ok,
        launch.error,
        launch.session_id,
        launch.workspace_path,
        list.ok,
        list.error,
        list.has_workspace,
        list.workspace_root,
        list.working_dir,
        list.additional_paths,
        list.additional_sources,
    );

    if launch_returned_sid {
        let _ = harness::cleanup_sde_session(cfg, &session_id).await;
    }

    harness::print_result(
        "Workspace: launch seeds additional dirs",
        &combined,
        &[
            ("Launch endpoint returned ok=true", launch_ok),
            ("Launch returned a session_id", launch_returned_sid),
            (
                "Launch workspace_path matches what we passed",
                launch_project_ok,
            ),
            ("list-from-db endpoint returned ok=true", list_ok),
            ("DB row has a workspace snapshot", has_workspace),
            (
                "DB workspace_root matches seeded project",
                workspace_root_matches,
            ),
            ("DB contains seeded path ALPHA", contains_a),
            ("DB contains seeded path BETA", contains_b),
            (
                "DB does NOT contain unrelated control path",
                does_not_contain_control,
            ),
            (
                "All seeded entries have source='session' (launch-time scope)",
                sources_all_session,
            ),
            (
                "DB additional_directories has exactly 2 entries",
                exact_count,
            ),
        ],
    )
}

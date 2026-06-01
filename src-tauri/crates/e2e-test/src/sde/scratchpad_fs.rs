//! State-level assertion for L1 Scratchpad filesystem persistence.
//!
//! This is the counterpart to `agent_core::scratchpad_usage` (behavioral).
//! Here we go one level deeper: after asking the agent to write something to
//! its scratchpad, we reach directly into
//! `/tmp/orgii-{uid}/{sanitized-project}/{session_id}/scratchpad/` and verify
//! that real files actually landed on disk.
//!
//! Mirrors `app_paths::scratchpad_dir()` layout exactly.

use std::path::{Path, PathBuf};

use crate::config::Config;
use crate::harness;

use super::tmp_workspace_path;

fn sanitize_workspace_path(workspace_path: &Path) -> String {
    let raw = workspace_path.to_string_lossy();
    raw.chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '\0' => '_',
            other => other,
        })
        .collect::<String>()
        .trim_start_matches('_')
        .to_string()
}

fn orgii_temp_root() -> PathBuf {
    let base = std::env::temp_dir();
    let resolved = base.canonicalize().unwrap_or(base);

    #[cfg(unix)]
    {
        let uid = unsafe { libc::getuid() };
        resolved.join(format!("orgii-{}", uid))
    }

    #[cfg(not(unix))]
    {
        resolved.join("orgii")
    }
}

fn scratchpad_dir(session_id: &str, workspace_path: &Path) -> PathBuf {
    orgii_temp_root()
        .join(sanitize_workspace_path(workspace_path))
        .join(session_id)
        .join("scratchpad")
}

pub async fn scratchpad_filesystem_check(cfg: &Config) -> bool {
    let session_id = format!("{}-scratchpad-fs", cfg.session_prefix);
    let project = tmp_workspace_path("scratchpad-fs");
    let scratch = scratchpad_dir(&session_id, Path::new(&project));

    // Clean any leftover from a previous run.
    let _ = std::fs::remove_dir_all(&scratch);

    println!("  [step 1] Asking agent to write to scratchpad...");
    let resp = harness::send_sde_message(
        cfg,
        "Write the text 'E2E_SCRATCHPAD_PROBE_12345' into a file named `probe.txt` in your scratchpad directory. \
         Use the scratchpad, not the workspace directory. After writing, briefly confirm.",
        &session_id,
        "build",
        &project,
        None,
        false,
    )
    .await;

    let turn_ok = resp.is_ok();

    // Don't fail-fast; we want the FS assertions to run either way so we can
    // tell apart "turn failed" vs "turn ok but no scratchpad file".
    let scratch_exists = scratch.exists();
    let entries: Vec<PathBuf> = std::fs::read_dir(&scratch)
        .map(|it| it.flatten().map(|e| e.path()).collect::<Vec<_>>())
        .unwrap_or_default();
    let non_empty = !entries.is_empty();

    // Look for our marker so we know the agent actually did the write (as
    // opposed to the directory being pre-created empty by ensure_scratchpad).
    let mut marker_found = false;
    for path in &entries {
        if let Ok(body) = std::fs::read_to_string(path) {
            if body.contains("E2E_SCRATCHPAD_PROBE_12345") {
                marker_found = true;
                break;
            }
        }
    }

    let summary = format!(
        "scratch_path={} exists={} entries={}",
        scratch.display(),
        scratch_exists,
        entries.len()
    );

    // Cleanup
    let _ = std::fs::remove_dir_all(&scratch);

    harness::print_result(
        "Scratchpad Filesystem Check",
        &summary,
        &[
            ("SDE turn succeeded", turn_ok),
            ("Scratchpad directory exists on disk", scratch_exists),
            ("Scratchpad directory non-empty", non_empty),
            ("Probe marker text persisted in a file", marker_found),
        ],
    )
}

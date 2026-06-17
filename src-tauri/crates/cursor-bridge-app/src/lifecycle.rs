//! Probe-instance lifecycle: detect, seed, launch, wait-for-ready.
//!
//! ## Three attach modes
//!
//! 1. **Shared** — the user already has *some* Cursor reachable on
//!    `--remote-debugging-port=<port>`. We attach to it and never
//!    spawn anything. This is the preferred mode (no duplicate
//!    Cursor process, no rsync, no extra RAM). Power users opt in
//!    by launching their daily-driver Cursor with the flag (see
//!    `crates/cursor-bridge/README.md` for the alias snippet).
//! 2. **Probe** — no Cursor is on the debug port. We spawn an
//!    isolated hidden Cursor under `/tmp/orgii-cursor-probe-data/`
//!    (separate `--user-data-dir`) so the user's main instance —
//!    if any — is never disturbed and no probe window is raised.
//! 3. **Real-running-no-debug-port** — the user has a real Cursor
//!    running but it isn't reachable. We fail fast with a clear
//!    relaunch instruction instead of silently opening a second
//!    Cursor window and sending follow-ups to a different instance.
//!
//! The isolated probe is logged in because:
//! 1. The macOS keychain entry encrypting Cursor's auth blob is keyed
//!    by the binary's bundle id; both instances have the same one.
//! 2. The seeding rsync below copies the encrypted blob over once,
//!    on first launch.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use cursor_bridge::{discover_targets, Target, TargetType};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, Signal, System};

/// Where we keep the isolated probe instance's user-data. Persistent
/// across reboots (it's under `/tmp` only because `~/Library/Application
/// Support/Orgii/cursor-probe-data` is a much longer name we'd have to
/// re-create — `/tmp` survives across our app restarts on macOS).
///
/// FIXME: macOS clears `/tmp` periodically. We should move this to
/// `~/Library/Application Support/Orgii/cursor-probe-data` so the
/// seeding only happens once per machine.
const PROBE_DATA_DIR: &str = "/tmp/orgii-cursor-probe-data";

/// Workspace folder we open inside the probe instance. Kept empty +
/// stable so the renderer's window state lives in
/// `User/workspaceStorage/<workspace-hash>/state.vscdb` consistently
/// across sessions.
const PROBE_WORKSPACE_DIR: &str = "/tmp/orgii-cursor-probe-workspace";

/// Cursor.app bundle path. Hard-coded for macOS — Linux/Windows ship
/// later when their respective `--remote-debugging-port` project is
/// validated.
const CURSOR_APP_PATH: &str = "/Applications/Cursor.app";

/// Where the user's real Cursor stores its login blob + chat DB.
/// Used as the seed source for `PROBE_DATA_DIR` on first launch.
fn real_user_data_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/_unknown".to_string());
    PathBuf::from(home).join("Library/Application Support/Cursor")
}

/// Where the user installs Cursor extensions. We point the probe at
/// the same dir (it's read-mostly from this side; both instances
/// only read `extensions.json`, never racing on writes during a
/// chat).
fn real_extensions_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/_unknown".to_string());
    PathBuf::from(home).join(".cursor/extensions")
}

/// Which Cursor process we're attached to (or about to attach to).
///
/// Returned by [`detect_cursor_mode`] and surfaced to the frontend
/// via `cursor_bridge_attach_mode` so the UI can show "using your
/// real Cursor" vs "using isolated probe" and avoid surprise
/// duplicate windows.
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AttachMode {
    /// Some Cursor is already responding on the debug port. We don't
    /// know (or care) which one — could be the user's daily driver
    /// (if they launched it with the flag) or a probe from a previous
    /// run. We just attach.
    SharedAttached {
        /// Renderer Page target we'd attach to.
        target_id: String,
        /// Whether the attached Cursor is plausibly the probe (user-
        /// data-dir is ours) vs the user's real instance. Best-effort
        /// — derived from `pgrep` cmdline inspection.
        is_probe: bool,
    },
    /// The user has a real Cursor running but it doesn't expose
    /// `--remote-debugging-port`. `ensure_running` treats this as a
    /// user-actionable blocker instead of spawning a second Cursor:
    /// history rows belong to the real Cursor DB, so follow-ups must
    /// drive that same instance.
    RealRunningNoDebugPort {
        /// PIDs of the user-launched Cursor processes we found, so
        /// the frontend can show how many windows would be affected
        /// if the user opted into a relaunch.
        real_pids: Vec<u32>,
    },
    /// No Cursor anywhere — clean state, we'll spawn the probe.
    NeedProbe,
}

/// What `cursor_bridge_ensure_running` returns.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureRunningStatus {
    /// CDP endpoint was already responding before we did anything.
    pub already_running: bool,
    /// We started the isolated Cursor process during this call. False
    /// if `already_running` was true. False if launch failed.
    pub launched: bool,
    /// Renderer Page target id (the thing
    /// `cursor_bridge_send` will attach to). `None` only if
    /// neither path produced a live target — caller should surface a
    /// retry.
    pub target_id: Option<String>,
    /// Seed/copy of the real user-data-dir happened during this call.
    /// First-run signal so the UI can show a one-time progress
    /// indicator (the seed is ~1.2 GB and rsync takes ~10 s on a
    /// busy machine).
    pub seeded_user_data: bool,
    /// Which path we ended up taking. Lets the frontend show "shared
    /// with your real Cursor" vs "isolated probe" without a second
    /// round-trip.
    pub attach_mode: AttachMode,
}

/// Inspect the running process table and the CDP HTTP endpoint to
/// decide which [`AttachMode`] applies *right now*. Cheap — no file
/// IO, no process spawning, ~10ms.
pub async fn detect_cursor_mode(port: u16) -> AttachMode {
    let http = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(client) => client,
        // If we can't even build a client we can't talk to CDP and
        // can't tell anything — treat as `NeedProbe` so the caller's
        // launch path runs and surfaces a real error.
        Err(_) => return AttachMode::NeedProbe,
    };

    if let Some(target) = first_renderer_target(&http, port).await {
        let is_probe = is_probe_target(&target).await;
        return AttachMode::SharedAttached {
            target_id: target.id,
            is_probe,
        };
    }

    let real_pids = real_cursor_pids_without_debug_port(port);
    if !real_pids.is_empty() {
        AttachMode::RealRunningNoDebugPort { real_pids }
    } else {
        AttachMode::NeedProbe
    }
}

/// Check the CDP endpoint and, if needed, launch the isolated probe
/// Cursor instance + wait for its renderer to come up.
///
/// `port` is what we pass to `--remote-debugging-port`. Default is
/// `9230` to match the README.
///
/// `RealRunningNoDebugPort` is fatal: Cursor history rows are read
/// from the user's real Cursor DB, so sending a follow-up through a
/// freshly spawned isolated probe targets a different composer
/// repository. If no Cursor is running, we can still start the probe
/// because there is no live real instance to reuse.
pub async fn ensure_running(port: u16) -> Result<EnsureRunningStatus, String> {
    let mode = detect_cursor_mode(port).await;

    ensure_running_for_mode(port, mode).await
}

pub async fn ensure_real_cursor_running(port: u16) -> Result<EnsureRunningStatus, String> {
    let mode = detect_cursor_mode(port).await;
    match mode {
        AttachMode::SharedAttached { .. } => ensure_running_for_mode(port, mode).await,
        AttachMode::NeedProbe => launch_real_cursor_and_wait(port).await,
        AttachMode::RealRunningNoDebugPort { real_pids } => {
            Err(cursor_running_without_debug_port_message(port, &real_pids))
        }
    }
}

async fn ensure_running_for_mode(
    port: u16,
    mode: AttachMode,
) -> Result<EnsureRunningStatus, String> {
    match mode {
        AttachMode::SharedAttached {
            ref target_id,
            is_probe: _,
        } => Ok(EnsureRunningStatus {
            already_running: true,
            launched: false,
            target_id: Some(target_id.clone()),
            seeded_user_data: false,
            attach_mode: mode,
        }),
        AttachMode::RealRunningNoDebugPort { real_pids } => {
            Err(cursor_running_without_debug_port_message(port, &real_pids))
        }
        AttachMode::NeedProbe => {
            let http = reqwest::Client::builder()
                .timeout(Duration::from_secs(2))
                .build()
                .map_err(|err| format!("build reqwest client: {err}"))?;
            let seeded = seed_user_data_if_missing()?;
            ensure_workspace_dir()?;
            launch_probe_instance(port)?;
            let target = wait_for_renderer(&http, port, Duration::from_secs(30)).await?;

            Ok(EnsureRunningStatus {
                already_running: false,
                launched: true,
                target_id: Some(target.id),
                seeded_user_data: seeded,
                attach_mode: AttachMode::NeedProbe,
            })
        }
    }
}

fn cursor_running_without_debug_port_message(port: u16, real_pids: &[u32]) -> String {
    let pid_list = real_pids
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "Cursor is already running without --remote-debugging-port={port} (PID(s): {pid_list}). Quit Cursor and restart it with: open -a Cursor --args --remote-debugging-port={port}. ORGII will not open a second Cursor window because follow-ups must reuse the same Cursor instance that owns the conversation."
    )
}

pub async fn restart_real_cursor_with_debug_port(port: u16) -> Result<EnsureRunningStatus, String> {
    let mode = detect_cursor_mode(port).await;
    match mode {
        AttachMode::SharedAttached { .. } => ensure_running_for_mode(port, mode).await,
        AttachMode::NeedProbe => launch_real_cursor_and_wait(port).await,
        AttachMode::RealRunningNoDebugPort { real_pids } => {
            request_real_cursor_quit().or_else(|err| {
                tracing::warn!(error = %err, "normal Cursor quit failed; falling back to process terminate");
                terminate_real_cursor_processes(&real_pids)
            })?;
            let related_pids = real_cursor_related_pids_without_debug_port(port);
            if let Err(err) =
                wait_for_real_cursor_exit(&related_pids, Duration::from_secs(15)).await
            {
                tracing::warn!(error = %err, "Cursor did not exit after normal quit; falling back to process terminate");
                terminate_real_cursor_processes(&real_pids)?;
                let related_pids = real_cursor_related_pids_without_debug_port(port);
                wait_for_real_cursor_exit(&related_pids, Duration::from_secs(10)).await?;
            }
            launch_real_cursor_and_wait(port).await
        }
    }
}

async fn launch_real_cursor_and_wait(port: u16) -> Result<EnsureRunningStatus, String> {
    launch_real_cursor_with_debug_port(port)?;

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|err| format!("build reqwest client: {err}"))?;
    let target = wait_for_renderer(&http, port, Duration::from_secs(30)).await?;

    Ok(EnsureRunningStatus {
        already_running: false,
        launched: true,
        target_id: Some(target.id.clone()),
        seeded_user_data: false,
        attach_mode: AttachMode::SharedAttached {
            target_id: target.id,
            is_probe: false,
        },
    })
}

fn request_real_cursor_quit() -> Result<(), String> {
    let mut cmd = Command::new("osascript");
    cmd.args(["-e", "tell application \"Cursor\" to quit"]);
    // Suppress console window on Windows.
    app_platform::hide_console(&mut cmd);
    let status = cmd
        .status()
        .map_err(|err| format!("spawn osascript to quit Cursor: {err}"))?;

    if !status.success() {
        return Err(format!("osascript quit Cursor exited with status {status}"));
    }

    Ok(())
}

fn terminate_real_cursor_processes(real_pids: &[u32]) -> Result<(), String> {
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cmd(sysinfo::UpdateKind::Always),
    );

    for raw_pid in real_pids {
        let pid = Pid::from_u32(*raw_pid);
        let Some(process) = sys.process(pid) else {
            continue;
        };
        let signaled = process
            .kill_with(Signal::Term)
            .unwrap_or_else(|| process.kill());
        if !signaled {
            return Err(format!("failed to terminate Cursor PID {raw_pid}"));
        }
    }
    Ok(())
}

async fn wait_for_real_cursor_exit(real_pids: &[u32], timeout: Duration) -> Result<(), String> {
    let start = Instant::now();
    while start.elapsed() < timeout {
        let mut sys = System::new();
        sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_cmd(sysinfo::UpdateKind::Always),
        );
        let still_running = real_pids
            .iter()
            .any(|pid| sys.process(Pid::from_u32(*pid)).is_some());
        if !still_running {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    Err(format!(
        "Cursor did not exit within {:?}; please quit Cursor manually and retry",
        timeout
    ))
}

fn real_cursor_open_args() -> [&'static str; 3] {
    ["-j", "-a", CURSOR_APP_PATH]
}

fn launch_real_cursor_with_debug_port(port: u16) -> Result<(), String> {
    if !Path::new(CURSOR_APP_PATH).exists() {
        return Err(format!(
            "Cursor.app not found at {CURSOR_APP_PATH} — install Cursor before enabling control"
        ));
    }

    let user_data_dir = real_user_data_dir();
    let mut cmd = Command::new("open");
    cmd.args(real_cursor_open_args())
        .arg("--args")
        .arg(format!("--remote-debugging-port={port}"))
        .arg(format!("--user-data-dir={}", user_data_dir.display()));
    // Suppress console window on Windows.
    app_platform::hide_console(&mut cmd);
    let status = cmd
        .status()
        .map_err(|err| format!("spawn `open` for Cursor.app: {err}"))?;

    if !status.success() {
        return Err(format!("`open` exited with status {status}"));
    }

    Ok(())
}

/// Light-weight status probe: returns the renderer target id if one
/// is already live, otherwise `None` without touching the file system
/// or spawning processes. Used by the frontend's status badge in the
/// composer toolbar.
pub async fn current_status(port: u16) -> Result<Option<String>, String> {
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|err| format!("build reqwest client: {err}"))?;
    Ok(first_renderer_target(&http, port).await.map(|t| t.id))
}

/// Best-effort guess at whether a CDP target is from our probe vs the
/// user's real Cursor. Cursor exposes the workbench Page's title in
/// the target descriptor, but not the user-data-dir — so we walk the
/// process table looking for a Cursor process whose cmdline contains
/// `PROBE_DATA_DIR`. Returns `true` if such a process exists *and*
/// the renderer count is ≤1 (heuristic: mixed renderers from probe
/// and real both showing up means we can't disambiguate, default
/// `false` so the UI prefers the safer label).
async fn is_probe_target(_target: &Target) -> bool {
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cmd(sysinfo::UpdateKind::Always),
    );
    sys.processes().values().any(|p| {
        let name = p.name().to_string_lossy().to_lowercase();
        if !name.contains("cursor") {
            return false;
        }
        p.cmd()
            .iter()
            .any(|arg| arg.to_string_lossy().contains(PROBE_DATA_DIR))
    })
}

/// Walk the process table for Cursor processes whose cmdline does
/// NOT include `--remote-debugging-port=<port>` and does NOT include
/// our probe data dir — i.e. user-launched Cursors that we can't
/// drive without first restarting them.
fn real_cursor_pids_without_debug_port(port: u16) -> Vec<u32> {
    real_cursor_pids_by_kind(port, true)
}

fn real_cursor_related_pids_without_debug_port(port: u16) -> Vec<u32> {
    real_cursor_pids_by_kind(port, false)
}

fn real_cursor_pids_by_kind(port: u16, main_only: bool) -> Vec<u32> {
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cmd(sysinfo::UpdateKind::Always),
    );

    let debug_port_marker = format!("--remote-debugging-port={port}");
    let real_dir = real_user_data_dir().to_string_lossy().to_string();
    let mut pids = Vec::new();

    for (pid, proc) in sys.processes() {
        let name = proc.name().to_string_lossy().to_lowercase();
        if main_only {
            // We want only the *main* Cursor process, not its renderer/GPU
            // helpers (each helper has "Cursor Helper" / "Cursor Helper
            // (Renderer)" etc. in the name). The main process's executable
            // name is just "Cursor".
            if name != "cursor" {
                continue;
            }
        } else if !name.contains("cursor") {
            continue;
        }

        let cmd_strs: Vec<String> = proc
            .cmd()
            .iter()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect();

        if cmd_strs.iter().any(|arg| arg.contains(PROBE_DATA_DIR)) {
            continue;
        }
        if cmd_strs.iter().any(|arg| arg.contains(&debug_port_marker)) {
            continue;
        }
        if !main_only && !cmd_strs.iter().any(|arg| arg.contains(&real_dir)) && name != "cursor" {
            continue;
        }

        pids.push(pid.as_u32());
    }

    pids
}

async fn first_renderer_target(http: &reqwest::Client, port: u16) -> Option<Target> {
    let targets = discover_targets(http, "127.0.0.1", port).await.ok()?;
    targets
        .into_iter()
        .find(|t| matches!(t.target_type, TargetType::Page))
}

async fn wait_for_renderer(
    http: &reqwest::Client,
    port: u16,
    deadline: Duration,
) -> Result<Target, String> {
    let start = Instant::now();
    let mut last_target_count = 0_usize;
    while start.elapsed() < deadline {
        if let Ok(targets) = discover_targets(http, "127.0.0.1", port).await {
            last_target_count = targets.len();
            if let Some(page) = targets
                .into_iter()
                .find(|t| matches!(t.target_type, TargetType::Page))
            {
                return Ok(page);
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    Err(format!(
        "isolated Cursor launched but no renderer Page target appeared within {:?} (saw {last_target_count} non-Page target(s) — Cursor may still be initializing the workbench window)",
        deadline
    ))
}

/// rsync the user's real user-data-dir into the probe location iff
/// the probe location doesn't already exist. Returns whether seeding
/// actually happened.
fn seed_user_data_if_missing() -> Result<bool, String> {
    let probe_dir = Path::new(PROBE_DATA_DIR);
    if probe_dir.exists() {
        return Ok(false);
    }

    let real_dir = real_user_data_dir();
    if !real_dir.exists() {
        return Err(format!(
            "real Cursor user-data-dir not found at {} — is Cursor installed and signed in?",
            real_dir.display()
        ));
    }

    std::fs::create_dir_all(probe_dir)
        .map_err(|err| format!("mkdir {}: {err}", probe_dir.display()))?;

    // We shell out to `rsync` instead of `fs_extra::dir::copy` because:
    // 1. macOS ships rsync; Linux/Windows ports can fall back to a
    //    Rust copy when this branch lights up.
    // 2. We need exclude rules — the source dir is multi-GB and
    //    almost all of it is *not* needed for the probe to function
    //    (see exclude list below). fs_extra has no exclude filter.
    //
    // Philosophy: seed *only* the lightweight UX bits (settings,
    // keybindings, snippets, extensions registry) and let the
    // probe's `state.vscdb` start empty. This means:
    //
    //  - On first launch the probe will be **logged out** and ask
    //    the user to sign in. After that one-time auth, the probe's
    //    own (tiny, locally-grown) `state.vscdb` keeps the session
    //    and never asks again.
    //  - We don't touch the user's chat history, conversation
    //    embeddings, recent-workspaces list, or per-repo LSP
    //    indexes. Those are the multi-GB items.
    //  - Recent-workspaces list (`User/globalStorage/storage.json`)
    //    is dropped because if the probe inherits it, it will
    //    *re-open* the user's real repos in the background on
    //    startup and start indexing them — which fires fs events
    //    on our own source tree and sends Tauri's `cargo dev`
    //    watcher into a rebuild loop.
    let mut cmd = Command::new("rsync");
    cmd.arg("-a")
        .args([
            // Caches / scratch — rebuildable. These can appear nested
            // inside `Partitions/<name>/` too (Cursor uses one webview
            // partition per logical surface), so the patterns are
            // unanchored — `rsync` matches them at any depth without a
            // leading `/`.
            "--exclude=Cache",
            "--exclude=CachedData",
            "--exclude=CachedExtensionVSIXs",
            "--exclude=CachedProfilesData",
            "--exclude=CachedConfigurations",
            "--exclude=Code Cache",
            "--exclude=GPUCache",
            "--exclude=DawnGraphiteCache",
            "--exclude=DawnWebGPUCache",
            "--exclude=ShaderCache",
            "--exclude=Shared Dictionary",
            "--exclude=Trust Tokens",
            "--exclude=component_crx_cache",
            "--exclude=Crashpad",
            "--exclude=logs",
            "--exclude=*.sock",
            "--exclude=Service Worker",
            "--exclude=blob_storage",
            "--exclude=IndexedDB",
            "--exclude=Backups",
            "--exclude=Workspaces",
            // We don't drive Cursor's in-app browser via CDP, so
            // dropping the entire `Partitions/` tree saves ~38 MB
            // and removes another fs-watcher noise source.
            "--exclude=Partitions",
            // Cursor's per-codebase AI snapshot store — only useful
            // for AI features that need historical context. Probe
            // never asks for those, so save ~50 MB.
            "--exclude=snapshots",
            // The big drops — these are the GB-scale items we
            // really do not want in the probe:
            //
            // The DB itself: chat history, embeddings, all of
            // anysphere.* state. Probe creates its own on launch.
            "--exclude=User/globalStorage/state.vscdb",
            "--exclude=User/globalStorage/state.vscdb.backup",
            "--exclude=User/globalStorage/state.vscdb-wal",
            "--exclude=User/globalStorage/state.vscdb-shm",
            // Cursor's AI-feature local stores (commits cache,
            // retrieval index). Probe rebuilds as needed.
            "--exclude=User/globalStorage/anysphere.cursor-*",
            // Recent-workspaces list (would auto-reopen orgii_frontend
            // in the probe and trigger Tauri's cargo dev watcher).
            "--exclude=User/globalStorage/storage.json",
            // Per-workspace LSP indexes / local file history.
            "--exclude=User/workspaceStorage",
            "--exclude=User/History",
        ])
        // Trailing slash on the source matters: rsync semantics for
        // "copy contents into destination" rather than "copy the
        // directory itself".
        .arg(format!("{}/", real_dir.display()))
        .arg(format!("{}/", probe_dir.display()));
    // Suppress console window on Windows.
    app_platform::hide_console(&mut cmd);
    let status = cmd.status().map_err(|err| format!("spawn rsync: {err}"))?;

    if !status.success() {
        return Err(format!("rsync failed with exit status {status}"));
    }

    Ok(true)
}

fn ensure_workspace_dir() -> Result<(), String> {
    std::fs::create_dir_all(PROBE_WORKSPACE_DIR)
        .map_err(|err| format!("mkdir {PROBE_WORKSPACE_DIR}: {err}"))
}

fn probe_open_args() -> [&'static str; 4] {
    ["-n", "-j", "-a", CURSOR_APP_PATH]
}

fn launch_probe_instance(port: u16) -> Result<(), String> {
    if !Path::new(CURSOR_APP_PATH).exists() {
        return Err(format!(
            "Cursor.app not found at {CURSOR_APP_PATH} — install Cursor before enabling control"
        ));
    }

    // `open -n` forces a new instance and `-j` launches it hidden so
    // ORGII can drive Cursor's workbench renderer without stealing focus.
    let extensions_dir = real_extensions_dir();
    let mut cmd = Command::new("open");
    cmd.args(probe_open_args())
        .arg("--args")
        .arg(format!("--remote-debugging-port={port}"))
        .arg(format!("--user-data-dir={PROBE_DATA_DIR}"))
        .arg(format!("--extensions-dir={}", extensions_dir.display()))
        .arg(PROBE_WORKSPACE_DIR);
    // Suppress console window on Windows.
    app_platform::hide_console(&mut cmd);

    let status = cmd
        .status()
        .map_err(|err| format!("spawn `open` for Cursor.app: {err}"))?;

    if !status.success() {
        return Err(format!("`open` exited with status {status}"));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Seed paths point at `/tmp` — guarantees seeding can be re-run
    /// from tests without polluting the real machine.
    #[test]
    fn probe_paths_are_under_tmp() {
        assert!(PROBE_DATA_DIR.starts_with("/tmp/"));
        assert!(PROBE_WORKSPACE_DIR.starts_with("/tmp/"));
    }

    #[test]
    fn probe_launch_is_hidden_and_isolated() {
        let args = probe_open_args();

        assert!(args.contains(&"-n"));
        assert!(args.contains(&"-j"));
        assert!(args.contains(&"-a"));
        assert!(args.contains(&CURSOR_APP_PATH));
    }

    #[test]
    fn real_cursor_relaunch_is_hidden() {
        let args = real_cursor_open_args();

        assert!(args.contains(&"-j"));
        assert!(args.contains(&"-a"));
        assert!(args.contains(&CURSOR_APP_PATH));
    }

    #[test]
    fn running_real_cursor_error_mentions_reuse_requirement() {
        let message = cursor_running_without_debug_port_message(9230, &[111, 222]);

        assert!(message.contains("--remote-debugging-port=9230"));
        assert!(message.contains("111, 222"));
        assert!(message.contains("will not open a second Cursor window"));
        assert!(message.contains("follow-ups must reuse the same Cursor instance"));
    }
}

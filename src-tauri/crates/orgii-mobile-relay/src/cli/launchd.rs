//! macOS launchd integration for `orgii-mobile-relay`.
//!
//! Installs the relay as a **user-level** LaunchAgent (per-user login
//! agent), not a root LaunchDaemon. The plist lives at
//! `~/Library/LaunchAgents/com.orgii.mobile-relay.plist` and is loaded /
//! unloaded with `launchctl load -w` / `unload -w`.
//!
//! Logs go to `~/Library/Logs/ORGII/mobile-relay-{out,err}.log`.
//!
//! The `#[cfg(target_os = "macos")]` gate lives on the `pub mod launchd;`
//! declaration in `mod.rs` — duplicating it here would be a redundant
//! attribute that clippy flags.

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context, Result};

use super::ServiceStatus;

/// launchd label. Matches the plist filename stem.
pub const SERVICE_LABEL: &str = "com.orgii.mobile-relay";

/// Render a launchd plist for the relay.
///
/// Inputs are pre-resolved absolute paths so the rendering logic stays
/// pure (and trivially testable). The caller is responsible for
/// resolving `~` via `dirs::home_dir()`.
pub fn render_plist(binary_path: &Path, stdout_log: &Path, stderr_log: &Path) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{binary}</string>
        <string>serve</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{stdout}</string>
    <key>StandardErrorPath</key>
    <string>{stderr}</string>
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
"#,
        label = SERVICE_LABEL,
        binary = binary_path.display(),
        stdout = stdout_log.display(),
        stderr = stderr_log.display(),
    )
}

/// Resolve `~/Library/LaunchAgents/com.orgii.mobile-relay.plist`.
pub fn plist_path() -> Result<PathBuf> {
    let home = dirs::home_dir().context("could not resolve user home directory")?;
    Ok(home
        .join("Library")
        .join("LaunchAgents")
        .join(format!("{SERVICE_LABEL}.plist")))
}

/// Resolve `~/Library/Logs/ORGII` and ensure the directory exists.
fn log_dir() -> Result<PathBuf> {
    let home = dirs::home_dir().context("could not resolve user home directory")?;
    let dir = home.join("Library").join("Logs").join("ORGII");
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("failed to create log directory {}", dir.display()))?;
    Ok(dir)
}

pub fn install(_config: Option<&Path>) -> Result<()> {
    let binary = std::env::current_exe().context("failed to resolve current binary path")?;
    let logs = log_dir()?;
    let stdout_log = logs.join("mobile-relay-out.log");
    let stderr_log = logs.join("mobile-relay-err.log");

    let plist = render_plist(&binary, &stdout_log, &stderr_log);
    let path = plist_path()?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    std::fs::write(&path, plist)
        .with_context(|| format!("failed to write plist {}", path.display()))?;

    let status = Command::new("launchctl")
        .arg("load")
        .arg("-w")
        .arg(&path)
        .status()
        .context("failed to spawn `launchctl load`")?;
    if !status.success() {
        bail!(
            "`launchctl load -w {}` exited with {}",
            path.display(),
            status
        );
    }

    println!("Installed launchd agent at {}", path.display());
    Ok(())
}

pub fn uninstall() -> Result<()> {
    let path = plist_path()?;
    if path.exists() {
        let status = Command::new("launchctl")
            .arg("unload")
            .arg("-w")
            .arg(&path)
            .status()
            .context("failed to spawn `launchctl unload`")?;
        if !status.success() {
            bail!(
                "`launchctl unload -w {}` exited with {}",
                path.display(),
                status
            );
        }
        std::fs::remove_file(&path)
            .with_context(|| format!("failed to remove plist {}", path.display()))?;
        println!("Removed launchd agent {}", path.display());
    } else {
        println!("No plist at {} (already uninstalled)", path.display());
    }
    Ok(())
}

pub fn start() -> Result<()> {
    let status = Command::new("launchctl")
        .arg("start")
        .arg(SERVICE_LABEL)
        .status()
        .context("failed to spawn `launchctl start`")?;
    if !status.success() {
        bail!("`launchctl start {SERVICE_LABEL}` exited with {status}");
    }
    Ok(())
}

pub fn stop() -> Result<()> {
    let status = Command::new("launchctl")
        .arg("stop")
        .arg(SERVICE_LABEL)
        .status()
        .context("failed to spawn `launchctl stop`")?;
    if !status.success() {
        bail!("`launchctl stop {SERVICE_LABEL}` exited with {status}");
    }
    Ok(())
}

pub fn status() -> Result<ServiceStatus> {
    let plist = plist_path()?;
    if !plist.exists() {
        return Ok(ServiceStatus::NotInstalled);
    }
    let output = Command::new("launchctl")
        .arg("list")
        .arg(SERVICE_LABEL)
        .output()
        .context("failed to spawn `launchctl list`")?;
    Ok(parse_launchctl_list(
        output.status.code(),
        &String::from_utf8_lossy(&output.stdout),
    ))
}

/// Map `launchctl list <label>` output into a [`ServiceStatus`].
///
/// `launchctl list <label>` semantics on macOS:
///   - exit 0 + stdout contains a plist-like dict → loaded; check PID:
///     - `"PID" = <number>;` → Running
///     - no PID line                              → Stopped (loaded but not running)
///   - non-zero exit                              → NotInstalled (label unknown)
///
/// Pulled out as a free function so it can be unit-tested without
/// shelling out to `launchctl`.
pub fn parse_launchctl_list(exit_code: Option<i32>, stdout: &str) -> ServiceStatus {
    match exit_code {
        Some(0) => {
            if stdout.lines().any(|line| {
                let trimmed = line.trim();
                trimmed.starts_with("\"PID\"") || trimmed.starts_with("PID =")
            }) {
                ServiceStatus::Running
            } else {
                ServiceStatus::Stopped
            }
        }
        _ => ServiceStatus::NotInstalled,
    }
}

//! Linux systemd integration for `orgii-mobile-relay`.
//!
//! Installs the relay as a **user-level** systemd unit, not a system
//! daemon. The unit lives at
//! `~/.config/systemd/user/orgii-mobile-relay.service` and is managed
//! with `systemctl --user`.

#![cfg(target_os = "linux")]

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context, Result};

use super::ServiceStatus;

/// Unit filename. Matches what systemctl expects on the command line.
pub const SERVICE_UNIT: &str = "orgii-mobile-relay.service";

/// Render a systemd user unit file for the relay.
///
/// `binary_path` should be absolute. The caller passes resolved paths
/// so this function stays pure for testing.
pub fn render_unit(binary_path: &Path) -> String {
    format!(
        "[Unit]\n\
        Description=ORGII Mobile Remote Relay\n\
        After=network-online.target\n\
        Wants=network-online.target\n\
        \n\
        [Service]\n\
        Type=simple\n\
        ExecStart={binary} serve\n\
        Restart=on-failure\n\
        RestartSec=5\n\
        \n\
        [Install]\n\
        WantedBy=default.target\n",
        binary = binary_path.display(),
    )
}

/// Resolve `~/.config/systemd/user/orgii-mobile-relay.service`.
pub fn unit_path() -> Result<PathBuf> {
    let base = dirs::config_dir().context("could not resolve user config directory")?;
    Ok(base.join("systemd").join("user").join(SERVICE_UNIT))
}

pub fn install(_config: Option<&Path>) -> Result<()> {
    let binary = std::env::current_exe().context("failed to resolve current binary path")?;
    let unit = render_unit(&binary);
    let path = unit_path()?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    std::fs::write(&path, unit)
        .with_context(|| format!("failed to write unit {}", path.display()))?;

    run_systemctl(&["daemon-reload"])?;
    run_systemctl(&["enable", SERVICE_UNIT])?;

    println!("Installed systemd user unit at {}", path.display());
    Ok(())
}

pub fn uninstall() -> Result<()> {
    let path = unit_path()?;
    // Best-effort: even if disable fails (e.g. already disabled) we
    // still want to remove the unit file.
    let _ = run_systemctl(&["disable", "--now", SERVICE_UNIT]);

    if path.exists() {
        std::fs::remove_file(&path)
            .with_context(|| format!("failed to remove unit {}", path.display()))?;
        println!("Removed systemd unit {}", path.display());
    } else {
        println!("No unit at {} (already uninstalled)", path.display());
    }
    run_systemctl(&["daemon-reload"])?;
    Ok(())
}

pub fn start() -> Result<()> {
    run_systemctl(&["start", SERVICE_UNIT])
}

pub fn stop() -> Result<()> {
    run_systemctl(&["stop", SERVICE_UNIT])
}

pub fn status() -> Result<ServiceStatus> {
    if !unit_path()?.exists() {
        return Ok(ServiceStatus::NotInstalled);
    }
    let output = Command::new("systemctl")
        .arg("--user")
        .arg("is-active")
        .arg(SERVICE_UNIT)
        .output()
        .context("failed to spawn `systemctl --user is-active`")?;
    Ok(parse_is_active(
        output.status.code(),
        &String::from_utf8_lossy(&output.stdout),
    ))
}

/// Run `systemctl --user <args>` and surface a clean `anyhow` error.
fn run_systemctl(args: &[&str]) -> Result<()> {
    let mut cmd = Command::new("systemctl");
    cmd.arg("--user");
    for a in args {
        cmd.arg(a);
    }
    let status = cmd
        .status()
        .with_context(|| format!("failed to spawn `systemctl --user {}`", args.join(" ")))?;
    if !status.success() {
        bail!(
            "`systemctl --user {}` exited with {}",
            args.join(" "),
            status
        );
    }
    Ok(())
}

/// Map `systemctl --user is-active <unit>` output to [`ServiceStatus`].
///
/// `is-active` exits 0 when the unit is active, non-zero otherwise.
/// stdout contains one of: `active`, `inactive`, `failed`, `activating`,
/// `deactivating`, `unknown`. We treat anything-but-`active` as
/// `Stopped` once we already know the unit file exists (the
/// `NotInstalled` branch is decided earlier from the unit file path).
pub fn parse_is_active(exit_code: Option<i32>, stdout: &str) -> ServiceStatus {
    let trimmed = stdout.trim();
    match exit_code {
        Some(0) if trimmed == "active" => ServiceStatus::Running,
        _ => ServiceStatus::Stopped,
    }
}

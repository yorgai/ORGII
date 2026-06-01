//! Windows service integration for `orgii-mobile-relay`, via NSSM.
//!
//! NSSM (the Non-Sucking Service Manager — https://nssm.cc/) is the
//! de-facto wrapper for running plain user binaries as Windows
//! services. We assume `nssm.exe` is on `PATH`; if it isn't, every
//! subcommand returns a clear error pointing at the installer.
//!
//! Service name: `ORGII Mobile Relay`.

#![cfg(target_os = "windows")]

use std::path::Path;
use std::process::Command;

use anyhow::{bail, Context, Result};

use super::ServiceStatus;

/// Windows service display name. Spaces are fine for NSSM; we always
/// pass the name as a single argv element.
pub const SERVICE_NAME: &str = "ORGII Mobile Relay";

/// Confirm `nssm.exe` is reachable. Returns a friendly error otherwise.
fn ensure_nssm() -> Result<()> {
    let probe = Command::new("nssm").arg("version").output();
    match probe {
        Ok(out) if out.status.success() => Ok(()),
        Ok(out) => bail!(
            "`nssm version` exited with {} — install NSSM from https://nssm.cc/ and ensure it's on PATH",
            out.status
        ),
        Err(err) => bail!(
            "could not invoke nssm.exe ({err}); install NSSM from https://nssm.cc/ and ensure it's on PATH"
        ),
    }
}

pub fn install(_config: Option<&Path>) -> Result<()> {
    ensure_nssm()?;
    let binary = std::env::current_exe().context("failed to resolve current binary path")?;
    let status = Command::new("nssm")
        .arg("install")
        .arg(SERVICE_NAME)
        .arg(&binary)
        .arg("serve")
        .status()
        .context("failed to spawn `nssm install`")?;
    if !status.success() {
        bail!("`nssm install \"{SERVICE_NAME}\"` exited with {status}");
    }
    println!("Installed Windows service \"{SERVICE_NAME}\" via NSSM");
    Ok(())
}

pub fn uninstall() -> Result<()> {
    ensure_nssm()?;
    let status = Command::new("nssm")
        .arg("remove")
        .arg(SERVICE_NAME)
        .arg("confirm")
        .status()
        .context("failed to spawn `nssm remove`")?;
    if !status.success() {
        bail!("`nssm remove \"{SERVICE_NAME}\" confirm` exited with {status}");
    }
    println!("Removed Windows service \"{SERVICE_NAME}\"");
    Ok(())
}

pub fn start() -> Result<()> {
    ensure_nssm()?;
    let status = Command::new("nssm")
        .arg("start")
        .arg(SERVICE_NAME)
        .status()
        .context("failed to spawn `nssm start`")?;
    if !status.success() {
        bail!("`nssm start \"{SERVICE_NAME}\"` exited with {status}");
    }
    Ok(())
}

pub fn stop() -> Result<()> {
    ensure_nssm()?;
    let status = Command::new("nssm")
        .arg("stop")
        .arg(SERVICE_NAME)
        .status()
        .context("failed to spawn `nssm stop`")?;
    if !status.success() {
        bail!("`nssm stop \"{SERVICE_NAME}\"` exited with {status}");
    }
    Ok(())
}

pub fn status() -> Result<ServiceStatus> {
    ensure_nssm()?;
    let output = Command::new("nssm")
        .arg("status")
        .arg(SERVICE_NAME)
        .output()
        .context("failed to spawn `nssm status`")?;
    Ok(parse_nssm_status(
        output.status.code(),
        &String::from_utf8_lossy(&output.stdout),
    ))
}

/// Map `nssm status "<name>"` output to a [`ServiceStatus`].
///
/// NSSM emits a single SCM constant on stdout, e.g. `SERVICE_RUNNING`,
/// `SERVICE_STOPPED`, `SERVICE_PAUSED`. If NSSM can't find the service
/// it exits non-zero with `Can't open service!` on stderr — we treat
/// any non-zero exit as `NotInstalled`.
pub fn parse_nssm_status(exit_code: Option<i32>, stdout: &str) -> ServiceStatus {
    if exit_code != Some(0) {
        return ServiceStatus::NotInstalled;
    }
    match stdout.trim() {
        "SERVICE_RUNNING" => ServiceStatus::Running,
        "SERVICE_STOPPED" | "SERVICE_PAUSED" => ServiceStatus::Stopped,
        _ => ServiceStatus::Stopped,
    }
}

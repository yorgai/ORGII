//! CLI entry point for the orgii-mobile-relay binary.
//!
//! Subcommands:
//!   serve       — run server in foreground (default; what `bin/main.rs`
//!                 used to do directly)
//!   install     — install service (launchd / systemd / NSSM)
//!   uninstall   — remove service
//!   start       — start the installed service
//!   stop        — stop the installed service
//!   status      — print "running | stopped | not_installed"
//!
//! Each platform-specific service-manager strategy lives in its own
//! sibling module (`launchd.rs`, `systemd.rs`, `windows.rs`). The
//! `Serve` branch is the only one that initialises tracing and boots
//! the axum server; install/uninstall/start/stop/status shell out to
//! the native service manager and return immediately.

use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};

use crate::config::AppConfig;
use crate::server;

#[cfg(target_os = "macos")]
pub mod launchd;
#[cfg(target_os = "linux")]
pub mod systemd;
#[cfg(target_os = "windows")]
pub mod windows;

/// Typed status returned by every platform's `status()` implementation.
///
/// Avoids stringly-typed return values in match arms and gives callers
/// (including future programmatic users) a stable contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceStatus {
    Running,
    Stopped,
    NotInstalled,
}

impl ServiceStatus {
    /// Stable lower-snake-case label for CLI / log output.
    pub fn as_label(self) -> &'static str {
        match self {
            ServiceStatus::Running => "running",
            ServiceStatus::Stopped => "stopped",
            ServiceStatus::NotInstalled => "not_installed",
        }
    }
}

impl std::fmt::Display for ServiceStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_label())
    }
}

#[derive(Debug, Parser)]
#[command(
    name = "orgii-mobile-relay",
    version,
    about = "ORGII mobile remote relay"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Run the relay server in the foreground (default if no subcommand).
    Serve(ServeArgs),
    /// Install as a system service (launchd / systemd / Windows service).
    Install {
        /// Path to the relay config file (recorded in the service unit
        /// so the daemon picks it up on start).
        #[arg(long)]
        config: Option<PathBuf>,
    },
    /// Remove the installed system service.
    Uninstall,
    /// Start the installed service.
    Start,
    /// Stop the installed service.
    Stop,
    /// Print service status (`running | stopped | not_installed`).
    Status,
}

#[derive(Debug, clap::Args, Default)]
pub struct ServeArgs {
    /// Override the bind address (defaults to `AppConfig::default()`).
    #[arg(long)]
    pub listen_addr: Option<SocketAddr>,

    /// Override the relay-local SQLite path.
    #[arg(long)]
    pub storage_path: Option<PathBuf>,
}

/// Parse argv, dispatch to the right module, and translate subcommand
/// outcomes into `anyhow::Result`. The binary's `main` is a thin
/// wrapper around this.
pub async fn run_cli() -> Result<()> {
    let cli = Cli::parse();
    match cli.command.unwrap_or(Command::Serve(ServeArgs::default())) {
        Command::Serve(args) => serve(args).await,
        Command::Install { config } => install(config),
        Command::Uninstall => uninstall(),
        Command::Start => start(),
        Command::Stop => stop(),
        Command::Status => {
            let status = status()?;
            println!("{status}");
            Ok(())
        }
    }
}

async fn serve(args: ServeArgs) -> Result<()> {
    let mut config = AppConfig::default();
    if let Some(addr) = args.listen_addr {
        config.listen_addr = addr;
    }
    if let Some(path) = args.storage_path {
        config.storage_path = path;
    }
    server::run(config)
        .await
        .context("relay server exited with error")
}

// ---------------------------------------------------------------------------
// Per-platform dispatch shims. Each platform's implementation lives in a
// dedicated module guarded by `#[cfg(target_os = ...)]`; on other targets
// we return a clear error so misconfigured cross-builds don't silently
// no-op.
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn install(config: Option<PathBuf>) -> Result<()> {
    launchd::install(config.as_deref())
}
#[cfg(target_os = "linux")]
fn install(config: Option<PathBuf>) -> Result<()> {
    systemd::install(config.as_deref())
}
#[cfg(target_os = "windows")]
fn install(config: Option<PathBuf>) -> Result<()> {
    windows::install(config.as_deref())
}
#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn install(_config: Option<PathBuf>) -> Result<()> {
    anyhow::bail!("service install not supported on this platform")
}

#[cfg(target_os = "macos")]
fn uninstall() -> Result<()> {
    launchd::uninstall()
}
#[cfg(target_os = "linux")]
fn uninstall() -> Result<()> {
    systemd::uninstall()
}
#[cfg(target_os = "windows")]
fn uninstall() -> Result<()> {
    windows::uninstall()
}
#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn uninstall() -> Result<()> {
    anyhow::bail!("service uninstall not supported on this platform")
}

#[cfg(target_os = "macos")]
fn start() -> Result<()> {
    launchd::start()
}
#[cfg(target_os = "linux")]
fn start() -> Result<()> {
    systemd::start()
}
#[cfg(target_os = "windows")]
fn start() -> Result<()> {
    windows::start()
}
#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn start() -> Result<()> {
    anyhow::bail!("service start not supported on this platform")
}

#[cfg(target_os = "macos")]
fn stop() -> Result<()> {
    launchd::stop()
}
#[cfg(target_os = "linux")]
fn stop() -> Result<()> {
    systemd::stop()
}
#[cfg(target_os = "windows")]
fn stop() -> Result<()> {
    windows::stop()
}
#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn stop() -> Result<()> {
    anyhow::bail!("service stop not supported on this platform")
}

#[cfg(target_os = "macos")]
fn status() -> Result<ServiceStatus> {
    launchd::status()
}
#[cfg(target_os = "linux")]
fn status() -> Result<ServiceStatus> {
    systemd::status()
}
#[cfg(target_os = "windows")]
fn status() -> Result<ServiceStatus> {
    windows::status()
}
#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn status() -> Result<ServiceStatus> {
    anyhow::bail!("service status not supported on this platform")
}

#[cfg(test)]
#[path = "cli_tests.rs"]
mod tests;

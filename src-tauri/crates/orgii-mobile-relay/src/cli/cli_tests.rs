//! Unit tests for the CLI layer.
//!
//! These tests must not touch the OS service manager — they only
//! exercise the pure helpers (template rendering, status parsing) and
//! the `clap` parser definition. Per-platform tests are gated by the
//! same `#[cfg(target_os = ...)]` as the modules they exercise so a
//! Linux CI box doesn't try to compile macOS-only paths and vice versa.

use super::{Cli, Command, ServiceStatus};
use clap::Parser;

#[test]
fn no_subcommand_parses_as_none() {
    let cli = Cli::parse_from(["orgii-mobile-relay"]);
    assert!(
        cli.command.is_none(),
        "bare invocation must default to Serve via `unwrap_or` in run_cli",
    );
}

#[test]
fn install_subcommand_parses() {
    let cli = Cli::parse_from(["orgii-mobile-relay", "install"]);
    match cli.command {
        Some(Command::Install { config }) => assert!(config.is_none()),
        other => panic!("expected Install, got {other:?}"),
    }
}

#[test]
fn install_subcommand_accepts_config_flag() {
    let cli = Cli::parse_from([
        "orgii-mobile-relay",
        "install",
        "--config",
        "/etc/relay.toml",
    ]);
    match cli.command {
        Some(Command::Install { config }) => {
            let path = config.expect("--config should populate config field");
            assert_eq!(path.to_string_lossy(), "/etc/relay.toml");
        }
        other => panic!("expected Install, got {other:?}"),
    }
}

#[test]
fn lifecycle_subcommands_parse() {
    let uninstall = Cli::parse_from(["orgii-mobile-relay", "uninstall"]).command;
    assert!(matches!(uninstall, Some(Command::Uninstall)));

    let start = Cli::parse_from(["orgii-mobile-relay", "start"]).command;
    assert!(matches!(start, Some(Command::Start)));

    let stop = Cli::parse_from(["orgii-mobile-relay", "stop"]).command;
    assert!(matches!(stop, Some(Command::Stop)));

    let status = Cli::parse_from(["orgii-mobile-relay", "status"]).command;
    assert!(matches!(status, Some(Command::Status)));
}

#[test]
fn service_status_labels_are_stable() {
    assert_eq!(ServiceStatus::Running.as_label(), "running");
    assert_eq!(ServiceStatus::Stopped.as_label(), "stopped");
    assert_eq!(ServiceStatus::NotInstalled.as_label(), "not_installed");
    assert_eq!(format!("{}", ServiceStatus::Running), "running");
}

#[cfg(target_os = "macos")]
#[test]
fn launchd_plist_renders_with_substitutions() {
    use std::path::Path;

    let plist = super::launchd::render_plist(
        Path::new("/usr/local/bin/orgii-mobile-relay"),
        Path::new("/Users/me/Library/Logs/ORGII/mobile-relay-out.log"),
        Path::new("/Users/me/Library/Logs/ORGII/mobile-relay-err.log"),
    );

    assert!(plist.contains("<string>com.orgii.mobile-relay</string>"));
    assert!(plist.contains("<string>/usr/local/bin/orgii-mobile-relay</string>"));
    assert!(plist.contains("<string>serve</string>"));
    assert!(plist.contains("mobile-relay-out.log"));
    assert!(plist.contains("mobile-relay-err.log"));
    assert!(plist.contains("<key>RunAtLoad</key>"));
    assert!(plist.contains("<key>KeepAlive</key>"));
}

#[cfg(target_os = "macos")]
#[test]
fn launchctl_list_exit_codes_map_to_status() {
    use super::launchd::parse_launchctl_list;
    // Non-zero exit ⇒ label unknown ⇒ NotInstalled.
    assert_eq!(
        parse_launchctl_list(Some(113), ""),
        ServiceStatus::NotInstalled
    );
    assert_eq!(parse_launchctl_list(None, ""), ServiceStatus::NotInstalled);
    // Zero exit + PID present ⇒ Running.
    let running = "{\n\t\"PID\" = 12345;\n\t\"Label\" = \"com.orgii.mobile-relay\";\n}\n";
    assert_eq!(
        parse_launchctl_list(Some(0), running),
        ServiceStatus::Running
    );
    // Zero exit + no PID line ⇒ Stopped (loaded but not running).
    let loaded_idle = "{\n\t\"Label\" = \"com.orgii.mobile-relay\";\n}\n";
    assert_eq!(
        parse_launchctl_list(Some(0), loaded_idle),
        ServiceStatus::Stopped
    );
}

#[cfg(target_os = "linux")]
#[test]
fn systemd_unit_renders_with_substitutions() {
    use std::path::Path;

    let unit = super::systemd::render_unit(Path::new("/usr/local/bin/orgii-mobile-relay"));

    assert!(unit.contains("Description=ORGII Mobile Remote Relay"));
    assert!(unit.contains("ExecStart=/usr/local/bin/orgii-mobile-relay serve"));
    assert!(unit.contains("Restart=on-failure"));
    assert!(unit.contains("WantedBy=default.target"));
    assert!(unit.contains("Type=simple"));
}

#[cfg(target_os = "linux")]
#[test]
fn systemd_is_active_maps_to_status() {
    use super::systemd::parse_is_active;
    assert_eq!(parse_is_active(Some(0), "active\n"), ServiceStatus::Running);
    assert_eq!(
        parse_is_active(Some(3), "inactive\n"),
        ServiceStatus::Stopped
    );
    assert_eq!(parse_is_active(Some(3), "failed\n"), ServiceStatus::Stopped);
    assert_eq!(parse_is_active(None, ""), ServiceStatus::Stopped);
}

#[cfg(target_os = "windows")]
#[test]
fn nssm_status_maps_scm_constants() {
    use super::windows::parse_nssm_status;
    assert_eq!(
        parse_nssm_status(Some(0), "SERVICE_RUNNING\r\n"),
        ServiceStatus::Running
    );
    assert_eq!(
        parse_nssm_status(Some(0), "SERVICE_STOPPED\r\n"),
        ServiceStatus::Stopped
    );
    assert_eq!(
        parse_nssm_status(Some(0), "SERVICE_PAUSED\r\n"),
        ServiceStatus::Stopped
    );
    assert_eq!(parse_nssm_status(Some(1), ""), ServiceStatus::NotInstalled);
}

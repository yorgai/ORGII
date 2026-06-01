use super::*;

#[test]
fn dev_peekaboo_path_points_to_src_tauri_bin() {
    let path = dev_peekaboo_path("/repo/src-tauri/crates/agent-core");
    assert_eq!(path, PathBuf::from("/repo/src-tauri/bin/peekaboo"));
}

#[test]
fn placeholder_sidecar_file_is_not_real() {
    let path = std::env::temp_dir().join(format!(
        "orgii-peekaboo-placeholder-test-{}",
        std::process::id()
    ));
    std::fs::write(
        &path,
        format!(
            "{}\nresource=bin/peekaboo\n",
            OPTIONAL_SIDECAR_PLACEHOLDER_MARKER
        ),
    )
    .expect("write placeholder");

    assert!(!is_real_sidecar_file(&path));

    std::fs::remove_file(path).expect("remove placeholder");
}

#[test]
fn allowlist_accepts_desktop_commands() {
    let args = vec!["see".to_string(), "--json".to_string()];
    assert!(ensure_allowed_peekaboo_command(&args).is_ok());
}

#[test]
fn allowlist_rejects_executable_prefix() {
    let args = vec!["peekaboo".to_string(), "see".to_string()];
    let err = ensure_allowed_peekaboo_command(&args).unwrap_err();
    assert!(err.contains("Do not include the peekaboo executable name"));
}

#[test]
fn allowlist_rejects_non_desktop_commands() {
    let args = vec!["daemon".to_string(), "start".to_string()];
    let err = ensure_allowed_peekaboo_command(&args).unwrap_err();
    assert!(err.contains("Unsupported Peekaboo command 'daemon'"));
}

use crate::state::commands::desktop::DesktopConfig;

fn args(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| part.to_string()).collect()
}

fn contains(command_args: &[String], value: &str) -> bool {
    command_args.iter().any(|arg| arg == value)
}

#[test]
fn managed_args_force_no_remote_on_every_command() {
    let config = DesktopConfig::default();

    let mut input = args(&["click", "--on", "B1"]);
    apply_managed_args(&mut input, &config);
    assert!(contains(&input, "--no-remote"));

    let mut observation = args(&["see"]);
    apply_managed_args(&mut observation, &config);
    assert!(contains(&observation, "--no-remote"));
}

#[test]
fn managed_args_do_not_duplicate_explicit_no_remote() {
    let mut command_args = args(&["see", "--no-remote"]);
    apply_managed_args(&mut command_args, &DesktopConfig::default());
    let count = command_args
        .iter()
        .filter(|arg| *arg == "--no-remote")
        .count();
    assert_eq!(count, 1);
}

#[test]
fn managed_args_inject_synth_first_for_input_commands() {
    let mut command_args = args(&["click", "--on", "B1"]);
    apply_managed_args(&mut command_args, &DesktopConfig::default());
    assert!(contains(&command_args, "--input-strategy"));
    assert!(contains(&command_args, SYNTH_FIRST_STRATEGY));
}

#[test]
fn managed_args_inject_human_profile_for_type_command() {
    let mut command_args = args(&["type", "--text", "hello"]);
    apply_managed_args(&mut command_args, &DesktopConfig::default());
    assert!(contains(&command_args, "--input-strategy"));
    assert!(contains(&command_args, SYNTH_FIRST_STRATEGY));
    assert!(contains(&command_args, "--profile"));
    assert!(contains(&command_args, HUMAN_PROFILE));
}

#[test]
fn managed_args_skip_anti_detection_when_config_disabled() {
    let config = DesktopConfig {
        anti_detection: false,
        ..DesktopConfig::default()
    };
    let mut command_args = args(&["click", "--on", "B1"]);
    apply_managed_args(&mut command_args, &config);
    assert!(!contains(&command_args, "--input-strategy"));
    // --no-remote is not user-configurable and stays on.
    assert!(contains(&command_args, "--no-remote"));
}

#[test]
fn managed_args_skip_human_profile_when_config_disabled() {
    let config = DesktopConfig {
        human_input_profile: false,
        ..DesktopConfig::default()
    };
    let mut command_args = args(&["type", "--text", "hi"]);
    apply_managed_args(&mut command_args, &config);
    assert!(!contains(&command_args, "--profile"));
    // anti_detection is still on, so synthFirst remains.
    assert!(contains(&command_args, SYNTH_FIRST_STRATEGY));
}

#[test]
fn managed_args_inject_json_for_observation_commands() {
    let mut command_args = args(&["see", "--app", "Safari"]);
    apply_managed_args(&mut command_args, &DesktopConfig::default());
    assert!(contains(&command_args, "--json"));
}

#[test]
fn managed_args_respect_short_json_flag() {
    let mut command_args = args(&["list", "-j"]);
    apply_managed_args(&mut command_args, &DesktopConfig::default());
    assert!(!contains(&command_args, "--json"));
}

#[test]
fn managed_args_skip_input_strategy_for_observation_commands() {
    let mut command_args = args(&["see"]);
    apply_managed_args(&mut command_args, &DesktopConfig::default());
    assert!(!contains(&command_args, "--input-strategy"));
}

#[test]
fn managed_args_respect_explicit_input_strategy() {
    let mut command_args = args(&["click", "--on", "B1", "--input-strategy", "actionOnly"]);
    apply_managed_args(&mut command_args, &DesktopConfig::default());
    assert!(contains(&command_args, "actionOnly"));
    assert!(!contains(&command_args, SYNTH_FIRST_STRATEGY));
}

#[test]
fn managed_args_respect_explicit_profile_and_delay() {
    let mut with_profile = args(&["type", "--text", "hi", "--profile", "linear"]);
    apply_managed_args(&mut with_profile, &DesktopConfig::default());
    assert!(!contains(&with_profile, HUMAN_PROFILE));

    let mut with_delay = args(&["type", "--text", "hi", "--delay", "0"]);
    apply_managed_args(&mut with_delay, &DesktopConfig::default());
    assert!(!contains(&with_delay, "--profile"));
}

#[test]
fn sleep_command_gets_extended_timeout() {
    assert_eq!(
        command_timeout(&args(&["sleep", "300"])),
        PEEKABOO_SLEEP_TIMEOUT
    );
    assert_eq!(
        command_timeout(&args(&["click", "--on", "B1"])),
        PEEKABOO_COMMAND_TIMEOUT
    );
}

#[test]
fn format_output_includes_stdout_and_stderr_when_present() {
    let output = PeekabooCliOutput {
        status: Some(0),
        stdout: "{\"ok\":true}".to_string(),
        stderr: "warning".to_string(),
    };

    let formatted = format_peekaboo_output(&output);
    assert!(formatted.contains("status 0"));
    assert!(formatted.contains("stdout:\n{\"ok\":true}"));
    assert!(formatted.contains("stderr:\nwarning"));
}

#[test]
fn format_output_omits_empty_streams() {
    let output = PeekabooCliOutput {
        status: None,
        stdout: String::new(),
        stderr: String::new(),
    };

    assert_eq!(
        format_peekaboo_output(&output),
        "Peekaboo CLI completed with status unknown."
    );
}

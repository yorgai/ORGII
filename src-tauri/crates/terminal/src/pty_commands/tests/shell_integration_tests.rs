use super::*;

#[test]
fn zsh_config_sets_zdotdir() {
    let config = integration_config(&ShellKind::Zsh);
    assert!(config.is_some(), "zsh should produce a config");
    let config = config.unwrap();
    assert!(!config.strip_login_args);

    let zdotdir = config
        .env_vars
        .iter()
        .find(|(k, _)| k == "ZDOTDIR")
        .map(|(_, v)| v.as_str());
    assert!(zdotdir.is_some(), "must set ZDOTDIR");
    assert!(
        zdotdir.unwrap().contains("orgii-shell-integration"),
        "ZDOTDIR should point to temp dir"
    );

    let user_zdotdir = config.env_vars.iter().find(|(k, _)| k == "USER_ZDOTDIR");
    assert!(user_zdotdir.is_some(), "must set USER_ZDOTDIR");
}

#[test]
fn bash_config_uses_init_file() {
    let config = integration_config(&ShellKind::Bash).unwrap();
    assert!(config.strip_login_args, "bash needs --login removed");
    assert_eq!(config.prepend_args[0], "--init-file");
    assert!(config.prepend_args[1].contains("shellIntegration.bash"));
}

#[test]
fn fish_config_uses_init_command() {
    let config = integration_config(&ShellKind::Fish).unwrap();
    assert!(!config.strip_login_args);
    assert_eq!(config.prepend_args[0], "--init-command");
    assert!(config.prepend_args[1].contains("shellIntegration.fish"));
}

#[test]
fn pwsh_config_uses_noexit_command() {
    let config = integration_config(&ShellKind::Pwsh).unwrap();
    assert_eq!(config.prepend_args[0], "-noexit");
    assert_eq!(config.prepend_args[1], "-command");
    assert!(config.prepend_args[2].contains("shellIntegration.ps1"));
}

#[test]
fn unsupported_shell_returns_none() {
    assert!(integration_config(&ShellKind::Node).is_none());
    assert!(integration_config(&ShellKind::Python).is_none());
    assert!(integration_config(&ShellKind::Unknown).is_none());
}

#[test]
fn scripts_are_embedded() {
    assert!(ZSH_SCRIPT.contains("ORGII_SHELL_INTEGRATION"));
    assert!(BASH_SCRIPT.contains("ORGII_SHELL_INTEGRATION"));
    assert!(FISH_SCRIPT.contains("ORGII_SHELL_INTEGRATION"));
    assert!(PWSH_SCRIPT.contains("ORGII_SHELL_INTEGRATION"));
}

#[test]
fn write_if_changed_is_idempotent() {
    let dir = std::env::temp_dir().join("orgii-test-idempotent");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("test.txt");
    let content = "hello world";

    write_if_changed(&path, content).unwrap();
    let mtime1 = std::fs::metadata(&path).unwrap().modified().unwrap();

    std::thread::sleep(std::time::Duration::from_millis(50));

    write_if_changed(&path, content).unwrap();
    let mtime2 = std::fs::metadata(&path).unwrap().modified().unwrap();

    assert_eq!(
        mtime1, mtime2,
        "file should not be rewritten when unchanged"
    );

    std::fs::remove_dir_all(&dir).ok();
}

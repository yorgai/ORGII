use crate::workspace_config::{
    is_server_enabled, load_workspace_settings, save_workspace_settings, set_server_enabled,
    WorkspaceSettings,
};
use tempfile::tempdir;

#[test]
fn test_default_settings() {
    let settings = WorkspaceSettings::default();
    assert!(settings.lsp.disabled.is_empty());
    assert!(settings.lint.disabled.is_empty());
}

#[test]
fn test_load_nonexistent_settings() {
    let dir = tempdir().unwrap();
    let settings = load_workspace_settings(dir.path().to_str().unwrap());
    assert!(settings.lsp.disabled.is_empty());
}

#[test]
fn test_save_and_load_settings() {
    let dir = tempdir().unwrap();
    let workspace_path = dir.path().to_str().unwrap();

    let mut settings = WorkspaceSettings::default();
    settings.lsp.disabled.push("python".to_string());

    save_workspace_settings(workspace_path, &settings).unwrap();

    let loaded = load_workspace_settings(workspace_path);
    assert_eq!(loaded.lsp.disabled, vec!["python"]);
}

#[test]
fn test_is_server_enabled() {
    let dir = tempdir().unwrap();
    let workspace_path = dir.path().to_str().unwrap();

    // Initially all servers are enabled
    assert!(is_server_enabled(workspace_path, "typescript"));
    assert!(is_server_enabled(workspace_path, "python"));

    // Disable python
    set_server_enabled(workspace_path, "python", false).unwrap();

    assert!(is_server_enabled(workspace_path, "typescript"));
    assert!(!is_server_enabled(workspace_path, "python"));

    // Re-enable python
    set_server_enabled(workspace_path, "python", true).unwrap();
    assert!(is_server_enabled(workspace_path, "python"));
}

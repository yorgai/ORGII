use crate::nodes::command_policy::*;

#[test]
fn test_default_allows_camera() {
    assert!(is_command_allowed("camera.snap", None, &[]));
    assert!(is_command_allowed("camera.list", None, &[]));
}

#[test]
fn test_default_denies_unknown() {
    assert!(!is_command_allowed("evil.command", None, &[]));
}

#[test]
fn test_custom_allowlist() {
    let custom = vec!["camera.snap".to_string()];
    assert!(is_command_allowed("camera.snap", None, &custom));
    assert!(!is_command_allowed("system.run", None, &custom));
}

use crate::orchestrator::diff_stats::*;

// ============================================
// parse_rename_path
// ============================================

#[test]
fn parse_rename_path_with_braces() {
    let (old, new) = parse_rename_path("src/{old.rs => new.rs}");
    assert_eq!(old, "src/old.rs");
    assert_eq!(new, "src/new.rs");
}

#[test]
fn parse_rename_path_prefix_only() {
    let (old, new) = parse_rename_path("{old => new}/file.rs");
    assert_eq!(old, "old/file.rs");
    assert_eq!(new, "new/file.rs");
}

#[test]
fn parse_rename_path_dir_with_braces() {
    let (old, new) = parse_rename_path("dir/{old_name => new_name}/file.rs");
    assert_eq!(old, "dir/old_name/file.rs");
    assert_eq!(new, "dir/new_name/file.rs");
}

#[test]
fn parse_rename_path_no_braces() {
    let (old, new) = parse_rename_path("old.rs => new.rs");
    assert_eq!(old, "old.rs");
    assert_eq!(new, "new.rs");
}

#[test]
fn parse_rename_path_fallback_same_path() {
    let (old, new) = parse_rename_path("just_a_path.rs");
    assert_eq!(old, "just_a_path.rs");
    assert_eq!(new, "just_a_path.rs");
}

// ============================================
// is_infrastructure_file
// ============================================

#[test]
fn is_infrastructure_file_orgii_config() {
    assert!(is_infrastructure_file(".orgii/config.yaml"));
}

#[test]
fn is_infrastructure_file_orgii_root() {
    assert!(is_infrastructure_file(".orgii"));
}

#[test]
fn is_infrastructure_file_orgii_subpath() {
    assert!(is_infrastructure_file(".orgii/foo"));
}

#[test]
fn is_infrastructure_file_src_main_false() {
    assert!(!is_infrastructure_file("src/main.rs"));
}

#[test]
fn is_infrastructure_file_package_json_false() {
    assert!(!is_infrastructure_file("package.json"));
}

#[test]
fn is_infrastructure_file_empty_false() {
    assert!(!is_infrastructure_file(""));
}

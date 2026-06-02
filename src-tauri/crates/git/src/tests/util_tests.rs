use crate::util::*;

// ============================================
// is_transient_error
// ============================================

#[test]
fn is_transient_error_bad_file_descriptor() {
    assert!(is_transient_error("Bad file descriptor"));
}

#[test]
fn is_transient_error_resource_temporarily_unavailable() {
    assert!(is_transient_error("Resource temporarily unavailable"));
}

#[test]
fn is_transient_error_os_error_9() {
    assert!(is_transient_error("os error 9"));
}

#[test]
fn is_transient_error_too_many_open_files() {
    assert!(is_transient_error("Too many open files"));
}

#[test]
fn is_transient_error_os_error_24() {
    assert!(is_transient_error("os error 24"));
}

#[test]
fn is_transient_error_not_git_repo_false() {
    assert!(!is_transient_error("not a git repository"));
}

#[test]
fn is_transient_error_random_error_false() {
    assert!(!is_transient_error("random error"));
}

#[test]
fn is_transient_error_empty_false() {
    assert!(!is_transient_error(""));
}

// ============================================
// user_friendly_error
// ============================================

#[test]
fn user_friendly_error_transient() {
    let msg = user_friendly_error("Bad file descriptor", "checking status");
    assert!(msg.contains("system is busy"));
}

#[test]
fn user_friendly_error_not_git_repository() {
    let msg = user_friendly_error("fatal: not a git repository", "status");
    assert_eq!(msg, "This folder is not a git repository.");
}

#[test]
fn user_friendly_error_permission_denied() {
    let msg = user_friendly_error("permission denied", "push");
    assert!(msg.contains("Permission denied"));
}

#[test]
fn user_friendly_error_permission_denied_capitalized() {
    let msg = user_friendly_error("Permission denied", "pull");
    assert!(msg.contains("Permission denied"));
}

#[test]
fn user_friendly_error_generic() {
    let msg = user_friendly_error("some random error", "fetch");
    assert!(msg.starts_with("Git operation failed:"));
}

// ============================================
// operation_name_from_args
// ============================================

#[test]
fn operation_name_status() {
    assert_eq!(operation_name_from_args(&["status"]), "checking status");
}

#[test]
fn operation_name_branch() {
    assert_eq!(operation_name_from_args(&["branch"]), "branch operation");
}

#[test]
fn operation_name_checkout() {
    assert_eq!(operation_name_from_args(&["checkout"]), "checkout");
}

#[test]
fn operation_name_commit() {
    assert_eq!(operation_name_from_args(&["commit"]), "commit");
}

#[test]
fn operation_name_push() {
    assert_eq!(operation_name_from_args(&["push"]), "push");
}

#[test]
fn operation_name_pull() {
    assert_eq!(operation_name_from_args(&["pull"]), "pull");
}

#[test]
fn operation_name_fetch() {
    assert_eq!(operation_name_from_args(&["fetch"]), "fetch");
}

#[test]
fn operation_name_log() {
    assert_eq!(operation_name_from_args(&["log"]), "viewing history");
}

#[test]
fn operation_name_diff() {
    assert_eq!(operation_name_from_args(&["diff"]), "viewing changes");
}

#[test]
fn operation_name_add() {
    assert_eq!(operation_name_from_args(&["add"]), "staging files");
}

#[test]
fn operation_name_unknown() {
    assert_eq!(operation_name_from_args(&["unknown"]), "this operation");
}

#[test]
fn operation_name_empty() {
    assert_eq!(operation_name_from_args(&[]), "this operation");
}

// ============================================
// Git executable resolution
// ============================================

#[test]
fn resolved_git_exec_path_uses_bundled_libexec() {
    let root = std::env::temp_dir().join(format!(
        "orgii-git-util-test-{}",
        std::process::id()
    ));
    let git_bin = root.join("git").join("bin");
    let git_core = root.join("git").join("libexec").join("git-core");
    std::fs::create_dir_all(&git_bin).unwrap();
    std::fs::create_dir_all(&git_core).unwrap();

    let git_executable = git_bin.join("git");
    assert_eq!(resolved_git_exec_path(&git_executable), Some(git_core));

    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn resolved_git_exec_path_requires_existing_libexec() {
    let git_executable = std::path::Path::new("/app/Resources/git/bin/git");
    assert_eq!(resolved_git_exec_path(git_executable), None);
}

#[test]
fn auto_mode_prefers_system_git() {
    let system_git = std::path::PathBuf::from("/usr/local/bin/git");
    let bundled_git = std::path::PathBuf::from("/app/Resources/git/bin/git");

    let resolved = resolve_git_executable_from_candidates(
        GitExecutableMode::Auto,
        Some(system_git.clone()),
        Some(bundled_git),
        vec![system_git.clone()],
        Vec::new(),
    )
    .unwrap();

    assert_eq!(resolved.path, system_git);
    assert!(!resolved.is_bundled);
}

#[test]
fn auto_mode_falls_back_to_bundled_git() {
    let bundled_git = std::path::PathBuf::from("/app/Resources/git/bin/git");

    let resolved = resolve_git_executable_from_candidates(
        GitExecutableMode::Auto,
        None,
        Some(bundled_git.clone()),
        Vec::new(),
        vec![bundled_git.clone()],
    )
    .unwrap();

    assert_eq!(resolved.path, bundled_git);
    assert!(resolved.is_bundled);
}

#[test]
fn system_mode_requires_system_git() {
    let err = resolve_git_executable_from_candidates(
        GitExecutableMode::System,
        None,
        Some(std::path::PathBuf::from("/app/Resources/git/bin/git")),
        vec![std::path::PathBuf::from("/missing/git")],
        Vec::new(),
    )
    .unwrap_err();

    assert!(err.contains("System Git executable not found"));
}

#[test]
fn bundled_mode_requires_bundled_git() {
    let err = resolve_git_executable_from_candidates(
        GitExecutableMode::Bundled,
        Some(std::path::PathBuf::from("/usr/local/bin/git")),
        None,
        Vec::new(),
        vec![std::path::PathBuf::from("/missing/bundled/git")],
    )
    .unwrap_err();

    assert!(err.contains("Bundled Git executable not found"));
}

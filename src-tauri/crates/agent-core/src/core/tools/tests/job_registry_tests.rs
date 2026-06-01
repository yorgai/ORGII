use std::path::PathBuf;

use crate::tools::impls::coding::exec::registry::{self, JobKind, JobStatus};

#[test]
fn test_register_shell_and_get() {
    let pid = 99990;
    let tx = registry::register_shell(
        pid,
        "sleep 100".into(),
        PathBuf::from("/tmp/1.txt"),
        "s1".into(),
    );
    let handle = pid.to_string();
    assert!(registry::get_status(&handle).is_some());
    let (status, kind) = registry::get_status(&handle).unwrap();
    assert!(matches!(status, JobStatus::Running));
    assert!(matches!(kind, JobKind::Shell { .. }));

    let _ = tx.send("hello\n".into());
    assert!(registry::subscribe(&handle).is_some());

    registry::remove(&handle);
    assert!(registry::get_status(&handle).is_none());
}

#[test]
fn test_mark_exited_shell() {
    let pid = 99991;
    let _tx = registry::register_shell(pid, "ls".into(), PathBuf::from("/tmp/2.txt"), "s1".into());
    let handle = pid.to_string();
    registry::mark_exited(&handle, JobStatus::Exited(0));
    let (status, _) = registry::get_status(&handle).unwrap();
    assert!(matches!(status, JobStatus::Exited(0)));
    registry::remove(&handle);
}

#[test]
fn test_register_subagent() {
    let handle = "shadow-builtin:general-abc123".to_string();
    let tx = registry::register_subagent(
        handle.clone(),
        "shadow".into(),
        "General Agent".into(),
        "parent-session".into(),
    );
    assert!(registry::get_status(&handle).is_some());
    let (status, kind) = registry::get_status(&handle).unwrap();
    assert!(matches!(status, JobStatus::Running));
    assert!(matches!(kind, JobKind::Subagent { .. }));

    let _ = tx.send("tool call: read_file\n".into());
    assert!(registry::subscribe(&handle).is_some());

    registry::set_final_result(&handle, "Found 7 files.".into());
    assert_eq!(
        registry::get_final_result(&handle),
        Some("Found 7 files.".into())
    );

    registry::mark_exited(&handle, JobStatus::Completed);
    let (status, _) = registry::get_status(&handle).unwrap();
    assert!(matches!(status, JobStatus::Completed));

    registry::remove(&handle);
    assert!(registry::get_status(&handle).is_none());
}

#[test]
fn test_list_shell_for_session() {
    let pid_a = 99992;
    let pid_b = 99993;
    let _tx_a = registry::register_shell(
        pid_a,
        "cmd_a".into(),
        PathBuf::from("/tmp/a.txt"),
        "session_x".into(),
    );
    let _tx_b = registry::register_shell(
        pid_b,
        "cmd_b".into(),
        PathBuf::from("/tmp/b.txt"),
        "session_y".into(),
    );

    let list = registry::list_shell_for_session("session_x");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].0, pid_a);

    registry::remove(&pid_a.to_string());
    registry::remove(&pid_b.to_string());
}

#[test]
fn test_subagent_not_in_shell_list() {
    let handle = "agent-builtin:explore-xyz".to_string();
    let _tx = registry::register_subagent(
        handle.clone(),
        "explore".into(),
        "Explorer".into(),
        "session_x".into(),
    );

    let list = registry::list_shell_for_session("session_x");
    assert!(list.is_empty());

    registry::remove(&handle);
}

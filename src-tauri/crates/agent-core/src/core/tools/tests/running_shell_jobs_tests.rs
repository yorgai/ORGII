use std::path::PathBuf;

use crate::tools::impls::coding::exec::registry::{self, JobStatus};

#[test]
fn test_list_running_shell_jobs_includes_running() {
    let pid = 88801;
    let _tx = registry::register_shell(
        pid,
        "npm run dev".into(),
        PathBuf::from("/tmp/88801.log"),
        "session_recon_a".into(),
    );

    let jobs = registry::list_running_shell_jobs();
    let found = jobs.iter().find(|j| j.pid == pid);
    assert!(found.is_some(), "running shell job should appear in list");

    let job = found.unwrap();
    assert_eq!(job.session_id, "session_recon_a");
    assert_eq!(job.command, "npm run dev");
    assert!(job.log_path.is_some());

    registry::remove(&pid.to_string());
}

#[test]
fn test_list_running_shell_jobs_excludes_exited() {
    let pid = 88802;
    let _tx = registry::register_shell(
        pid,
        "echo done".into(),
        PathBuf::from("/tmp/88802.log"),
        "session_recon_b".into(),
    );
    registry::mark_exited(&pid.to_string(), JobStatus::Exited(0));

    let jobs = registry::list_running_shell_jobs();
    assert!(
        !jobs.iter().any(|j| j.pid == pid),
        "exited shell job should not appear in running list"
    );

    registry::remove(&pid.to_string());
}

#[test]
fn test_list_running_shell_jobs_excludes_subagents() {
    let handle = "agent-recon-test:explore-001".to_string();
    let _tx = registry::register_subagent(
        handle.clone(),
        "explore".into(),
        "Explorer".into(),
        "session_recon_c".into(),
    );

    let jobs = registry::list_running_shell_jobs();
    assert!(
        !jobs.iter().any(|j| j.session_id == "session_recon_c"),
        "subagent should not appear in shell job list"
    );

    registry::remove(&handle);
}

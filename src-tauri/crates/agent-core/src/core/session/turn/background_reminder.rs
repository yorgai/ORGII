//! Builds per-turn system-prompt reminders for active background jobs.
//!
//! Injected into `dynamic_sections` in `UnifiedMessageProcessor::process()` so
//! the model is aware of running / unacknowledged-completed shell processes and
//! subagents without having to call `await_output list` every turn.
//!
//! Design goals:
//! - **Accurate status** — uses real-time registry state, not cached text.
//! - **Auto-cleanup** — completed jobs whose output was read via AwaitTool
//!   are excluded (acknowledged).
//! - **Compact** — one block, fixed token budget regardless of job count.

use crate::tools::impls::coding::exec::registry::{JobSnapshot, JobStatus};

pub fn build_background_jobs_reminder(jobs: &[JobSnapshot]) -> String {
    let mut running: Vec<&JobSnapshot> = Vec::new();
    let mut unread_completed: Vec<&JobSnapshot> = Vec::new();

    for job in jobs {
        if matches!(job.status, JobStatus::Running) {
            running.push(job);
        } else if job.has_unread_output {
            unread_completed.push(job);
        }
    }

    let mut lines = Vec::with_capacity(jobs.len() + 6);
    lines.push("# Background Jobs".to_string());
    lines.push(String::new());

    if !running.is_empty() {
        lines.push(format!("**Running ({}):**", running.len()));
        for job in &running {
            let age_display = format_age(job.age_ms);
            lines.push(format!(
                "- `{}` ({}) — `{}` ({})",
                job.handle, job.kind_label, job.label, age_display,
            ));
        }
    }

    if !unread_completed.is_empty() {
        if !running.is_empty() {
            lines.push(String::new());
        }
        lines.push(format!(
            "**Completed — unread output ({}):**",
            unread_completed.len()
        ));
        for job in &unread_completed {
            let status_label = match &job.status {
                JobStatus::Exited(code) => {
                    if *code == 0 {
                        "exit 0".to_string()
                    } else {
                        format!("exit {code}")
                    }
                }
                JobStatus::Killed => "killed".to_string(),
                JobStatus::Completed => "completed".to_string(),
                JobStatus::Failed => "failed".to_string(),
                JobStatus::Running => unreachable!(),
            };
            lines.push(format!(
                "- `{}` ({}) — `{}` [{}]",
                job.handle, job.kind_label, job.label, status_label,
            ));
        }
    }

    lines.push(String::new());

    if !unread_completed.is_empty() && running.is_empty() {
        lines.push(
            "Use `await_output(command=\"monitor\", handles=[...])` to read their output."
                .to_string(),
        );
    } else if !running.is_empty() {
        lines.push(
            "Do NOT call `await_output` repeatedly to poll — the system will notify you \
             automatically when jobs finish. Continue with other work; you will see their \
             results in the next turn's reminder once they complete."
                .to_string(),
        );
    }

    lines.join("\n")
}

fn format_age(age_ms: u64) -> String {
    let secs = age_ms / 1000;
    if secs < 60 {
        format!("{secs}s")
    } else if secs < 3600 {
        format!("{}m {}s", secs / 60, secs % 60)
    } else {
        format!("{}h {}m", secs / 3600, (secs % 3600) / 60)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_running(handle: &str, label: &str) -> JobSnapshot {
        JobSnapshot {
            handle: handle.to_string(),
            label: label.to_string(),
            kind_label: "shell".to_string(),
            status: JobStatus::Running,
            age_ms: 45_000,
            has_unread_output: false,
        }
    }

    fn make_completed(handle: &str, label: &str, code: i32) -> JobSnapshot {
        JobSnapshot {
            handle: handle.to_string(),
            label: label.to_string(),
            kind_label: "shell".to_string(),
            status: JobStatus::Exited(code),
            age_ms: 120_000,
            has_unread_output: true,
        }
    }

    fn make_acknowledged(handle: &str, label: &str) -> JobSnapshot {
        JobSnapshot {
            handle: handle.to_string(),
            label: label.to_string(),
            kind_label: "shell".to_string(),
            status: JobStatus::Exited(0),
            age_ms: 300_000,
            has_unread_output: false,
        }
    }

    #[test]
    fn running_jobs_appear() {
        let jobs = vec![make_running("12345", "npm run dev")];
        let result = build_background_jobs_reminder(&jobs);
        assert!(result.contains("Running (1)"));
        assert!(result.contains("`12345`"));
        assert!(result.contains("npm run dev"));
        assert!(result.contains("45s"));
    }

    #[test]
    fn completed_unread_appears() {
        let jobs = vec![make_completed("99999", "cargo test", 1)];
        let result = build_background_jobs_reminder(&jobs);
        assert!(result.contains("Completed — unread output (1)"));
        assert!(result.contains("exit 1"));
    }

    #[test]
    fn acknowledged_jobs_excluded() {
        let jobs = vec![make_acknowledged("11111", "sleep 10")];
        let result = build_background_jobs_reminder(&jobs);
        assert!(
            !result.contains("11111"),
            "Acknowledged job should not appear: {result}"
        );
        assert!(!result.contains("Running"));
        assert!(!result.contains("Completed"));
    }

    #[test]
    fn mixed_jobs() {
        let jobs = vec![
            make_running("100", "npm run dev"),
            make_completed("200", "cargo build", 0),
            make_acknowledged("300", "sleep 5"),
        ];
        let result = build_background_jobs_reminder(&jobs);
        assert!(result.contains("Running (1)"));
        assert!(result.contains("`100`"));
        assert!(result.contains("Completed — unread output (1)"));
        assert!(result.contains("`200`"));
        assert!(!result.contains("`300`"));
    }

    #[test]
    fn age_formatting() {
        assert_eq!(format_age(5_000), "5s");
        assert_eq!(format_age(90_000), "1m 30s");
        assert_eq!(format_age(3_661_000), "1h 1m");
    }
}

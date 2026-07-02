//! Builds per-turn system-prompt reminders for active background jobs.
//!
//! Injected into `dynamic_sections` in `UnifiedMessageProcessor::process()` so
//! the model is aware of running / unacknowledged-completed shell processes and
//! subagents without having to call `await_output list` every turn.
//!
//! Design goals:
//! - **Accurate status** — uses real-time registry state, not cached text.
//! - **Result delivery** — a completed subagent's final result is inlined
//!   directly (capped) so the parent can act on it immediately instead of
//!   spending a tool call on `await_output`. Inlined jobs are acknowledged
//!   by the caller via [`inlined_result_handles`].
//! - **Auto-cleanup** — completed jobs whose output was read via AwaitTool
//!   are excluded (acknowledged).
//! - **Compact** — one block, bounded per-result budget.

use crate::tools::impls::coding::exec::registry::{JobSnapshot, JobStatus};

/// Cap on an inlined subagent result inside the reminder. Full text remains
/// available via `await_output(monitor)` before acknowledgement and in the
/// subagent transcript afterwards.
const INLINE_RESULT_MAX_CHARS: usize = 8_000;

/// Handles whose final result the reminder inlines — the caller must
/// acknowledge exactly these so results are delivered once.
pub fn inlined_result_handles(jobs: &[JobSnapshot]) -> Vec<String> {
    jobs.iter()
        .filter(|job| job.has_unread_output && job.final_result.is_some())
        .map(|job| job.handle.clone())
        .collect()
}

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
            // Subagent results are inlined so the parent can act immediately
            // (mirrors the task-notification pattern: result travels WITH the
            // completion notice, not behind another tool call).
            if let Some(ref result) = job.final_result {
                let capped = if result.len() > INLINE_RESULT_MAX_CHARS {
                    format!(
                        "{}\n[result truncated at {}K chars — full text in the subagent transcript]",
                        crate::utils::safe_truncate_utf8(result, INLINE_RESULT_MAX_CHARS),
                        INLINE_RESULT_MAX_CHARS / 1000
                    )
                } else {
                    result.clone()
                };
                lines.push(format!("  <result>\n{}\n  </result>", capped));
            }
        }
    }

    lines.push(String::new());

    let any_inlined = unread_completed.iter().any(|j| j.final_result.is_some());
    let any_pending_read = unread_completed.iter().any(|j| j.final_result.is_none());
    if any_inlined {
        lines.push(
            "The <result> blocks above are the completed subagents' final reports — act on them \
             directly; no await_output call is needed for those."
                .to_string(),
        );
    }
    if any_pending_read && running.is_empty() {
        lines.push(
            "Use `await_output(command=\"monitor\", handles=[...])` to read the remaining jobs' output."
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
            final_result: None,
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
            final_result: None,
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
            final_result: None,
        }
    }

    fn make_completed_subagent(handle: &str, result: &str) -> JobSnapshot {
        JobSnapshot {
            handle: handle.to_string(),
            label: "Explore".to_string(),
            kind_label: "subagent:explore".to_string(),
            status: JobStatus::Completed,
            age_ms: 60_000,
            has_unread_output: true,
            final_result: Some(result.to_string()),
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

    #[test]
    fn subagent_result_is_inlined() {
        let jobs = vec![make_completed_subagent("agent-x", "Found 3 call sites in foo.rs")];
        let result = build_background_jobs_reminder(&jobs);
        assert!(result.contains("<result>"), "got: {result}");
        assert!(result.contains("Found 3 call sites in foo.rs"));
        assert!(result.contains("act on them"));
        // No await_output nudge for inlined results.
        assert!(!result.contains("to read the remaining jobs"));
    }

    #[test]
    fn long_result_is_capped() {
        let long = "x".repeat(10_000);
        let jobs = vec![make_completed_subagent("agent-y", &long)];
        let result = build_background_jobs_reminder(&jobs);
        assert!(result.contains("[result truncated"));
    }

    #[test]
    fn inlined_handles_only_cover_result_bearing_jobs() {
        let jobs = vec![
            make_completed_subagent("agent-z", "done"),
            make_completed("shell-1", "cargo test", 0),
            make_running("shell-2", "npm run dev"),
        ];
        assert_eq!(inlined_result_handles(&jobs), vec!["agent-z".to_string()]);
    }
}

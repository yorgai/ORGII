//! Work item schedule executor.
//!
//! Background task that polls every project + work item in the global
//! store and auto-starts items when:
//! - `start_date` is in the past and status is `backlog` / `planned` / `todo`
//! - `schedule.at` is in the past (one-shot)
//! - `schedule.cron` matches (recurring via croner)
//!
//! On failure, writes a notification to the user's inbox.

use tracing::{error, info, warn};

use project_management::projects::io;
use project_management::projects::types::{
    OrchestratorPhase, WorkItemFrontmatter, WorkItemSchedule,
};

const POLL_INTERVAL_SECS: u64 = 30;

/// Spawn the scheduler background task.
///
/// Polls every 30 seconds.
pub fn spawn(app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        info!(
            "[scheduler] Work item scheduler started (poll={}s)",
            POLL_INTERVAL_SECS
        );
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(POLL_INTERVAL_SECS)).await;
            if let Err(err) = check_and_trigger(&app_handle).await {
                warn!("[scheduler] Poll error: {}", err);
            }
        }
    });
}

pub async fn debug_run_once(app: &tauri::AppHandle) -> Result<(), String> {
    check_and_trigger(app).await
}

async fn check_and_trigger(app: &tauri::AppHandle) -> Result<(), String> {
    let projects = match io::read_all_projects() {
        Ok(projects) => projects,
        Err(_) => return Ok(()),
    };

    let now = chrono::Utc::now();

    for project in &projects {
        let slug = &project.slug;
        let items = match io::read_all_work_items(slug) {
            Ok(items) => items,
            Err(_) => continue,
        };

        for item in &items {
            let fm = &item.frontmatter;
            let short_id = &fm.short_id;

            if should_trigger_by_start_date(fm) {
                let config = fm.orchestrator_config.clone().unwrap_or_default();
                if config.selected_account_id.is_none() {
                    notify_inbox_blocked(
                        short_id,
                        &fm.title,
                        "No code account configured (selected_account_id is empty)",
                    );
                    continue;
                }

                info!(
                    "[scheduler] Triggering work item {} (start_date reached) in project {}",
                    short_id, slug
                );

                match crate::tool_infra::start_work_item(slug, short_id, app, None, None).await {
                    Ok(msg) => {
                        info!("[scheduler] Started: {}", msg);
                        update_status_in_progress(slug, short_id);
                    }
                    Err(err) => {
                        warn!("[scheduler] Failed to start {}: {}", short_id, err);
                        notify_inbox_blocked(short_id, &fm.title, &err);
                    }
                }
                continue;
            }

            let schedule = match &fm.schedule {
                Some(sched) if sched.enabled => sched,
                _ => continue,
            };

            if should_trigger_at(schedule, &now) {
                handle_schedule_trigger(slug, short_id, fm, app).await;
                disable_one_shot_schedule(slug, short_id);
                continue;
            }

            if should_trigger_cron(schedule, &now) {
                reset_orchestrator_phase(slug, short_id);
                handle_schedule_trigger(slug, short_id, fm, app).await;
                update_cron_last_run(slug, short_id, &now);
            }
        }
    }
    Ok(())
}

async fn handle_schedule_trigger(
    slug: &str,
    short_id: &str,
    fm: &WorkItemFrontmatter,
    app: &tauri::AppHandle,
) {
    let config = fm.orchestrator_config.clone().unwrap_or_default();
    if config.selected_account_id.is_none() {
        notify_inbox_blocked(
            short_id,
            &fm.title,
            "No code account configured (selected_account_id is empty)",
        );
        return;
    }

    info!(
        "[scheduler] Triggering scheduled work item {} in project {}",
        short_id, slug
    );

    match crate::tool_infra::start_work_item(slug, short_id, app, None, None).await {
        Ok(msg) => {
            info!("[scheduler] Started: {}", msg);
            update_status_in_progress(slug, short_id);
        }
        Err(err) => {
            warn!("[scheduler] Failed to start {}: {}", short_id, err);
            notify_inbox_blocked(short_id, &fm.title, &err);
        }
    }
}

/// Check if work item should auto-start based on its `start_date`.
fn should_trigger_by_start_date(fm: &WorkItemFrontmatter) -> bool {
    let start_str = match &fm.start_date {
        Some(s) if !s.is_empty() => s,
        _ => return false,
    };

    let status = fm.status.as_str();
    if status != "backlog" && status != "planned" && status != "todo" {
        return false;
    }

    let now = chrono::Utc::now();
    if let Ok(start_time) = chrono::DateTime::parse_from_rfc3339(start_str) {
        return now >= start_time;
    }
    if let Ok(start_time) = chrono::NaiveDateTime::parse_from_str(start_str, "%Y-%m-%dT%H:%M:%S") {
        return now >= start_time.and_utc();
    }
    if let Ok(start_date) = chrono::NaiveDate::parse_from_str(start_str, "%Y-%m-%d") {
        if let Some(start_dt) = start_date.and_hms_opt(0, 0, 0) {
            return now >= start_dt.and_utc();
        }
    }
    false
}

fn should_trigger_at(schedule: &WorkItemSchedule, now: &chrono::DateTime<chrono::Utc>) -> bool {
    if let Some(ref at_str) = schedule.at {
        if let Ok(at_time) = chrono::DateTime::parse_from_rfc3339(at_str) {
            return *now >= at_time;
        }
        if let Ok(at_time) = chrono::NaiveDateTime::parse_from_str(at_str, "%Y-%m-%dT%H:%M:%S") {
            return *now >= at_time.and_utc();
        }
    }
    false
}

/// Check if a cron schedule should fire: parse the expression, find the most
/// recent tick, and compare against `last_run`.
fn should_trigger_cron(schedule: &WorkItemSchedule, now: &chrono::DateTime<chrono::Utc>) -> bool {
    let cron_expr = match &schedule.cron {
        Some(expr) if !expr.is_empty() => expr,
        _ => return false,
    };

    let cron = match croner::Cron::new(cron_expr).parse() {
        Ok(cron) => cron,
        Err(err) => {
            error!(
                "[scheduler] Invalid cron expression '{}': {}",
                cron_expr, err
            );
            return false;
        }
    };

    let window_start = *now - chrono::Duration::seconds(POLL_INTERVAL_SECS as i64 + 5);
    match cron.find_next_occurrence(&window_start, false) {
        Ok(next_tick) if next_tick <= *now => {
            let already_fired = schedule.last_run.as_ref().is_some_and(|lr| {
                chrono::DateTime::parse_from_rfc3339(lr)
                    .map(|t| t >= next_tick)
                    .unwrap_or(false)
            });
            !already_fired
        }
        _ => false,
    }
}

fn update_status_in_progress(slug: &str, short_id: &str) {
    let _ = io::update_work_item_atomic(slug, short_id, |fm, _body| {
        fm.status = "in_progress".to_string();
        fm.updated_at = chrono::Utc::now().to_rfc3339();
        Ok(fm.title.clone())
    });
}

/// Reset orchestrator phase to Idle so a recurring work item can be re-triggered.
fn reset_orchestrator_phase(slug: &str, short_id: &str) {
    let _ = io::update_work_item_atomic(slug, short_id, |fm, _body| {
        if let Some(ref mut state) = fm.orchestrator_state {
            state.current_phase = OrchestratorPhase::Idle;
            state.interrupted_phase = None;
        }
        fm.status = "todo".to_string();
        fm.updated_at = chrono::Utc::now().to_rfc3339();
        Ok(fm.title.clone())
    });
}

fn disable_one_shot_schedule(slug: &str, short_id: &str) {
    let _ = io::update_work_item_atomic(slug, short_id, |fm, _body| {
        if let Some(ref mut sched) = fm.schedule {
            if sched.at.is_some() {
                sched.enabled = false;
            }
        }
        Ok(fm.title.clone())
    });
}

fn update_cron_last_run(slug: &str, short_id: &str, now: &chrono::DateTime<chrono::Utc>) {
    let now_iso = now.to_rfc3339();
    let _ = io::update_work_item_atomic(slug, short_id, |fm, _body| {
        if let Some(ref mut sched) = fm.schedule {
            sched.last_run = Some(now_iso.clone());
        }
        Ok(fm.title.clone())
    });
}

/// Write a "blocked" notification to the user's inbox.
fn notify_inbox_blocked(short_id: &str, title: &str, reason: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    let msg = inbox::persistence::InboxMessage {
        id: format!(
            "schedule-blocked-{}-{}",
            short_id,
            chrono::Utc::now().timestamp()
        ),
        title: format!("[Scheduled Task Blocked] {} \"{}\"", short_id, title),
        preview: format!("Reason: {}", truncate(reason, 100)),
        content: format!(
            "Work item {} \"{}\"\
             could not auto-start.\n\n\
             **Reason:** {}\n\n\
             **Action needed:**\n\
             - Assign a code account (selected_account_id)\n\
             - Or change the assigned agent\n\
             - Or adjust the model",
            short_id, title, reason
        ),
        category: "workitems".to_string(),
        priority: "high".to_string(),
        status: "unread".to_string(),
        sender_name: Some("Scheduler".to_string()),
        metadata: "{}".to_string(),
        labels: serde_json::to_string(&["schedule-blocked"])
            .expect("serializing a static [&str] is infallible"),
        created_at: now.clone(),
        updated_at: now,
    };
    if let Err(err) = inbox::persistence::upsert_message(&msg) {
        warn!(
            "[scheduler] Failed to write inbox notification for {}: {}",
            short_id, err
        );
    } else {
        info!("[scheduler] Sent inbox notification: {} blocked", short_id);
    }
}

fn truncate(s: &str, max_len: usize) -> &str {
    if s.len() <= max_len {
        return s;
    }
    let mut end = max_len;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    // ============================================
    // truncate
    // ============================================

    #[test]
    fn truncate_short_string_unchanged() {
        assert_eq!(truncate("hello", 10), "hello");
    }

    #[test]
    fn truncate_exact_length_unchanged() {
        assert_eq!(truncate("hello", 5), "hello");
    }

    #[test]
    fn truncate_cuts_at_boundary() {
        assert_eq!(truncate("hello world", 5), "hello");
    }

    #[test]
    fn truncate_multibyte_does_not_panic() {
        let result = truncate("你好世界", 4);
        assert_eq!(result, "你");
    }

    #[test]
    fn truncate_empty_string() {
        assert_eq!(truncate("", 5), "");
    }

    #[test]
    fn truncate_zero_max() {
        assert_eq!(truncate("hello", 0), "");
    }

    // ============================================
    // should_trigger_by_start_date
    // ============================================

    fn make_frontmatter(status: &str, start_date: Option<&str>) -> WorkItemFrontmatter {
        WorkItemFrontmatter {
            id: "id-1".into(),
            short_id: "TST-0001".into(),
            title: "Test".into(),
            project: None,
            status: status.into(),
            priority: "none".into(),
            assignee: None,
            assignee_type: None,
            labels: vec![],
            milestone: None,
            parent: None,
            start_date: start_date.map(|s| s.to_string()),
            target_date: None,
            created_by: None,
            created_at: "2025-01-01T00:00:00Z".into(),
            updated_at: "2025-01-01T00:00:00Z".into(),
            deleted_at: None,
            starred: false,
            todos: vec![],
            comments: vec![],
            history: vec![],
            delegations: vec![],
            linked_sessions: vec![],
            proof_of_work: None,
            orchestrator_config: None,
            orchestrator_state: None,
            follow_up_items: vec![],
            schedule: None,
            routine_source: None,
            execution_lock: None,
            close_out: None,
            work_products: vec![],
        }
    }

    #[test]
    fn trigger_by_start_date_no_date_returns_false() {
        let fm = make_frontmatter("backlog", None);
        assert!(!should_trigger_by_start_date(&fm));
    }

    #[test]
    fn trigger_by_start_date_empty_string_returns_false() {
        let fm = make_frontmatter("backlog", Some(""));
        assert!(!should_trigger_by_start_date(&fm));
    }

    #[test]
    fn trigger_by_start_date_wrong_status_returns_false() {
        let fm = make_frontmatter("in_progress", Some("2020-01-01T00:00:00Z"));
        assert!(!should_trigger_by_start_date(&fm));
    }

    #[test]
    fn trigger_by_start_date_future_rfc3339_returns_false() {
        let fm = make_frontmatter("backlog", Some("2099-12-31T23:59:59Z"));
        assert!(!should_trigger_by_start_date(&fm));
    }

    #[test]
    fn trigger_by_start_date_past_rfc3339_returns_true() {
        let fm = make_frontmatter("backlog", Some("2020-01-01T00:00:00Z"));
        assert!(should_trigger_by_start_date(&fm));
    }

    #[test]
    fn trigger_by_start_date_past_naive_datetime_returns_true() {
        let fm = make_frontmatter("planned", Some("2020-06-15T12:00:00"));
        assert!(should_trigger_by_start_date(&fm));
    }

    #[test]
    fn trigger_by_start_date_past_date_only_returns_true() {
        let fm = make_frontmatter("todo", Some("2020-06-15"));
        assert!(should_trigger_by_start_date(&fm));
    }

    #[test]
    fn trigger_by_start_date_future_date_only_returns_false() {
        let fm = make_frontmatter("backlog", Some("2099-06-15"));
        assert!(!should_trigger_by_start_date(&fm));
    }

    #[test]
    fn trigger_by_start_date_invalid_format_returns_false() {
        let fm = make_frontmatter("backlog", Some("not-a-date"));
        assert!(!should_trigger_by_start_date(&fm));
    }

    // ============================================
    // should_trigger_at
    // ============================================

    #[test]
    fn trigger_at_none_returns_false() {
        let schedule = WorkItemSchedule {
            at: None,
            cron: None,
            enabled: true,
            last_run: None,
        };
        let now = Utc::now();
        assert!(!should_trigger_at(&schedule, &now));
    }

    #[test]
    fn trigger_at_past_rfc3339_returns_true() {
        let schedule = WorkItemSchedule {
            at: Some("2020-01-01T00:00:00Z".into()),
            cron: None,
            enabled: true,
            last_run: None,
        };
        let now = Utc::now();
        assert!(should_trigger_at(&schedule, &now));
    }

    #[test]
    fn trigger_at_future_rfc3339_returns_false() {
        let schedule = WorkItemSchedule {
            at: Some("2099-12-31T23:59:59Z".into()),
            cron: None,
            enabled: true,
            last_run: None,
        };
        let now = Utc::now();
        assert!(!should_trigger_at(&schedule, &now));
    }

    #[test]
    fn trigger_at_past_naive_datetime_returns_true() {
        let schedule = WorkItemSchedule {
            at: Some("2020-06-15T12:00:00".into()),
            cron: None,
            enabled: true,
            last_run: None,
        };
        let now = Utc::now();
        assert!(should_trigger_at(&schedule, &now));
    }

    #[test]
    fn trigger_at_invalid_format_returns_false() {
        let schedule = WorkItemSchedule {
            at: Some("not-a-date".into()),
            cron: None,
            enabled: true,
            last_run: None,
        };
        let now = Utc::now();
        assert!(!should_trigger_at(&schedule, &now));
    }

    #[test]
    fn trigger_at_exact_moment() {
        let moment = Utc.with_ymd_and_hms(2025, 6, 15, 12, 0, 0).unwrap();
        let schedule = WorkItemSchedule {
            at: Some(moment.to_rfc3339()),
            cron: None,
            enabled: true,
            last_run: None,
        };
        assert!(should_trigger_at(&schedule, &moment));
    }
}

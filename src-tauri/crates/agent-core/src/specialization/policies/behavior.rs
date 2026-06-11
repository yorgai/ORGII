//! Behavior companion `.md` generation.
//!
//! When an ATC behavior is created/updated/removed, a companion markdown file
//! is generated in the global policies directory so other agents can see it.

use crate::automation::types::{AutomationAction, AutomationRule, AutomationTrigger, GitEvent};

use crate::tool_infra::slugify;

use super::config::{PoliciesConfig, PolicyConfig};
use super::{global_policies_dir, BEHAVIOR_PREFIX};

fn truncate_preview(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...", &s[..end])
}

fn trigger_summary(trigger: &AutomationTrigger) -> String {
    match trigger {
        AutomationTrigger::Timer { interval_secs } => {
            format!("Timer: every {} seconds", interval_secs)
        }
        AutomationTrigger::ScheduledTime {
            frequency,
            time,
            timezone,
            days_of_week,
            monthly_mode,
            day_of_month,
            week_of_month,
            weekday_of_month,
        } => format!(
            "Scheduled time: {:?} at {} {} (days: {:?}, monthly_mode: {:?}, day_of_month: {:?}, week: {:?}, weekday: {:?})",
            frequency,
            time,
            timezone,
            days_of_week,
            monthly_mode,
            day_of_month,
            week_of_month,
            weekday_of_month
        ),
        AutomationTrigger::Cron { expression } => format!("Cron: {}", expression),
        AutomationTrigger::GitActivity {
            events,
            repo_filter,
        } => {
            let event_names: Vec<&str> = events
                .iter()
                .map(|e| match e {
                    GitEvent::Commit => "commit",
                    GitEvent::Push => "push",
                    GitEvent::Pull => "pull",
                    GitEvent::BranchChange => "branch change",
                    GitEvent::FileChange => "file change",
                })
                .collect();
            let base = format!("Git: {}", event_names.join(", "));
            match repo_filter {
                Some(filter) => format!("{} (repo: {})", base, filter),
                None => base,
            }
        }
        AutomationTrigger::ChannelMessage { channel, pattern } => {
            let base = format!("Channel message on '{}'", channel);
            match pattern {
                Some(pat) => format!("{} matching '{}'", base, pat),
                None => base,
            }
        }
        AutomationTrigger::FileWatch { paths, debounce_ms } => {
            format!(
                "File watch: {} (debounce {}ms)",
                paths.join(", "),
                debounce_ms
            )
        }
        AutomationTrigger::Webhook { route } => format!("Webhook: {}", route),
    }
}

fn action_summary(action: &AutomationAction) -> String {
    match action {
        AutomationAction::InjectPrompt { prompt, session_id } => {
            let target = session_id.as_deref().unwrap_or("active session");
            let preview = truncate_preview(prompt, 120);
            format!("Inject prompt into {}: \"{}\"", target, preview)
        }
        AutomationAction::StartSession {
            agent_type,
            prompt,
            model,
            ..
        } => {
            let model_str = model.as_deref().unwrap_or("default");
            let preview = truncate_preview(prompt, 80);
            format!(
                "Start {} session (model: {}): \"{}\"",
                agent_type, model_str, preview
            )
        }
        AutomationAction::KillSession { session_id } => format!("Kill session: {}", session_id),
        AutomationAction::SendMessage { channel, content } => {
            let preview = truncate_preview(content, 80);
            format!("Send to '{}': \"{}\"", channel, preview)
        }
        AutomationAction::InjectToSession {
            session_id,
            message,
        } => {
            let preview = truncate_preview(message, 80);
            format!("Inject into session {}: \"{}\"", session_id, preview)
        }
        AutomationAction::Workflow { actions } => {
            format!("Run workflow with {} action(s)", actions.len())
        }
    }
}

/// Generate a companion .md for an ATC behavior in global policies dir.
/// Returns the policy name (filename stem) used for the .md file.
pub fn generate_automation_md(rule: &AutomationRule) -> Result<String, String> {
    let slug = slugify(&rule.name);
    let policy_name = format!("{}{}", BEHAVIOR_PREFIX, slug);
    let dir = global_policies_dir();

    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create policies dir: {}", e))?;
    }

    let trigger_desc = trigger_summary(&rule.trigger);
    let action_desc = action_summary(&rule.action);

    let content = format!(
        "---\n\
         generated_by: automation\n\
         automation_id: {id}\n\
         trigger: {trigger_type}\n\
         enabled: {enabled}\n\
         ---\n\
         \n\
         # {name}\n\
         \n\
         ## Trigger\n\
         \n\
         {trigger_desc}\n\
         \n\
         ## Action\n\
         \n\
         {action_desc}\n",
        id = rule.id,
        trigger_type = trigger_desc,
        enabled = rule.enabled,
        name = rule.name,
        trigger_desc = trigger_desc,
        action_desc = action_desc,
    );

    let file_path = dir.join(format!("{}.md", policy_name));
    std::fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write behavior .md: {}", e))?;

    let mut config = PoliciesConfig::load_global()?;
    let entry = config
        .policies
        .entry(policy_name.clone())
        .or_insert_with(PolicyConfig::default);
    entry.disabled = !rule.enabled;
    config.save_global()?;

    Ok(policy_name)
}

/// Remove a behavior .md by its ATC rule ID (scans for matching frontmatter).
pub fn remove_automation_md_by_id(rule_id: &str) -> Result<(), String> {
    let dir = global_policies_dir();
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => {
            return Err(format!(
                "Failed to read policies directory {}: {}",
                dir.display(),
                err
            ));
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if !name.starts_with(BEHAVIOR_PREFIX) {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(&path) {
            let current_id_pattern = format!("automation_id: {}", rule_id);
            let old_id_pattern = format!("behavior_id: {}", rule_id);
            if content.contains(&current_id_pattern) || content.contains(&old_id_pattern) {
                std::fs::remove_file(&path)
                    .map_err(|e| format!("Failed to remove {}: {}", path.display(), e))?;
                let mut config = PoliciesConfig::load_global()?;
                config.policies.remove(&name);
                config.save_global()?;
                return Ok(());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests/behavior_tests.rs"]
mod tests;

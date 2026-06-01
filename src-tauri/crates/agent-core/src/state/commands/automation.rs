//! Automation Tauri commands.

use crate::automation;
use crate::state::AgentAppState;

#[tauri::command]
pub async fn agent_automation_list_rules(
    state: tauri::State<'_, AgentAppState>,
) -> Result<Vec<automation::AutomationRule>, String> {
    let engine_lock = state.gateway.automation_engine.lock().await;
    match *engine_lock {
        Some(ref engine) => Ok(engine.list_rules().await),
        None => {
            automation::persistence::load_rules(&automation::persistence::default_storage_path())
        }
    }
}

#[tauri::command]
pub async fn agent_automation_add_rule(
    state: tauri::State<'_, AgentAppState>,
    rule_json: String,
) -> Result<String, String> {
    let rule: automation::AutomationRule =
        serde_json::from_str(&rule_json).map_err(|err| format!("Invalid rule JSON: {}", err))?;

    crate::policies::generate_automation_md(&rule)?;

    let mut engine_lock = state.gateway.automation_engine.lock().await;
    match *engine_lock {
        Some(ref mut engine) => Ok(engine.add_rule(rule).await),
        None => {
            let storage_path = automation::persistence::default_storage_path();
            let mut rules = automation::persistence::load_rules(&storage_path)?;
            let rule_id = rule.id.clone();
            if let Some(existing) = rules
                .iter_mut()
                .find(|existing_rule| existing_rule.id == rule_id)
            {
                *existing = rule;
            } else {
                rules.push(rule);
            }
            automation::persistence::save_rules(&storage_path, &rules)?;
            Ok(rule_id)
        }
    }
}

#[tauri::command]
pub async fn agent_automation_update_rule(
    state: tauri::State<'_, AgentAppState>,
    rule_json: String,
) -> Result<(), String> {
    let rule: automation::AutomationRule =
        serde_json::from_str(&rule_json).map_err(|err| format!("Invalid rule JSON: {}", err))?;

    crate::policies::generate_automation_md(&rule)?;

    let mut engine_lock = state.gateway.automation_engine.lock().await;
    match *engine_lock {
        Some(ref mut engine) => engine.update_rule(rule).await,
        None => {
            let storage_path = automation::persistence::default_storage_path();
            let mut rules = automation::persistence::load_rules(&storage_path)?;
            let rule_id = rule.id.clone();
            if let Some(existing) = rules.iter_mut().find(|r| r.id == rule_id) {
                *existing = rule;
            } else {
                return Err(format!("Rule not found: {}", rule_id));
            }
            automation::persistence::save_rules(&storage_path, &rules)
        }
    }
}

#[tauri::command]
pub async fn agent_automation_remove_rule(
    state: tauri::State<'_, AgentAppState>,
    rule_id: String,
) -> Result<bool, String> {
    crate::policies::remove_automation_md_by_id(&rule_id)?;

    let mut engine_lock = state.gateway.automation_engine.lock().await;
    match *engine_lock {
        Some(ref mut engine) => Ok(engine.remove_rule(&rule_id).await),
        None => {
            let storage_path = automation::persistence::default_storage_path();
            let mut rules = automation::persistence::load_rules(&storage_path)?;
            let original_len = rules.len();
            rules.retain(|r| r.id != rule_id);
            let removed = rules.len() < original_len;
            if removed {
                automation::persistence::save_rules(&storage_path, &rules)?;
            }
            Ok(removed)
        }
    }
}

#[tauri::command]
pub async fn agent_automation_get_status(
    state: tauri::State<'_, AgentAppState>,
) -> Result<automation::AutomationStatus, String> {
    let engine_lock = state.gateway.automation_engine.lock().await;
    match *engine_lock {
        Some(ref engine) => Ok(engine.status().await),
        None => Ok(automation::AutomationStatus {
            running: false,
            active_rules: 0,
            total_rules: 0,
            total_fires: 0,
            uptime_secs: 0,
            agent_alive: false,
            messages_processed: 0,
            last_health_check: String::new(),
        }),
    }
}

#[tauri::command]
pub async fn agent_automation_fire_webhook(route: String) -> Result<bool, String> {
    Ok(automation::triggers::webhook_registry::fire(&route))
}

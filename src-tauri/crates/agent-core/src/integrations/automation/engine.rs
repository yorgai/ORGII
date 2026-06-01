//! Automation Engine — core orchestrator.
//!
//! Loads rules, spawns trigger listeners, evaluates cooldown/max-fires guards,
//! and dispatches actions through the message bus.

use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, Mutex};
use tracing::{debug, error, info, warn};

use super::actions;
use super::persistence;
use super::triggers::{self, GitBroadcastEvent, TriggerContext, TriggerEvent, TriggerHandle};
use super::types::{AutomationRule, AutomationStatus};

use crate::bus::InboundMessage;

/// The automation engine: manages rules, trigger listeners, action dispatch, and health monitoring.
pub struct AutomationEngine {
    /// All rules indexed by ID.
    rules: Arc<Mutex<HashMap<String, AutomationRule>>>,
    /// Active trigger handles (one per enabled rule with a supported trigger).
    trigger_handles: Vec<TriggerHandle>,
    /// Sender for injecting messages into the agent bus.
    inbound_tx: mpsc::Sender<InboundMessage>,
    /// Channel for trigger events from listeners → engine evaluator.
    event_tx: mpsc::Sender<TriggerEvent>,
    /// Handle to the evaluator background task.
    evaluator_handle: Option<tokio::task::JoinHandle<()>>,
    /// Handle to the health monitor background task.
    health_handle: Option<tokio::task::JoinHandle<()>>,
    /// Storage path for persistence.
    storage_path: std::path::PathBuf,
    /// When the engine started.
    started_at: Option<DateTime<Utc>>,
    /// Whether the agent loop is alive (shared with AgentLoop).
    agent_alive: Arc<AtomicBool>,
    /// Total messages processed (shared with AgentLoop).
    messages_processed: Arc<AtomicU64>,
    /// Shared trigger context for broadcast channels.
    trigger_ctx: TriggerContext,
}

impl AutomationEngine {
    /// Create a new automation engine.
    pub fn new(inbound_tx: mpsc::Sender<InboundMessage>) -> Self {
        let (event_tx, _event_rx) = mpsc::channel::<TriggerEvent>(64);
        let (git_event_tx, _) = broadcast::channel::<GitBroadcastEvent>(128);
        let (channel_msg_tx, _) = broadcast::channel::<InboundMessage>(128);

        Self {
            rules: Arc::new(Mutex::new(HashMap::new())),
            trigger_handles: Vec::new(),
            inbound_tx,
            event_tx,
            evaluator_handle: None,
            health_handle: None,
            storage_path: persistence::default_storage_path(),
            started_at: None,
            agent_alive: Arc::new(AtomicBool::new(false)),
            messages_processed: Arc::new(AtomicU64::new(0)),
            trigger_ctx: TriggerContext {
                git_event_tx,
                channel_msg_tx,
            },
        }
    }

    /// Get the agent_alive flag (shared with AgentLoop to update).
    pub fn agent_alive_flag(&self) -> Arc<AtomicBool> {
        self.agent_alive.clone()
    }

    /// Get the messages_processed counter (shared with AgentLoop to increment).
    pub fn messages_counter(&self) -> Arc<AtomicU64> {
        self.messages_processed.clone()
    }

    /// Get the git event broadcast sender (for the git watch system to send events into ATC).
    pub fn git_event_sender(&self) -> broadcast::Sender<GitBroadcastEvent> {
        self.trigger_ctx.git_event_tx.clone()
    }

    /// Get the channel message broadcast sender (for the message bus to tap into ATC).
    pub fn channel_msg_sender(&self) -> broadcast::Sender<InboundMessage> {
        self.trigger_ctx.channel_msg_tx.clone()
    }
    /// Load rules from disk and start all trigger listeners + evaluator + health monitor.
    ///
    /// Returns `Err` if the rules file exists but is unreadable or corrupt; in that case
    /// the engine intentionally does NOT start so that subsequent persists cannot
    /// overwrite the user's on-disk file with an empty list.
    pub async fn start(&mut self) -> Result<(), String> {
        // Load persisted rules. Surface any IO/parse failure so we never silently
        // discard the user's rules and then save an empty list back over them.
        let sp = self.storage_path.clone();
        let loaded = tokio::task::spawn_blocking(move || persistence::load_rules(&sp))
            .await
            .map_err(|err| format!("automation load task failed: {err}"))??;
        {
            let mut rules = self.rules.lock().await;
            for rule in loaded {
                rules.insert(rule.id.clone(), rule);
            }
            info!("[automation] Engine starting with {} rules", rules.len());
        }

        self.started_at = Some(Utc::now());

        // Register broadcast senders in the global bridge so external systems can fire events
        super::bridge::register(
            self.trigger_ctx.git_event_tx.clone(),
            self.trigger_ctx.channel_msg_tx.clone(),
        );

        // Create a fresh event channel
        let (event_tx, event_rx) = mpsc::channel::<TriggerEvent>(64);
        self.event_tx = event_tx.clone();

        // Spawn trigger listeners for all enabled rules
        self.spawn_all_triggers().await;

        // Spawn the evaluator task
        let rules = self.rules.clone();
        let inbound_tx = self.inbound_tx.clone();
        let storage_path = self.storage_path.clone();

        self.evaluator_handle = Some(tokio::spawn(evaluator_loop(
            rules,
            event_rx,
            inbound_tx,
            storage_path,
        )));

        // Spawn the health monitor task
        let agent_alive = self.agent_alive.clone();
        let messages_processed = self.messages_processed.clone();
        let started_at = self.started_at.unwrap();

        self.health_handle = Some(tokio::spawn(async move {
            info!("[automation] Health monitor started (interval: 30s)");
            let interval = std::time::Duration::from_secs(30);

            loop {
                tokio::time::sleep(interval).await;

                let uptime = (Utc::now() - started_at).num_seconds().max(0) as u64;
                let alive = agent_alive.load(Ordering::Relaxed);
                let count = messages_processed.load(Ordering::Relaxed);

                // Broadcast health status via WebSocket
                crate::bus::broadcast_event(
                    "agent:heartbeat",
                    serde_json::json!({
                        "alive": alive,
                        "uptimeSecs": uptime,
                        "messagesProcessed": count,
                        "lastHealthCheck": Utc::now().to_rfc3339(),
                        "agentRunning": alive,
                    }),
                );

                if !alive {
                    debug!("[automation] Health: agent loop is not running");
                }
            }
        }));

        Ok(())
    }

    /// Stop the engine: abort evaluator + all trigger listeners + health monitor.
    pub async fn stop(&mut self) {
        // Unregister bridge senders
        super::bridge::unregister();

        // Persist current rule state (fire counts, last_fired)
        self.persist_rules().await;

        // Stop all trigger handles
        for handle in &mut self.trigger_handles {
            handle.stop();
        }
        self.trigger_handles.clear();

        // Abort evaluator
        if let Some(handle) = self.evaluator_handle.take() {
            handle.abort();
        }

        // Abort health monitor
        if let Some(handle) = self.health_handle.take() {
            handle.abort();
        }

        self.started_at = None;
        info!("[automation] Engine stopped");
    }

    /// Get current engine status.
    pub async fn status(&self) -> AutomationStatus {
        let rules = self.rules.lock().await;
        let active = rules.values().filter(|rule| rule.enabled).count();
        let total_fires: u64 = rules.values().map(|rule| rule.fire_count).sum();

        let uptime = self
            .started_at
            .map(|started| (Utc::now() - started).num_seconds().max(0) as u64)
            .unwrap_or(0);

        AutomationStatus {
            running: self.evaluator_handle.is_some(),
            active_rules: active,
            total_rules: rules.len(),
            total_fires,
            uptime_secs: uptime,
            agent_alive: self.agent_alive.load(Ordering::Relaxed),
            messages_processed: self.messages_processed.load(Ordering::Relaxed),
            last_health_check: Utc::now().to_rfc3339(),
        }
    }

    /// List all rules.
    pub async fn list_rules(&self) -> Vec<AutomationRule> {
        self.rules.lock().await.values().cloned().collect()
    }

    /// Get a single rule by ID.
    pub async fn get_rule(&self, rule_id: &str) -> Option<AutomationRule> {
        self.rules.lock().await.get(rule_id).cloned()
    }

    /// Add a new rule. If the engine is running, spawns its trigger listener.
    pub async fn add_rule(&mut self, rule: AutomationRule) -> String {
        let rule_id = rule.id.clone();

        // Spawn trigger if engine is running and rule is enabled
        if self.evaluator_handle.is_some() && rule.enabled {
            if let Some(handle) = triggers::spawn_trigger(
                rule.id.clone(),
                &rule.trigger,
                self.event_tx.clone(),
                &self.trigger_ctx,
            ) {
                self.trigger_handles.push(handle);
            }
        }

        self.rules.lock().await.insert(rule_id.clone(), rule);
        self.persist_rules().await;

        info!("[automation] Rule added: {}", rule_id);
        rule_id
    }

    /// Update an existing rule. Restarts its trigger listener if needed.
    pub async fn update_rule(&mut self, rule: AutomationRule) -> Result<(), String> {
        let rule_id = rule.id.clone();

        {
            let mut rules = self.rules.lock().await;
            if !rules.contains_key(&rule_id) {
                return Err(format!("Rule not found: {}", rule_id));
            }
            rules.insert(rule_id.clone(), rule.clone());
        }

        // Stop old trigger for this rule
        self.trigger_handles.retain_mut(|h| {
            if h.rule_id == rule_id {
                h.stop();
                false
            } else {
                true
            }
        });

        // Spawn new trigger if enabled and engine is running
        if self.evaluator_handle.is_some() && rule.enabled {
            if let Some(handle) = triggers::spawn_trigger(
                rule.id.clone(),
                &rule.trigger,
                self.event_tx.clone(),
                &self.trigger_ctx,
            ) {
                self.trigger_handles.push(handle);
            }
        }

        self.persist_rules().await;
        info!("[automation] Rule updated: {}", rule_id);
        Ok(())
    }

    /// Remove a rule by ID.
    pub async fn remove_rule(&mut self, rule_id: &str) -> bool {
        // Stop its trigger
        self.trigger_handles.retain_mut(|h| {
            if h.rule_id == rule_id {
                h.stop();
                false
            } else {
                true
            }
        });

        let removed = self.rules.lock().await.remove(rule_id).is_some();
        if removed {
            self.persist_rules().await;
            info!("[automation] Rule removed: {}", rule_id);
        }
        removed
    }

    // ── Internal helpers ──

    /// Spawn trigger listeners for all enabled rules.
    async fn spawn_all_triggers(&mut self) {
        let rules = self.rules.lock().await;
        for rule in rules.values() {
            if !rule.enabled {
                continue;
            }
            if let Some(handle) = triggers::spawn_trigger(
                rule.id.clone(),
                &rule.trigger,
                self.event_tx.clone(),
                &self.trigger_ctx,
            ) {
                self.trigger_handles.push(handle);
            }
        }
    }

    /// Persist current rules to disk.
    async fn persist_rules(&self) {
        let rules: Vec<AutomationRule> = self.rules.lock().await.values().cloned().collect();
        let sp = self.storage_path.clone();
        let result =
            tokio::task::spawn_blocking(move || persistence::save_rules(&sp, &rules)).await;
        match result {
            Ok(Err(err)) => error!("[automation] Failed to persist rules: {}", err),
            Err(err) => error!(
                "[automation] spawn_blocking failed for persist_rules: {}",
                err
            ),
            _ => {}
        }
    }
}

/// Background evaluator loop: receives trigger events, checks guards, dispatches actions.
async fn evaluator_loop(
    rules: Arc<Mutex<HashMap<String, AutomationRule>>>,
    mut event_rx: mpsc::Receiver<TriggerEvent>,
    inbound_tx: mpsc::Sender<InboundMessage>,
    storage_path: std::path::PathBuf,
) {
    info!("[automation] Evaluator loop started");

    while let Some(event) = event_rx.recv().await {
        let action = {
            let mut rules_lock = rules.lock().await;
            let Some(rule) = rules_lock.get_mut(&event.rule_id) else {
                warn!(
                    "[automation] Trigger event for unknown rule: {}",
                    event.rule_id
                );
                continue;
            };

            if !rule.can_fire() {
                info!(
                    "[automation] Rule '{}' cannot fire (cooldown/max_fires/disabled)",
                    rule.name
                );
                continue;
            }

            // Record the firing
            rule.record_fire();
            info!(
                "[automation] Rule '{}' fired (count: {})",
                rule.name, rule.fire_count
            );

            rule.action.clone()
        };

        // Execute the action (outside the rules lock)
        actions::execute_action(&action, &inbound_tx).await;

        // Persist updated fire counts
        let rules_snapshot: Vec<AutomationRule> = rules.lock().await.values().cloned().collect();
        let sp = storage_path.clone();
        let result =
            tokio::task::spawn_blocking(move || persistence::save_rules(&sp, &rules_snapshot))
                .await;
        match result {
            Ok(Err(err)) => error!("[automation] Failed to persist after firing: {}", err),
            Err(err) => error!("[automation] spawn_blocking failed: {}", err),
            _ => {}
        }
    }

    info!("[automation] Evaluator loop stopped");
}

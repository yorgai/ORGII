//! Agent definitions store — in-memory state + disk persistence.
//!
//! # Storage layout (Storage contract §12)
//!
//! Two JSON files on disk:
//!
//! - `~/.orgii/agent-definitions.json` — user-created agents (no prefix).
//!   Editable via `update(id, patch)`; builtins are rejected.
//! - `~/.orgii/builtin-overrides.json` — map of `builtin:*` → full
//!   `AgentDefinition`. User overlays layered on top of the compiled-in
//!   builtin at read time. Written via `update_with_overlay(id, patch)`
//!   for builtin ids. "Reset to builtin" = remove the key from this file.
//!
//! # Lookup order (`get`)
//!
//! 1. If `id.starts_with("builtin:")`:
//!    - Load compiled-in builtin.
//!    - If `builtin-overrides.json` has a matching entry, **replace** with
//!      the override (full replace; no field-level merge — per §12 Conflict
//!      C, "the user owns the override once they write one").
//! 2. Else: lookup in the user-definitions vec.

use std::collections::BTreeMap;
use std::sync::Mutex;
use tracing::{error, info, warn};

use super::schema::AgentDefinition;
use app_paths::{agent_definitions as storage_path, builtin_overrides as overrides_path};

/// Store for user-created agent definitions and builtin overrides.
pub struct AgentDefinitionsStore {
    pub(crate) agents: Mutex<Vec<AgentDefinition>>,
    pub(crate) builtin_overrides: Mutex<BTreeMap<String, AgentDefinition>>,
}

impl Default for AgentDefinitionsStore {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentDefinitionsStore {
    pub fn new() -> Self {
        let mut agents = load_from_disk(&storage_path());
        let mut builtin_overrides = load_overrides_from_disk(&overrides_path());

        // One-shot migration: pre-existing on-disk overlays / user defs may
        // list `builtin:explore` / `builtin:general` (and other internal
        // primitives) as explicit sub-agents — remnants from before these
        // were declared runtime primitives. Strip them eagerly and re-
        // persist so the file on disk converges to the new shape.
        let mut overlays_changed = false;
        for agent in builtin_overrides.values_mut() {
            if super::builtin::strip_forbidden_sub_agents(agent) {
                overlays_changed = true;
            }
        }
        let mut agents_changed = false;
        for agent in agents.iter_mut() {
            if super::builtin::strip_forbidden_sub_agents(agent) {
                agents_changed = true;
            }
        }
        if overlays_changed {
            if let Err(err) = save_overrides_to_disk(&overrides_path(), &builtin_overrides) {
                error!("[agent-definitions] migration: failed to persist overrides: {err}");
            } else {
                info!(
                    "[agent-definitions] migration: stripped internal sub-agent ids from {} \
                     overlay(s)",
                    builtin_overrides.len()
                );
            }
        }
        if agents_changed {
            if let Err(err) = save_to_disk(&storage_path(), &agents) {
                error!("[agent-definitions] migration: failed to persist agents: {err}");
            } else {
                info!(
                    "[agent-definitions] migration: stripped internal sub-agent ids from \
                     user definitions"
                );
            }
        }

        Self {
            agents: Mutex::new(agents),
            builtin_overrides: Mutex::new(builtin_overrides),
        }
    }

    pub(crate) fn persist(&self, agents: &[AgentDefinition]) {
        let path = storage_path();
        if let Err(err) = save_to_disk(&path, agents) {
            error!("[agent-definitions] Failed to persist: {}", err);
        }
    }

    pub(crate) fn persist_overrides(&self, overrides: &BTreeMap<String, AgentDefinition>) {
        let path = overrides_path();
        if let Err(err) = save_overrides_to_disk(&path, overrides) {
            error!("[agent-definitions] Failed to persist overrides: {}", err);
        }
    }

    /// Look up an agent by id. For `builtin:*`, the compiled-in definition
    /// is first consulted, then replaced by any entry in
    /// `builtin-overrides.json`. For non-builtin ids, returns the user
    /// agent from the on-disk store.
    pub fn get(&self, id: &str) -> Option<AgentDefinition> {
        if super::builtin::is_builtin_agent(id) {
            let overlay = self
                .builtin_overrides
                .lock()
                .expect("builtin-overrides mutex poisoned")
                .get(id)
                .cloned();
            if let Some(override_def) = overlay {
                return Some(override_def);
            }
            return super::builtin::get_builtin_agent(id);
        }
        let guard = self
            .agents
            .lock()
            .expect("agent-definitions mutex poisoned");
        guard.iter().find(|a| a.id == id).cloned()
    }

    /// Snapshot of all user-defined agents currently in the store. Does
    /// NOT include builtin agents — consult `builtin::get_builtin_agents`
    /// for those.
    pub fn snapshot(&self) -> Vec<AgentDefinition> {
        self.agents
            .lock()
            .expect("agent-definitions mutex poisoned")
            .clone()
    }

    /// Atomically mutate a **user-created** agent definition by id.
    ///
    /// Use `update_with_overlay` for `builtin:*` ids.
    pub fn update<F>(&self, id: &str, patch: F) -> Result<AgentDefinition, String>
    where
        F: FnOnce(&mut AgentDefinition),
    {
        if super::builtin::is_builtin_agent(id) {
            return Err(format!(
                "update() rejects builtin id '{}'; use update_with_overlay()",
                id
            ));
        }
        let (updated, snapshot) = {
            let mut guard = self
                .agents
                .lock()
                .expect("agent-definitions mutex poisoned");
            let agent = guard
                .iter_mut()
                .find(|a| a.id == id)
                .ok_or_else(|| format!("agent '{}' not found", id))?;
            patch(agent);
            super::builtin::strip_forbidden_sub_agents(agent);
            (agent.clone(), guard.clone())
        };
        self.persist(&snapshot);
        Ok(updated)
    }

    /// Update a `builtin:*` agent by writing an overlay to
    /// `~/.orgii/builtin-overrides.json`. If no overlay exists yet, the
    /// compiled-in builtin is cloned as the starting point and then
    /// patched; subsequent updates edit the existing overlay.
    ///
    /// Non-builtin ids are rejected — call `update()` for those.
    pub fn update_with_overlay<F>(&self, id: &str, patch: F) -> Result<AgentDefinition, String>
    where
        F: FnOnce(&mut AgentDefinition),
    {
        if !super::builtin::is_builtin_agent(id) {
            return Err(format!(
                "update_with_overlay() requires a builtin id; got '{}'",
                id
            ));
        }
        let (updated, snapshot) = {
            let mut guard = self
                .builtin_overrides
                .lock()
                .expect("builtin-overrides mutex poisoned");
            // Start from existing overlay, or compiled-in builtin.
            let base = match guard.get(id) {
                Some(existing) => existing.clone(),
                None => super::builtin::get_builtin_agent(id)
                    .ok_or_else(|| format!("builtin '{}' does not exist", id))?,
            };
            let mut agent = base;
            patch(&mut agent);
            super::builtin::strip_forbidden_sub_agents(&mut agent);
            guard.insert(id.to_string(), agent.clone());
            (agent, guard.clone())
        };
        self.persist_overrides(&snapshot);
        Ok(updated)
    }

    /// Remove a builtin overlay, reverting to the compiled-in definition.
    /// Returns `Ok(())` whether or not an overlay existed.
    pub fn reset_builtin(&self, id: &str) -> Result<(), String> {
        if !super::builtin::is_builtin_agent(id) {
            return Err(format!("reset_builtin requires a builtin id; got '{}'", id));
        }
        let snapshot = {
            let mut guard = self
                .builtin_overrides
                .lock()
                .expect("builtin-overrides mutex poisoned");
            guard.remove(id);
            guard.clone()
        };
        self.persist_overrides(&snapshot);
        Ok(())
    }
}

// ── File I/O ──

fn load_from_disk(path: &std::path::Path) -> Vec<AgentDefinition> {
    if !path.exists() {
        return Vec::new();
    }
    match std::fs::read_to_string(path) {
        Ok(content) => match serde_json::from_str::<Vec<AgentDefinition>>(&content) {
            Ok(agents) => {
                info!(
                    "[agent-definitions] Loaded {} agents from {}",
                    agents.len(),
                    path.display()
                );
                agents
            }
            Err(err) => {
                error!(
                    "[agent-definitions] Failed to parse {}: {}",
                    path.display(),
                    err
                );
                Vec::new()
            }
        },
        Err(err) => {
            error!(
                "[agent-definitions] Failed to read {}: {}",
                path.display(),
                err
            );
            Vec::new()
        }
    }
}

fn save_to_disk(path: &std::path::Path, agents: &[AgentDefinition]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create directory: {}", err))?;
    }
    let content = serde_json::to_string_pretty(agents)
        .map_err(|err| format!("Failed to serialize agents: {}", err))?;
    std::fs::write(path, content).map_err(|err| format!("Failed to write agents: {}", err))?;
    info!(
        "[agent-definitions] Saved {} agents to {}",
        agents.len(),
        path.display()
    );
    Ok(())
}

fn load_overrides_from_disk(path: &std::path::Path) -> BTreeMap<String, AgentDefinition> {
    if !path.exists() {
        return BTreeMap::new();
    }
    match std::fs::read_to_string(path) {
        Ok(content) => match serde_json::from_str::<BTreeMap<String, AgentDefinition>>(&content) {
            Ok(overrides) => {
                info!(
                    "[builtin-overrides] Loaded {} overrides from {}",
                    overrides.len(),
                    path.display()
                );
                overrides
            }
            Err(err) => {
                warn!(
                    "[builtin-overrides] Failed to parse {}: {} — ignoring overlay",
                    path.display(),
                    err
                );
                BTreeMap::new()
            }
        },
        Err(err) => {
            warn!(
                "[builtin-overrides] Failed to read {}: {} — ignoring overlay",
                path.display(),
                err
            );
            BTreeMap::new()
        }
    }
}

fn save_overrides_to_disk(
    path: &std::path::Path,
    overrides: &BTreeMap<String, AgentDefinition>,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create directory: {}", err))?;
    }
    let content = serde_json::to_string_pretty(overrides)
        .map_err(|err| format!("Failed to serialize overrides: {}", err))?;
    std::fs::write(path, content).map_err(|err| format!("Failed to write overrides: {}", err))?;
    info!(
        "[builtin-overrides] Saved {} overrides to {}",
        overrides.len(),
        path.display()
    );
    Ok(())
}

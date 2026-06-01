//! Persistent permission rules with pattern matching.
//!
//! Rule syntax:
//!   - `"run_shell"` — match any invocation of the tool
//!   - `"run_shell(ls *)"` — match `run_shell` where the command starts with `ls `
//!   - `"run_shell(git commit *)"` — match `git commit` and any flags
//!
//! Rules are stored per-project in `.orgii/permissions.json`.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tracing::{info, warn};

const PERMISSIONS_FILENAME: &str = "permissions.json";

// ============================================
// Permission Rule
// ============================================

/// A single permission rule: `tool_name` + optional argument pattern.
///
/// Syntax: `"tool_name"` or `"tool_name(pattern)"`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PermissionRule {
    /// The raw rule string, e.g. `"run_shell(git *)"`.
    pub rule: String,
}

impl PermissionRule {
    pub fn new(rule: impl Into<String>) -> Self {
        Self { rule: rule.into() }
    }

    /// Parse the rule into (tool_name, optional_pattern).
    fn parse(&self) -> (&str, Option<&str>) {
        if let Some(paren_start) = self.rule.find('(') {
            let tool = &self.rule[..paren_start];
            let rest = &self.rule[paren_start + 1..];
            let pattern = rest.strip_suffix(')').unwrap_or(rest);
            (tool, Some(pattern))
        } else {
            (self.rule.as_str(), None)
        }
    }

    /// Check if this rule matches a given tool call.
    ///
    /// - Tool name must match exactly.
    /// - If the rule has a pattern, it is matched against the "matchable content"
    ///   extracted from the tool args (e.g., `args["command"]` for `run_shell`).
    pub fn matches(&self, tool_name: &str, args: &serde_json::Value) -> bool {
        let (rule_tool, pattern) = self.parse();
        if rule_tool != tool_name {
            return false;
        }
        match pattern {
            None => true,
            Some(pat) => {
                let content = extract_matchable_content(tool_name, args);
                match content {
                    Some(text) => glob_match(pat, &text),
                    None => false,
                }
            }
        }
    }
}

/// Extract the "matchable content" from tool args for pattern matching.
///
/// Each tool type can define what field is used for matching:
/// - `run_shell` → `args["command"]`
/// - `edit_file` / `apply_patch` → `args["file_path"]`
/// - Other tools → `None` (only tool-name matching, no glob)
///
/// **Wiring contract**: when a permission rule includes a glob pattern
/// (`tool(pattern)`), the tool MUST appear here so the pattern can be
/// matched. The catch-all returns `None` and `RuleEntry::matches`
/// downgrades to "no match" — that means a deny rule with a pattern
/// would silently fail to fire for an unmapped tool. Callers should
/// either keep this list in sync with new sensitive tools or use a
/// bare `tool` (no pattern) form which only matches by name.
fn extract_matchable_content(tool_name: &str, args: &serde_json::Value) -> Option<String> {
    use crate::tools::names as tn;
    match tool_name {
        tn::RUN_SHELL => args
            .get("command")
            .and_then(|v| v.as_str())
            .map(String::from),
        tn::EDIT_FILE | tn::APPLY_PATCH | tn::READ_FILE => args
            .get("file_path")
            .and_then(|v| v.as_str())
            .map(String::from),
        tn::LIST_DIR => args.get("path").and_then(|v| v.as_str()).map(String::from),
        // No content-glob mapping for this tool. The doc-comment above
        // notes this means deny rules with a pattern won't fire for
        // these tools; bare `tool` rules still work via the
        // `rule_tool != tool_name` short-circuit in `RuleEntry::matches`.
        _ => None,
    }
}

/// Simple glob matching: `*` matches any sequence of characters.
///
/// Space-aware: `"ls *"` matches `"ls -la"` but NOT `"lsof"`.
fn glob_match(pattern: &str, text: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if let Some(prefix) = pattern.strip_suffix('*') {
        return text.starts_with(prefix);
    }
    pattern == text
}

// ============================================
// Persistent Permission Store
// ============================================

/// The on-disk format for `.orgii/permissions.json`.
///
/// Stores per-project allow/deny rules. The permission *mode* (which tools
/// require Ask) is now controlled by the agent-level `AutonomyLevel` in
/// `SecurityConfig`, not stored here.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PermissionStore {
    /// Always-allowed rules (survive across sessions).
    #[serde(default)]
    pub allow: Vec<PermissionRule>,
    /// Always-denied rules (survive across sessions).
    #[serde(default)]
    pub deny: Vec<PermissionRule>,

    /// Set when `load()` returned `Self::default()` because the file was
    /// present but unparseable. `save()` refuses to write while this flag
    /// is set, so a corrupt file is never overwritten with an empty store
    /// (which would silently erase the user's persisted allow/deny rules).
    /// Cleared on a fresh `load()` that succeeds.
    #[serde(skip)]
    load_failure: bool,
}

impl PermissionStore {
    /// Load from `.orgii/permissions.json` in the given workspace.
    pub fn load(workspace: &Path) -> Self {
        let path = Self::file_path(workspace);
        match std::fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str::<Self>(&content) {
                Ok(store) => store,
                Err(err) => {
                    warn!(
                        "[permissions] Failed to parse {}: {}; refusing to overwrite until repaired",
                        path.display(),
                        err
                    );
                    Self {
                        load_failure: true,
                        ..Self::default()
                    }
                }
            },
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Self::default(),
            Err(err) => {
                warn!(
                    "[permissions] Failed to read {}: {}; refusing to overwrite until readable",
                    path.display(),
                    err
                );
                Self {
                    load_failure: true,
                    ..Self::default()
                }
            }
        }
    }

    /// Save to `.orgii/permissions.json` in the given workspace.
    ///
    /// Refuses to write if the file existed but failed to load — overwriting
    /// would silently erase the user's persisted allow/deny rules. The user
    /// must repair or remove the bad file first.
    pub fn save(&self, workspace: &Path) -> Result<(), String> {
        if self.load_failure {
            return Err(format!(
                "permissions store is in failed-load state; refusing to overwrite {} \
                 (manually repair or remove the file to recover)",
                Self::file_path(workspace).display()
            ));
        }
        let path = Self::file_path(workspace);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|err| format!("Failed to create .orgii dir: {}", err))?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|err| format!("Failed to serialize permissions: {}", err))?;
        std::fs::write(&path, json)
            .map_err(|err| format!("Failed to write {}: {}", path.display(), err))?;
        info!(
            "[permissions] Saved {} rules to {}",
            self.allow.len(),
            path.display()
        );
        Ok(())
    }

    /// Add an always-allow rule (deduplicates).
    pub fn add_allow(&mut self, rule: PermissionRule) {
        if !self.allow.contains(&rule) {
            self.allow.push(rule);
        }
    }

    /// Check if a tool call matches any always-allow rule.
    pub fn is_allowed(&self, tool_name: &str, args: &serde_json::Value) -> bool {
        // Deny rules take priority
        if self.deny.iter().any(|r| r.matches(tool_name, args)) {
            return false;
        }
        self.allow.iter().any(|r| r.matches(tool_name, args))
    }

    fn file_path(workspace: &Path) -> PathBuf {
        workspace.join(".orgii").join(PERMISSIONS_FILENAME)
    }
}

// ============================================
// Tests
// ============================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ── PermissionRule parsing ──

    #[test]
    fn parse_tool_only() {
        let rule = PermissionRule::new("run_shell");
        let (tool, pattern) = rule.parse();
        assert_eq!(tool, "run_shell");
        assert!(pattern.is_none());
    }

    #[test]
    fn parse_tool_with_pattern() {
        let rule = PermissionRule::new("run_shell(ls *)");
        let (tool, pattern) = rule.parse();
        assert_eq!(tool, "run_shell");
        assert_eq!(pattern, Some("ls *"));
    }

    #[test]
    fn parse_tool_with_exact_pattern() {
        let rule = PermissionRule::new("run_shell(git status)");
        let (tool, pattern) = rule.parse();
        assert_eq!(tool, "run_shell");
        assert_eq!(pattern, Some("git status"));
    }

    // ── glob_match ──

    #[test]
    fn glob_wildcard_all() {
        assert!(glob_match("*", "anything"));
    }

    #[test]
    fn glob_prefix_match() {
        assert!(glob_match("ls *", "ls -la"));
        assert!(glob_match("git *", "git status"));
        assert!(glob_match("git commit *", "git commit -m 'msg'"));
    }

    #[test]
    fn glob_prefix_no_match() {
        assert!(!glob_match("ls *", "lsof"));
        assert!(!glob_match("git push *", "git pull"));
    }

    #[test]
    fn glob_exact_match() {
        assert!(glob_match("git status", "git status"));
        assert!(!glob_match("git status", "git status --short"));
    }

    // ── PermissionRule.matches ──

    #[test]
    fn matches_tool_only_any_args() {
        let rule = PermissionRule::new("run_shell");
        assert!(rule.matches("run_shell", &json!({"command": "rm -rf /"})));
        assert!(rule.matches("run_shell", &json!({"command": "ls"})));
    }

    #[test]
    fn matches_tool_only_wrong_tool() {
        let rule = PermissionRule::new("run_shell");
        assert!(!rule.matches("edit_file", &json!({"command": "ls"})));
    }

    #[test]
    fn matches_pattern_prefix() {
        let rule = PermissionRule::new("run_shell(ls *)");
        assert!(rule.matches("run_shell", &json!({"command": "ls -la"})));
        assert!(rule.matches("run_shell", &json!({"command": "ls /tmp"})));
        assert!(!rule.matches("run_shell", &json!({"command": "rm -rf /"})));
    }

    #[test]
    fn matches_pattern_exact() {
        let rule = PermissionRule::new("run_shell(git status)");
        assert!(rule.matches("run_shell", &json!({"command": "git status"})));
        assert!(!rule.matches("run_shell", &json!({"command": "git status --short"})));
    }

    #[test]
    fn matches_file_tool() {
        let rule = PermissionRule::new("edit_file(/src/*)");
        assert!(rule.matches("edit_file", &json!({"file_path": "/src/main.rs"})));
        assert!(!rule.matches("edit_file", &json!({"file_path": "/etc/passwd"})));
    }

    // ── PermissionStore ──

    #[test]
    fn store_allow_deduplicates() {
        let mut store = PermissionStore::default();
        store.add_allow(PermissionRule::new("run_shell(ls *)"));
        store.add_allow(PermissionRule::new("run_shell(ls *)"));
        assert_eq!(store.allow.len(), 1);
    }

    #[test]
    fn store_deny_takes_priority() {
        let mut store = PermissionStore::default();
        store.allow.push(PermissionRule::new("run_shell"));
        store.deny.push(PermissionRule::new("run_shell(rm *)"));
        assert!(store.is_allowed("run_shell", &json!({"command": "ls -la"})));
        assert!(!store.is_allowed("run_shell", &json!({"command": "rm -rf /"})));
    }

    #[test]
    fn store_no_match_returns_false() {
        let store = PermissionStore::default();
        assert!(!store.is_allowed("run_shell", &json!({"command": "ls"})));
    }

    // ── Serialization roundtrip ──

    #[test]
    fn store_serde_roundtrip() {
        let mut store = PermissionStore {
            allow: vec![
                PermissionRule::new("run_shell(git *)"),
                PermissionRule::new("run_shell(npm run *)"),
            ],
            deny: vec![PermissionRule::new("run_shell(rm -rf *)")],
            load_failure: false,
        };
        store.add_allow(PermissionRule::new("edit_file"));

        let json = serde_json::to_string_pretty(&store).unwrap();
        let loaded: PermissionStore = serde_json::from_str(&json).unwrap();

        assert_eq!(loaded.allow.len(), 3);
        assert_eq!(loaded.deny.len(), 1);
    }

    #[test]
    fn store_serde_ignores_legacy_mode_field() {
        let json = r#"{"mode":"accept_edits","allow":[{"rule":"run_shell(git *)"}],"deny":[]}"#;
        let loaded: PermissionStore = serde_json::from_str(json).unwrap();
        assert_eq!(loaded.allow.len(), 1);
        assert_eq!(loaded.allow[0].rule, "run_shell(git *)");
    }

    // ── Filesystem roundtrip ──

    #[test]
    fn store_save_and_load() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = dir.path();

        let mut store = PermissionStore::default();
        store.add_allow(PermissionRule::new("run_shell(cargo *)"));
        store.save(workspace).unwrap();

        let loaded = PermissionStore::load(workspace);
        assert_eq!(loaded.allow.len(), 1);
        assert_eq!(loaded.allow[0].rule, "run_shell(cargo *)");
    }

    #[test]
    fn store_load_missing_file_returns_default() {
        let dir = tempfile::tempdir().unwrap();
        let loaded = PermissionStore::load(dir.path());
        assert!(loaded.allow.is_empty());
        assert!(loaded.deny.is_empty());
        // A missing file is the legitimate "fresh workspace" path —
        // saves must succeed, not be gated.
        assert!(!loaded.load_failure);
        loaded
            .save(dir.path())
            .expect("save after missing-file load must succeed");
    }

    #[test]
    fn store_corrupt_file_refuses_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = dir.path();
        std::fs::create_dir_all(workspace.join(".orgii")).unwrap();
        std::fs::write(
            workspace.join(".orgii").join(PERMISSIONS_FILENAME),
            "this is not valid json {{{",
        )
        .unwrap();

        let mut loaded = PermissionStore::load(workspace);
        assert!(
            loaded.load_failure,
            "load_failure must be set for unparseable file"
        );
        loaded.add_allow(PermissionRule::new("run_shell(echo hi)"));
        let err = loaded.save(workspace).expect_err(
            "save must refuse to overwrite a corrupt file (would erase user's persisted rules)",
        );
        assert!(err.contains("failed-load state"), "{}", err);

        let original =
            std::fs::read_to_string(workspace.join(".orgii").join(PERMISSIONS_FILENAME)).unwrap();
        assert!(
            original.contains("not valid json"),
            "corrupt file must be left untouched on disk"
        );
    }

    #[test]
    fn store_repaired_file_can_be_saved() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = dir.path();
        std::fs::create_dir_all(workspace.join(".orgii")).unwrap();
        let path = workspace.join(".orgii").join(PERMISSIONS_FILENAME);

        // 1) Write corrupt content, load, observe the gate.
        std::fs::write(&path, "garbage").unwrap();
        let bad = PermissionStore::load(workspace);
        assert!(bad.load_failure);

        // 2) User repairs the file (e.g. replaces with `{}`).
        std::fs::write(&path, "{}").unwrap();
        let mut good = PermissionStore::load(workspace);
        assert!(!good.load_failure, "fresh load must clear the gate");
        good.add_allow(PermissionRule::new("edit_file"));
        good.save(workspace)
            .expect("save after successful reload must succeed");
    }
}

//! Automation rule persistence.

use std::path::{Path, PathBuf};
use tracing::info;

use super::types::AutomationRule;

/// Default storage path for OS Agent automation rules.
pub fn default_storage_path() -> PathBuf {
    app_paths::personal_automations()
}

/// Load automation rules from disk.
///
/// Behavior:
/// - Returns `Ok(empty)` only when the file does not exist.
/// - Returns `Err` for any IO or JSON parse failure so callers do NOT proceed with
///   a read-modify-write that would silently overwrite a user's corrupt file.
pub fn load_rules(path: &Path) -> Result<Vec<AutomationRule>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(path)
        .map_err(|err| format!("Failed to read rules from {}: {}", path.display(), err))?;

    let rules: Vec<AutomationRule> = serde_json::from_str(&content)
        .map_err(|err| format!("Failed to parse rules from {}: {}", path.display(), err))?;

    info!(
        "[automation] Loaded {} rules from {}",
        rules.len(),
        path.display()
    );
    Ok(rules)
}

pub fn save_rules(path: &Path, rules: &[AutomationRule]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create directory: {}", err))?;
    }

    let content = serde_json::to_string_pretty(rules)
        .map_err(|err| format!("Failed to serialize rules: {}", err))?;

    std::fs::write(path, content).map_err(|err| format!("Failed to write rules: {}", err))?;

    info!(
        "[automation] Saved {} rules to {}",
        rules.len(),
        path.display()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn load_rules_missing_file_returns_empty_ok() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("does_not_exist.json");
        let rules = load_rules(&path).expect("missing file is not an error");
        assert!(rules.is_empty());
    }

    #[test]
    fn load_rules_invalid_json_returns_err_and_preserves_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("rules.json");
        std::fs::write(&path, "{ not valid json").unwrap();

        let err = load_rules(&path).expect_err("invalid json must be surfaced");
        assert!(err.contains("Failed to parse rules"), "got: {}", err);

        let on_disk = std::fs::read_to_string(&path).unwrap();
        assert_eq!(on_disk, "{ not valid json");
    }

    #[test]
    fn load_rules_valid_json_round_trips() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("rules.json");
        std::fs::write(&path, "[]").unwrap();
        let rules = load_rules(&path).expect("valid empty array");
        assert!(rules.is_empty());
    }
}

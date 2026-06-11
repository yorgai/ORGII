use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::metadata::{CompiledConditionalPolicy, PolicySet};

const MAX_ACTIVATED_POLICY_BYTES: usize = 16_000;
const MAX_TOOL_RESULT_AUGMENT_BYTES: usize = 24_000;

#[derive(Debug)]
pub struct SessionScopedContextActivator {
    workspace_root: PathBuf,
    policies: Vec<CompiledConditionalPolicy>,
    activated_names: Mutex<HashSet<String>>,
}

impl SessionScopedContextActivator {
    pub fn from_policy_set(workspace_root: PathBuf, policy_set: PolicySet) -> Self {
        let policies = policy_set
            .conditional
            .into_iter()
            .filter_map(|policy| match policy.compile() {
                Ok(compiled) => Some(compiled),
                Err(err) => {
                    tracing::warn!("[policies] Skipping conditional policy: {}", err);
                    None
                }
            })
            .collect();
        Self {
            workspace_root,
            policies,
            activated_names: Mutex::new(HashSet::new()),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.policies.is_empty()
    }

    pub fn augment_for_read_paths(&self, paths: &[String]) -> Option<String> {
        if paths.is_empty() || self.policies.is_empty() {
            return None;
        }

        let relative_paths: Vec<PathBuf> = paths
            .iter()
            .filter_map(|path| self.relative_path_for(Path::new(path)))
            .collect();
        if relative_paths.is_empty() {
            return None;
        }

        let mut activated = self.activated_names.lock().ok()?;
        let mut sections = Vec::new();
        let mut total_bytes = 0usize;

        for policy in &self.policies {
            if activated.contains(&policy.name) {
                continue;
            }
            if !relative_paths.iter().any(|path| policy.is_match(path)) {
                continue;
            }

            let content = cap_text_utf8(&policy.content, MAX_ACTIVATED_POLICY_BYTES);
            let section = format!("### {}\n\n{}\n", policy.name, content);
            if total_bytes + section.len() > MAX_TOOL_RESULT_AUGMENT_BYTES {
                break;
            }
            total_bytes += section.len();
            activated.insert(policy.name.clone());
            sections.push(section);
        }

        if sections.is_empty() {
            None
        } else {
            Some(format!(
                "\n\n[Context rules activated by the file you just read]\n\n{}",
                sections.join("\n")
            ))
        }
    }

    fn relative_path_for(&self, path: &Path) -> Option<PathBuf> {
        let absolute = if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.workspace_root.join(path)
        };
        absolute
            .strip_prefix(&self.workspace_root)
            .ok()
            .map(Path::to_path_buf)
    }
}

fn cap_text_utf8(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_string();
    }
    let mut boundary = max_bytes;
    while boundary > 0 && !text.is_char_boundary(boundary) {
        boundary -= 1;
    }
    format!(
        "{}\n\n[policy truncated: omitted {} bytes]",
        &text[..boundary],
        text.len() - boundary
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::specialization::policies::metadata::ConditionalPolicy;

    fn activator_with(pattern: &str, content: &str, root: &Path) -> SessionScopedContextActivator {
        SessionScopedContextActivator::from_policy_set(
            root.to_path_buf(),
            PolicySet {
                unconditional: Vec::new(),
                conditional: vec![ConditionalPolicy {
                    name: "rust-rule".to_string(),
                    content: content.to_string(),
                    source_path: root.join("rust.md"),
                    path_globs: vec![pattern.to_string()],
                }],
            },
        )
    }

    #[test]
    fn activates_matching_relative_path_once() {
        let root = tempfile::tempdir().unwrap();
        let activator = activator_with("src/**/*.rs", "Use cargo test.", root.path());

        let first = activator.augment_for_read_paths(&["src/core/lib.rs".to_string()]);
        assert!(first
            .as_deref()
            .is_some_and(|text| text.contains("Use cargo test.")));

        let second = activator.augment_for_read_paths(&["src/core/lib.rs".to_string()]);
        assert!(second.is_none());
    }

    #[test]
    fn does_not_activate_non_matching_path() {
        let root = tempfile::tempdir().unwrap();
        let activator = activator_with("src/**/*.rs", "Use cargo test.", root.path());
        let result = activator.augment_for_read_paths(&["src/core/lib.ts".to_string()]);
        assert!(result.is_none());
    }

    #[test]
    fn accepts_absolute_path_under_workspace() {
        let root = tempfile::tempdir().unwrap();
        let file_path = root.path().join("src/core/lib.rs");
        let activator = activator_with("src/**/*.rs", "Use cargo test.", root.path());
        let result = activator.augment_for_read_paths(&[file_path.to_string_lossy().to_string()]);
        assert!(result
            .as_deref()
            .is_some_and(|text| text.contains("Use cargo test.")));
    }

    #[test]
    fn cap_text_utf8_never_splits_multibyte() {
        let text = "规则规则规则";
        let capped = cap_text_utf8(text, 5);
        assert!(capped.is_char_boundary(capped.len()));
        assert!(capped.contains("policy truncated"));
    }
}

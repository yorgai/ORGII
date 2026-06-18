//! SkillsLoader — core scanning and loading logic.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use super::helpers::{collect_bundled_files, estimate_summary_line_tokens, estimate_tokens};
use super::source_dirs::source_dir_path;
use super::types::{DescriptionQuality, SkillInfo, SkillListingEntry, SkillMetadata};
use crate::utils::swr_cache::SwrCache;

const SKILL_SCAN_CACHE_TTL: Duration = Duration::from_secs(2);

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct SkillScanKey {
    workspace: PathBuf,
    builtin_dir: Option<PathBuf>,
    extra_source_dirs: Vec<PathBuf>,
    agent_id: Option<String>,
    load_workspace_resources: bool,
}

static SKILL_SCAN_CACHE: LazyLock<Arc<SwrCache<SkillScanKey, Vec<SkillInfo>>>> =
    LazyLock::new(Arc::default);

/// Loads and manages agent skills.
pub struct SkillsLoader {
    workspace: PathBuf,
    builtin_dir: Option<PathBuf>,
    extra_source_dirs: Vec<PathBuf>,
    disabled_skills: Vec<String>,
    skills_enabled: bool,
    agent_id: Option<String>,
    load_workspace_resources: bool,
}

impl SkillsLoader {
    /// Create a new skills loader.
    ///
    /// - `workspace`: Agent workspace directory (checks `{workspace}/skills/`)
    /// - Builtin skills are optional.
    pub fn new(workspace: &Path) -> Self {
        Self {
            workspace: workspace.to_path_buf(),
            builtin_dir: None,
            extra_source_dirs: Vec::new(),
            disabled_skills: Vec::new(),
            skills_enabled: true,
            agent_id: None,
            load_workspace_resources: true,
        }
    }

    /// Set the directory for builtin skills.
    pub fn with_builtin_dir(mut self, dir: PathBuf) -> Self {
        self.builtin_dir = Some(dir);
        self
    }

    /// Add read-only skill source directories for this loader.
    pub fn with_extra_source_dirs(mut self, dirs: &[String]) -> Self {
        self.extra_source_dirs = dirs.iter().map(|dir| source_dir_path(dir)).collect();
        self.extra_source_dirs.sort();
        self.extra_source_dirs.dedup();
        self
    }

    /// Set skill names that the user has disabled.
    pub fn with_disabled_skills(mut self, disabled: Vec<String>) -> Self {
        self.disabled_skills = disabled;
        self
    }

    /// Set whether skills are globally enabled.
    pub fn with_skills_enabled(mut self, enabled: bool) -> Self {
        self.skills_enabled = enabled;
        self
    }

    pub fn with_agent_id(mut self, agent_id: impl Into<String>) -> Self {
        self.agent_id = Some(agent_id.into());
        self
    }

    pub fn with_load_workspace_resources(mut self, enabled: bool) -> Self {
        self.load_workspace_resources = enabled;
        self
    }

    /// List all available skills.
    ///
    /// Applies `disabled_skills` filtering: disabled skills have `enabled = false`.
    pub fn list_skills(&self) -> Vec<SkillInfo> {
        let key = SkillScanKey {
            workspace: self.workspace.clone(),
            builtin_dir: self.builtin_dir.clone(),
            extra_source_dirs: self.extra_source_dirs.clone(),
            agent_id: self.agent_id.clone(),
            load_workspace_resources: self.load_workspace_resources,
        };
        let scan_workspace = self.workspace.clone();
        let scan_builtin_dir = self.builtin_dir.clone();
        let scan_extra_source_dirs = self.extra_source_dirs.clone();
        let scan_agent_id = self.agent_id.clone();
        let scan_load_workspace_resources = self.load_workspace_resources;
        let mut skills = SKILL_SCAN_CACHE
            .get_or_refresh(key, SKILL_SCAN_CACHE_TTL, move || {
                let scanner = SkillsLoader::new(&scan_workspace)
                    .with_builtin_dir_if_some(scan_builtin_dir.clone())
                    .with_extra_source_paths(scan_extra_source_dirs.clone())
                    .with_agent_id_if_some(scan_agent_id.clone())
                    .with_load_workspace_resources(scan_load_workspace_resources);
                Ok(scanner.scan_skills_uncached())
            })
            .unwrap_or_else(|err| {
                tracing::warn!("Failed to refresh skills scan cache: {}", err);
                self.scan_skills_uncached()
            });

        self.apply_disabled_skills(&mut skills);
        skills
    }

    fn with_builtin_dir_if_some(mut self, dir: Option<PathBuf>) -> Self {
        self.builtin_dir = dir;
        self
    }

    fn with_extra_source_paths(mut self, dirs: Vec<PathBuf>) -> Self {
        self.extra_source_dirs = dirs;
        self
    }

    fn with_agent_id_if_some(mut self, agent_id: Option<String>) -> Self {
        self.agent_id = agent_id;
        self
    }

    /// Evict the scan cache for this workspace so the next `list_skills` call
    /// does a fresh synchronous scan instead of returning stale data.
    ///
    /// Call this immediately after any mutation that adds or removes skills
    /// (import, create, delete) so the UI sees the updated list right away.
    pub fn invalidate_cache(&self) {
        let key = SkillScanKey {
            workspace: self.workspace.clone(),
            builtin_dir: self.builtin_dir.clone(),
            extra_source_dirs: self.extra_source_dirs.clone(),
            agent_id: self.agent_id.clone(),
            load_workspace_resources: self.load_workspace_resources,
        };
        SKILL_SCAN_CACHE.invalidate(&key);
    }

    /// Evict all scan cache entries. Use when the caller does not have a
    /// `SkillsLoader` instance (e.g. the external-import pipeline).
    pub fn invalidate_all_caches() {
        SKILL_SCAN_CACHE.clear();
    }

    fn scan_skills_uncached(&self) -> Vec<SkillInfo> {
        let mut skills = Vec::new();

        let workspace_skills_dir = self.workspace.join("skills");
        if self.load_workspace_resources && workspace_skills_dir.exists() {
            self.scan_skills_dir(&workspace_skills_dir, "workspace", &mut skills);
        }

        if self.load_workspace_resources {
            for source_dir in self.default_workspace_skill_source_dirs() {
                if source_dir.exists() {
                    self.scan_supplemental_dir_recursive(
                        &source_dir,
                        "external-source",
                        &mut skills,
                    );
                }
            }
        }

        if let Some(ref builtin_dir) = self.builtin_dir {
            if builtin_dir.exists() {
                self.scan_supplemental_dir(builtin_dir, "builtin", &mut skills);
            }
        }

        for source_dir in &self.extra_source_dirs {
            if source_dir.exists() {
                self.scan_supplemental_dir_recursive(source_dir, "agent-source", &mut skills);
            }
        }

        skills
    }

    fn default_workspace_skill_source_dirs(&self) -> Vec<PathBuf> {
        let Some(workspace_root) = self.workspace.parent() else {
            return Vec::new();
        };
        vec![
            workspace_root.join(".cursor").join("skills"),
            workspace_root.join(".claude").join("skills"),
        ]
    }

    fn apply_disabled_skills(&self, skills: &mut [SkillInfo]) {
        for skill in skills {
            if self.disabled_skills.contains(&skill.name) {
                skill.enabled = false;
            }
        }
    }

    /// Load a skill's full content by name.
    pub fn load_skill(&self, name: &str) -> Option<String> {
        let workspace_path = self.workspace.join("skills").join(name).join("SKILL.md");
        if self.load_workspace_resources && workspace_path.exists() {
            match fs::read_to_string(&workspace_path) {
                Ok(contents) => {
                    let meta = self.parse_skill_metadata(&contents);
                    if self.skill_metadata_applies_to_agent(&meta) {
                        return Some(contents);
                    }
                    return None;
                }
                Err(err) => {
                    tracing::warn!(
                        "Failed to read workspace skill {} at {}: {}",
                        name,
                        workspace_path.display(),
                        err
                    );
                    return None;
                }
            }
        }

        if self.load_workspace_resources {
            for source_dir in self.default_workspace_skill_source_dirs() {
                if let Some(contents) =
                    self.load_skill_from_source_dir(&source_dir, name, "external-source")
                {
                    return Some(contents);
                }
            }
        }

        if let Some(ref builtin_dir) = self.builtin_dir {
            let builtin_path = builtin_dir.join(name).join("SKILL.md");
            if builtin_path.exists() {
                match fs::read_to_string(&builtin_path) {
                    Ok(contents) => {
                        let meta = self.parse_skill_metadata(&contents);
                        if self.skill_metadata_applies_to_agent(&meta) {
                            return Some(contents);
                        }
                        return None;
                    }
                    Err(err) => {
                        tracing::warn!(
                            "Failed to read builtin skill {} at {}: {}",
                            name,
                            builtin_path.display(),
                            err
                        );
                        return None;
                    }
                }
            }
        }

        for source_dir in &self.extra_source_dirs {
            if let Some(contents) =
                self.load_skill_from_source_dir(source_dir, name, "agent-source")
            {
                return Some(contents);
            }
        }

        // Final fallback: binary-embedded built-in skills (`/create-skill`,
        // `/create-rule`, `/create-orgii-agent`). They ship with the binary so
        // slash commands always work, even on a fresh install with an
        // empty `~/.orgii/skills/`.
        super::super::builtin::load_builtin_skill(name).map(str::to_string)
    }

    /// Get skills marked as "always" loaded (must also be available and enabled).
    pub fn get_always_skills(&self) -> Vec<SkillInfo> {
        self.list_skills()
            .into_iter()
            .filter(|skill| skill.always && skill.available && skill.enabled)
            .collect()
    }

    /// Whether skills are globally enabled.
    pub fn is_enabled(&self) -> bool {
        self.skills_enabled
    }

    /// Build a stable manifest for `always: true` skills.
    ///
    /// The manifest gives the model each skill's name, description, and
    /// `SKILL.md` path. It intentionally does not inline full skill bodies;
    /// those are loaded on demand through `read_file` only after the model
    /// decides the skill is needed.
    pub fn build_always_skills_manifest_section(
        &self,
        disabled_skills: &[String],
        include_filter: Option<&[String]>,
    ) -> Vec<String> {
        let is_allowed = |name: &str| -> bool {
            if disabled_skills.iter().any(|disabled| disabled == name) {
                return false;
            }
            if let Some(includes) = include_filter {
                return includes.iter().any(|included| included == name);
            }
            true
        };

        let always_skills: Vec<_> = self
            .get_always_skills()
            .into_iter()
            .filter(|skill| is_allowed(&skill.name))
            .collect();

        if always_skills.is_empty() {
            return Vec::new();
        }

        let lines: Vec<String> = always_skills
            .iter()
            .map(|skill| {
                let description = if skill.description.is_empty() {
                    "No description".to_string()
                } else {
                    skill.description.clone()
                };
                format!(
                    "- **{}** ({}): {} — read `{}` before applying this skill.",
                    skill.name,
                    skill.source,
                    description,
                    skill.path.display(),
                )
            })
            .collect();

        vec![format!(
            "# Active Skills\n\n\
             The skills below are always available for this session. Their full SKILL.md bodies are not inlined here to keep the prompt cache stable.\n\
             Before applying one, read its SKILL.md with `read_file` and follow it exactly.\n\n\
             {}",
            lines.join("\n")
        )]
    }

    /// Build the per-turn skill listing entries.
    pub fn build_skill_listing_entries(
        &self,
        disabled_skills: &[String],
        include_filter: Option<&[String]>,
    ) -> Vec<SkillListingEntry> {
        let is_allowed = |name: &str| -> bool {
            if disabled_skills.iter().any(|d| d == name) {
                return false;
            }
            if let Some(includes) = include_filter {
                return includes.iter().any(|inc| inc == name);
            }
            true
        };

        self.list_skills()
            .into_iter()
            .filter(|skill| skill.enabled && skill.available && is_allowed(&skill.name))
            .map(|skill| {
                let status = if skill.available {
                    "available"
                } else {
                    "unavailable"
                };
                let desc = if skill.description.is_empty() {
                    "No description".to_string()
                } else {
                    skill.description.clone()
                };
                SkillListingEntry {
                    name: skill.name.clone(),
                    line: format!(
                        "- **{}** ({}): {} [{}]",
                        skill.name, skill.source, desc, status,
                    ),
                }
            })
            .collect()
    }

    pub fn format_skill_listing_entries(entries: &[SkillListingEntry]) -> Option<String> {
        if entries.is_empty() {
            return None;
        }

        let lines: Vec<&str> = entries.iter().map(|entry| entry.line.as_str()).collect();
        Some(format!(
            "Skills relevant to your task:\n\
             Before replying: scan the skill descriptions below.\n\
             - If exactly one skill clearly applies: read its SKILL.md using `read_file`, then follow it.\n\
             - If multiple could apply: choose the most specific one, then read/follow it.\n\
             - If none clearly apply: do not read any SKILL.md.\n\
             Constraints: never read more than one skill up front; only read after selecting.\n\n\
             {}",
            lines.join("\n")
        ))
    }

    /// Build the per-turn skill listing attachment.
    pub fn build_skill_listing_attachment(
        &self,
        disabled_skills: &[String],
        include_filter: Option<&[String]>,
    ) -> Option<String> {
        let entries = self.build_skill_listing_entries(disabled_skills, include_filter);
        Self::format_skill_listing_entries(&entries)
    }

    // ========== Private ==========

    fn scan_supplemental_dir(&self, dir: &Path, source: &str, skills: &mut Vec<SkillInfo>) {
        let existing_names: Vec<String> = skills.iter().map(|skill| skill.name.clone()).collect();
        let mut supplemental_skills = Vec::new();
        self.scan_skills_dir(dir, source, &mut supplemental_skills);
        for skill in supplemental_skills {
            if !existing_names.contains(&skill.name) {
                skills.push(skill);
            }
        }
    }

    fn scan_supplemental_dir_recursive(
        &self,
        dir: &Path,
        source: &str,
        skills: &mut Vec<SkillInfo>,
    ) {
        let existing_names: Vec<String> = skills.iter().map(|skill| skill.name.clone()).collect();
        let mut supplemental_skills = Vec::new();
        self.scan_skills_dir_recursive(dir, source, &mut supplemental_skills);
        for skill in supplemental_skills {
            if !existing_names.contains(&skill.name) {
                skills.push(skill);
            }
        }
    }

    fn scan_skills_dir(&self, dir: &Path, source: &str, out: &mut Vec<SkillInfo>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            self.scan_skill_dir(&path, source, out);
        }
    }

    fn scan_skills_dir_recursive(&self, dir: &Path, source: &str, out: &mut Vec<SkillInfo>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if path.join("SKILL.md").exists() {
                self.scan_skill_dir(&path, source, out);
                continue;
            }
            self.scan_skills_dir_recursive(&path, source, out);
        }
    }

    fn scan_skill_dir(&self, path: &Path, source: &str, out: &mut Vec<SkillInfo>) {
        let skill_file = path.join("SKILL.md");
        if !skill_file.exists() {
            return;
        }

        let Some(name) = path
            .file_name()
            .and_then(|file_name| file_name.to_str())
            .map(str::to_string)
        else {
            tracing::warn!("Skipping skill dir with non-UTF8 name: {}", path.display());
            return;
        };

        let content = match fs::read_to_string(&skill_file) {
            Ok(text) => text,
            Err(err) => {
                tracing::warn!(
                    "Failed to read SKILL.md for {} at {}: {}",
                    name,
                    skill_file.display(),
                    err
                );
                return;
            }
        };
        let meta = self.parse_skill_metadata(&content);
        if !self.skill_metadata_applies_to_agent(&meta) {
            return;
        }

        let (available, m_bins, m_env) =
            self.check_requirements(&meta.required_bins, &meta.required_env);

        let full_content_tokens = estimate_tokens(&content);
        let estimated_tokens = estimate_summary_line_tokens(&name, &meta.description);

        let description_quality = if meta.description.is_empty() {
            DescriptionQuality::Missing
        } else if meta.description.len() < 20 {
            DescriptionQuality::Short
        } else {
            DescriptionQuality::Good
        };

        let bundled_files = collect_bundled_files(path);

        out.push(SkillInfo {
            name,
            path: skill_file,
            source: source.to_string(),
            always: meta.always,
            available,
            enabled: true,
            required_bins: meta.required_bins,
            required_env: meta.required_env,
            description: meta.description,
            estimated_tokens,
            full_content_tokens,
            description_quality,
            version: meta.version,
            license: meta.license,
            compatibility: meta.compatibility,
            missing_bins: m_bins,
            missing_env: m_env,
            bundled_files,
        });
    }

    fn load_skill_from_source_dir(&self, dir: &Path, name: &str, source: &str) -> Option<String> {
        let source_path = self.find_skill_file_recursive(dir, name)?;
        match fs::read_to_string(&source_path) {
            Ok(contents) => {
                let meta = self.parse_skill_metadata(&contents);
                if self.skill_metadata_applies_to_agent(&meta) {
                    Some(contents)
                } else {
                    None
                }
            }
            Err(err) => {
                tracing::warn!(
                    "Failed to read {} skill {} at {}: {}",
                    source,
                    name,
                    source_path.display(),
                    err
                );
                None
            }
        }
    }

    fn find_skill_file_recursive(&self, dir: &Path, name: &str) -> Option<PathBuf> {
        let entries = fs::read_dir(dir).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let skill_file = path.join("SKILL.md");
            if path.file_name().and_then(|file_name| file_name.to_str()) == Some(name)
                && skill_file.exists()
            {
                return Some(skill_file);
            }
            if let Some(found) = self.find_skill_file_recursive(&path, name) {
                return Some(found);
            }
        }
        None
    }

    fn skill_metadata_applies_to_agent(&self, meta: &SkillMetadata) -> bool {
        let Some(agent_id) = self.agent_id.as_deref() else {
            return meta.include_agents.is_empty();
        };
        if meta
            .exclude_agents
            .iter()
            .any(|excluded| excluded == agent_id)
        {
            return false;
        }
        meta.include_agents.is_empty()
            || meta
                .include_agents
                .iter()
                .any(|included| included == agent_id)
    }

    fn parse_inline_list(line: &str) -> Vec<String> {
        let inner = line.split('[').nth(1).unwrap_or("").trim_end_matches(']');
        inner
            .split(',')
            .map(|item| item.trim().trim_matches('"').trim_matches('\'').to_string())
            .filter(|item| !item.is_empty())
            .collect()
    }

    /// Parse YAML frontmatter from a skill file.
    ///
    /// Expects frontmatter delimited by `---` at the top of the file.
    fn parse_skill_metadata(&self, content: &str) -> SkillMetadata {
        let mut meta = SkillMetadata::default();

        if let Some(after_start) = content.strip_prefix("---") {
            if let Some(end_idx) = after_start.find("---") {
                let frontmatter = &after_start[..end_idx];
                let mut in_bins = false;
                let mut in_env = false;
                let mut in_include_agent = false;
                let mut in_exclude_agent = false;

                for line in frontmatter.lines() {
                    let trimmed = line.trim();

                    if !trimmed.starts_with('-') && !trimmed.is_empty() {
                        in_bins = false;
                        in_env = false;
                        in_include_agent = false;
                        in_exclude_agent = false;
                    }

                    if let Some(after) = trimmed.strip_prefix("name:") {
                        let val = after.trim().trim_matches('"').trim_matches('\'');
                        if !val.is_empty() {
                            meta.name = val.to_string();
                        }
                    } else if let Some(after) = trimmed.strip_prefix("description:") {
                        let val = after.trim().trim_matches('"').trim_matches('\'');
                        if !val.is_empty() {
                            meta.description = val.to_string();
                        }
                    } else if trimmed.starts_with("always:") {
                        meta.always = trimmed.contains("true");
                    } else if let Some(after) = trimmed.strip_prefix("version:") {
                        let val = after.trim().trim_matches('"').trim_matches('\'');
                        if !val.is_empty() {
                            meta.version = val.to_string();
                        }
                    } else if let Some(after) = trimmed.strip_prefix("license:") {
                        let val = after.trim().trim_matches('"').trim_matches('\'');
                        if !val.is_empty() {
                            meta.license = val.to_string();
                        }
                    } else if let Some(after) = trimmed.strip_prefix("compatibility:") {
                        let val = after.trim().trim_matches('"').trim_matches('\'');
                        if !val.is_empty() {
                            meta.compatibility = val.to_string();
                        }
                    } else if trimmed == "include-agent:" || trimmed.starts_with("include-agent:") {
                        in_include_agent = true;
                        in_exclude_agent = false;
                        in_bins = false;
                        in_env = false;
                        if trimmed.contains('[') {
                            meta.include_agents.extend(Self::parse_inline_list(trimmed));
                            in_include_agent = false;
                        }
                    } else if trimmed == "exclude-agent:" || trimmed.starts_with("exclude-agent:") {
                        in_exclude_agent = true;
                        in_include_agent = false;
                        in_bins = false;
                        in_env = false;
                        if trimmed.contains('[') {
                            meta.exclude_agents.extend(Self::parse_inline_list(trimmed));
                            in_exclude_agent = false;
                        }
                    } else if trimmed == "bins:" || trimmed.starts_with("bins:") {
                        in_bins = true;
                        in_env = false;
                        in_include_agent = false;
                        in_exclude_agent = false;
                        if trimmed.contains('[') {
                            let inner = trimmed
                                .split('[')
                                .nth(1)
                                .unwrap_or("")
                                .trim_end_matches(']');
                            for item in inner.split(',') {
                                let val = item.trim().trim_matches('"').trim_matches('\'');
                                if !val.is_empty() {
                                    meta.required_bins.push(val.to_string());
                                }
                            }
                            in_bins = false;
                        }
                    } else if trimmed == "env:" || trimmed.starts_with("env:") {
                        in_env = true;
                        in_bins = false;
                        in_include_agent = false;
                        in_exclude_agent = false;
                        if trimmed.contains('[') {
                            let inner = trimmed
                                .split('[')
                                .nth(1)
                                .unwrap_or("")
                                .trim_end_matches(']');
                            for item in inner.split(',') {
                                let val = item.trim().trim_matches('"').trim_matches('\'');
                                if !val.is_empty() {
                                    meta.required_env.push(val.to_string());
                                }
                            }
                            in_env = false;
                        }
                    } else if let Some(after) = trimmed.strip_prefix("- ") {
                        let val = after.trim().trim_matches('"').trim_matches('\'');
                        if in_bins && !val.is_empty() {
                            meta.required_bins.push(val.to_string());
                        } else if in_env && !val.is_empty() {
                            meta.required_env.push(val.to_string());
                        } else if in_include_agent && !val.is_empty() {
                            meta.include_agents.push(val.to_string());
                        } else if in_exclude_agent && !val.is_empty() {
                            meta.exclude_agents.push(val.to_string());
                        }
                    }
                }
            }
        }

        // Fallback: derive description from first non-header body line if not in frontmatter
        if meta.description.is_empty() {
            let body_start = if let Some(after_start) = content.strip_prefix("---") {
                after_start.find("---").map(|idx| idx + 6).unwrap_or(0)
            } else {
                0
            };

            for line in content[body_start..].lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("<!--") {
                    continue;
                }
                meta.description = crate::utils::safe_truncate_chars_to_string(&trimmed, 120);
                break;
            }
        }

        meta
    }

    /// Check requirements and return (available, missing_bins, missing_env).
    fn check_requirements(
        &self,
        bins: &[String],
        env_vars: &[String],
    ) -> (bool, Vec<String>, Vec<String>) {
        let missing_bins: Vec<String> = bins
            .iter()
            .filter(|bin| which::which(bin).is_err())
            .cloned()
            .collect();

        let missing_env: Vec<String> = env_vars
            .iter()
            .filter(|var| std::env::var(var).is_err())
            .cloned()
            .collect();

        let available = missing_bins.is_empty() && missing_env.is_empty();
        (available, missing_bins, missing_env)
    }
}

#[cfg(test)]
mod include_filter_tests {
    //! Pin the `include_filter` whitelist on
    //! `SkillsLoader::build_skill_listing_attachment` and
    //! `build_always_skills_section`. The wiring path is
    //! `AgentSkillsConfig.include` → `processor::prompt` →
    //! `SkillsListingSection` → these helpers; the tests below lock
    //! that contract regardless of whether a UI editor is present.
    use super::SkillsLoader;
    use std::fs;
    use std::path::PathBuf;

    fn write_skill(workspace: &std::path::Path, name: &str, body: &str) {
        let dir = workspace.join("skills").join(name);
        fs::create_dir_all(&dir).expect("mkdir skill");
        fs::write(dir.join("SKILL.md"), body).expect("write SKILL.md");
    }

    fn skill_doc(name: &str, description: &str) -> String {
        format!("---\nname: {name}\ndescription: {description}\n---\n\n# {name}\n\nbody\n")
    }

    fn always_skill_doc(name: &str, description: &str, body: &str) -> String {
        format!(
            "---\nname: {name}\ndescription: {description}\nalways: true\n---\n\n# {name}\n\n{body}\n"
        )
    }

    fn unavailable_skill_doc(name: &str, description: &str) -> String {
        format!(
            "---\nname: {name}\ndescription: {description}\nenv:\n  - ORGII_E2E_MISSING_SKILL_ENV\n---\n\n# {name}\n\nbody\n"
        )
    }

    fn temp_workspace(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "orgii_skills_include_test_{}_{}",
            tag,
            std::process::id(),
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir workspace");
        dir
    }

    #[test]
    fn no_include_filter_means_every_undisabled_skill_is_listed() {
        let ws = temp_workspace("no_filter");
        write_skill(&ws, "alpha", &skill_doc("alpha", "first"));
        write_skill(&ws, "beta", &skill_doc("beta", "second"));
        write_skill(&ws, "gamma", &skill_doc("gamma", "third"));

        let loader = SkillsLoader::new(&ws);
        let attachment = loader
            .build_skill_listing_attachment(&[], None)
            .expect("listing populated");
        assert!(attachment.contains("alpha"));
        assert!(attachment.contains("beta"));
        assert!(attachment.contains("gamma"));
    }

    #[test]
    fn include_filter_narrows_listing_to_named_skills() {
        let ws = temp_workspace("narrows");
        write_skill(&ws, "alpha", &skill_doc("alpha", "first"));
        write_skill(&ws, "beta", &skill_doc("beta", "second"));
        write_skill(&ws, "gamma", &skill_doc("gamma", "third"));

        let loader = SkillsLoader::new(&ws);
        let include = vec!["alpha".to_string(), "gamma".to_string()];
        let attachment = loader
            .build_skill_listing_attachment(&[], Some(&include))
            .expect("listing populated");
        assert!(attachment.contains("alpha"));
        assert!(attachment.contains("gamma"));
        assert!(
            !attachment.contains("\nbeta") && !attachment.contains(" beta "),
            "beta must be filtered out by include_filter; got:\n{attachment}",
        );
    }

    #[test]
    fn empty_include_filter_means_no_skills() {
        // The prompt code only passes `Some(&[..])` when the slice is
        // non-empty (`!sc.include.is_empty()`), so `Some(&[])` is a
        // boundary case that the loader still has to handle correctly:
        // an explicit empty whitelist excludes everything.
        let ws = temp_workspace("empty_filter");
        write_skill(&ws, "alpha", &skill_doc("alpha", "first"));

        let loader = SkillsLoader::new(&ws);
        let empty: Vec<String> = Vec::new();
        let attachment = loader.build_skill_listing_attachment(&[], Some(&empty));
        assert!(
            attachment.is_none(),
            "explicit empty include_filter must produce no listing; got: {attachment:?}",
        );
    }

    #[test]
    fn frontmatter_agent_scope_filters_skills() {
        let ws = temp_workspace("agent_scope");
        write_skill(
            &ws,
            "included",
            "---\nname: included\ndescription: included skill\ninclude-agent:\n  - agent-a\n---\nbody",
        );
        write_skill(
            &ws,
            "excluded",
            "---\nname: excluded\ndescription: excluded skill\nexclude-agent:\n  - agent-a\n---\nbody",
        );
        write_skill(
            &ws,
            "other",
            "---\nname: other\ndescription: other skill\ninclude-agent: [agent-b]\n---\nbody",
        );

        let loader = SkillsLoader::new(&ws).with_agent_id("agent-a");
        let names = loader
            .list_skills()
            .into_iter()
            .map(|skill| skill.name)
            .collect::<Vec<_>>();

        assert_eq!(names, vec!["included"]);
    }

    #[test]
    fn workspace_toggle_skips_workspace_skills() {
        let ws = temp_workspace("workspace_toggle");
        write_skill(
            &ws,
            "workspace-only",
            &skill_doc("workspace-only", "workspace skill"),
        );

        let loader = SkillsLoader::new(&ws).with_load_workspace_resources(false);

        assert!(loader.list_skills().is_empty());
    }

    #[test]
    fn workspace_source_skills_are_auto_loaded() {
        let repo = temp_workspace("workspace_sources_repo");
        let cursor_skill_dir = repo.join(".cursor/skills/cursor-audit");
        fs::create_dir_all(&cursor_skill_dir).expect("mkdir cursor skill");
        fs::write(
            cursor_skill_dir.join("SKILL.md"),
            skill_doc("cursor-audit", "Cursor repo skill"),
        )
        .expect("write cursor skill");

        let loader = SkillsLoader::new(&repo.join(".orgii"));
        let names = loader
            .list_skills()
            .into_iter()
            .map(|skill| (skill.name, skill.source))
            .collect::<Vec<_>>();

        assert_eq!(
            names,
            vec![("cursor-audit".to_string(), "external-source".to_string())]
        );
        assert!(loader
            .load_skill("cursor-audit")
            .unwrap_or_default()
            .contains("Cursor repo skill"));
    }

    #[test]
    fn workspace_toggle_skips_workspace_source_skills() {
        let repo = temp_workspace("workspace_sources_toggle");
        let cursor_skill_dir = repo.join(".cursor/skills/cursor-audit");
        fs::create_dir_all(&cursor_skill_dir).expect("mkdir cursor skill");
        fs::write(
            cursor_skill_dir.join("SKILL.md"),
            skill_doc("cursor-audit", "Cursor repo skill"),
        )
        .expect("write cursor skill");

        let loader = SkillsLoader::new(&repo.join(".orgii")).with_load_workspace_resources(false);

        assert!(loader.list_skills().is_empty());
    }

    #[test]
    fn always_skills_render_manifest_without_body() {
        let ws = temp_workspace("always_manifest");
        write_skill(
            &ws,
            "cache-audit",
            &always_skill_doc("cache-audit", "Audit prompt cache", "SECRET BODY DETAIL"),
        );

        let loader = SkillsLoader::new(&ws);
        let sections = loader.build_always_skills_manifest_section(&[], None);
        assert_eq!(sections.len(), 1);
        let manifest = &sections[0];
        assert!(manifest.contains("cache-audit"));
        assert!(manifest.contains("Audit prompt cache"));
        assert!(manifest.contains("SKILL.md"));
        assert!(manifest.contains("read_file"));
        assert!(
            !manifest.contains("SECRET BODY DETAIL"),
            "always skill body must be loaded on demand, not inlined: {manifest}",
        );
    }

    #[test]
    fn listing_excludes_unavailable_skills() {
        let ws = temp_workspace("unavailable_hidden");
        write_skill(&ws, "alpha", &skill_doc("alpha", "first"));
        write_skill(
            &ws,
            "blocked",
            &unavailable_skill_doc("blocked", "missing env"),
        );

        let loader = SkillsLoader::new(&ws);
        let attachment = loader
            .build_skill_listing_attachment(&[], None)
            .expect("listing populated");
        assert!(attachment.contains("alpha"));
        assert!(
            !attachment.contains("blocked"),
            "unavailable skills must not appear in LLM listing; got:\n{attachment}",
        );
    }

    #[test]
    fn disabled_skills_take_precedence_over_include_filter() {
        let ws = temp_workspace("disabled_wins");
        write_skill(&ws, "alpha", &skill_doc("alpha", "first"));
        write_skill(&ws, "beta", &skill_doc("beta", "second"));

        let loader = SkillsLoader::new(&ws);
        let include = vec!["alpha".to_string(), "beta".to_string()];
        let disabled = vec!["alpha".to_string()];
        let attachment = loader
            .build_skill_listing_attachment(&disabled, Some(&include))
            .expect("listing populated");
        assert!(
            !attachment.contains("\nalpha") && !attachment.contains(" alpha "),
            "alpha is disabled and must NOT appear; got:\n{attachment}",
        );
        assert!(attachment.contains("beta"));
    }
}

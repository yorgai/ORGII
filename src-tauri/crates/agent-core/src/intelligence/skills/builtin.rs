//! Built-in skills that ship embedded in the binary.
//!
//! These correspond to slash commands like `/create-skill`,
//! `/create-rule`, and `/create-orgii-agent`. Their SKILL.md content is
//! compiled into the binary via `include_str!` so they are always
//! available without external files; `SkillsLoader::load_skill` falls
//! back to [`load_builtin_skill`] when neither the workspace nor the
//! global builtin directory contains a matching skill.

use super::loader::SkillInfo;

struct BuiltinSkill {
    name: &'static str,
    description: &'static str,
    content: &'static str,
}

const BUILTIN_SKILLS: &[BuiltinSkill] = &[
    BuiltinSkill {
        name: "create-skill",
        description: "Create Agent Skills for ORGII. Use when the user wants to create, write, or author a new skill, capture a workflow as a skill, or asks about SKILL.md format, skill structure, or best practices.",
        content: include_str!("builtin_data/create-skill/SKILL.md"),
    },
    BuiltinSkill {
        name: "create-rule",
        description: "Create persistent AI guidance rules for ORGII. Use when the user wants to create a rule, add coding standards, set up project conventions, configure file-specific patterns, or asks about .orgii/rules/ format.",
        content: include_str!("builtin_data/create-rule/SKILL.md"),
    },
    BuiltinSkill {
        name: "create-orgii-agent",
        description: "Create or modify a custom ORGII agent definition and its org membership. Use when the user wants to create, configure, retune, rename, or delete an agent, define an agent's soul / capabilities / tools, organize agents into an org, or asks about agent-definitions.json.",
        content: include_str!("builtin_data/create-orgii-agent/SKILL.md"),
    },
];

/// Return lightweight info for all built-in skills (for the slash menu).
pub fn list_builtin_skills() -> Vec<SkillInfo> {
    BUILTIN_SKILLS
        .iter()
        .map(|skill| SkillInfo {
            name: skill.name.to_string(),
            path: format!("builtin://{}/SKILL.md", skill.name).into(),
            source: "builtin".to_string(),
            always: false,
            available: true,
            enabled: true,
            required_bins: Vec::new(),
            required_env: Vec::new(),
            description: skill.description.to_string(),
            estimated_tokens: 0,
            full_content_tokens: 0,
            description_quality: super::loader::DescriptionQuality::Good,
            version: String::new(),
            license: String::new(),
            compatibility: String::new(),
            missing_bins: Vec::new(),
            missing_env: Vec::new(),
            bundled_files: Vec::new(),
        })
        .collect()
}

/// Load the binary-embedded SKILL.md content for a built-in skill by
/// name. Returns `None` for unknown skills so callers can fall back to
/// disk lookups (workspace `.orgii/skills/`, then `~/.orgii/skills/`).
pub fn load_builtin_skill(name: &str) -> Option<&'static str> {
    BUILTIN_SKILLS
        .iter()
        .find(|s| s.name == name)
        .map(|s| s.content)
}

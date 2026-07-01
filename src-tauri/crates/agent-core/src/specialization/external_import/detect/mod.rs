//! Detector pipeline for the external-import wizard.
//!
//! Vendor-specific filesystem discovery lives in Brick. ORGII maps Brick's
//! neutral artifacts into the existing import wizard contract and adds only the
//! ORGII-local collision checks needed by the apply path.

use std::path::{Path, PathBuf};

use brick_core::{
    ArtifactKind, ArtifactSourceAgent, ArtifactSourceScope, ArtifactWarning, DiscoveredArtifact,
};

use super::types::{
    readonly_excluded_tool_names, DetectedItem, FidelityWarning, ItemKind, ItemPreview,
    SourceAgent, SourceScope,
};
use crate::specialization::mcp::config::{
    global_config_path, workspace_config_path, McpConfigFile,
};
use crate::specialization::policies::{policies_dir_for_source, PolicySource};

/// Top-level detector. Runs Brick's external artifact discovery for one
/// destination section and maps the result to ORGII's import wizard DTO.
/// `None` scans user-global sources for the Global section; `Some(repo)` scans
/// repo-local sources for that repo's section.
pub fn detect_all(repo_path: Option<&Path>) -> Vec<DetectedItem> {
    brick_core::discover_artifacts(repo_path)
        .into_iter()
        .map(to_detected_item)
        .collect()
}

fn to_detected_item(artifact: DiscoveredArtifact) -> DetectedItem {
    let source_agent = to_source_agent(artifact.source_agent);
    let source_scope = to_source_scope(artifact.source_scope);
    let kind = to_item_kind(artifact.kind);
    let already_imported = already_imported(kind, &source_scope, &artifact.suggested_name);

    DetectedItem {
        source_agent,
        source_scope,
        kind,
        source_path: artifact.source_path,
        suggested_name: artifact.suggested_name,
        already_imported,
        fidelity_warnings: artifact
            .warnings
            .into_iter()
            .map(to_fidelity_warning)
            .collect(),
        preview: ItemPreview {
            summary: artifact.preview.summary,
            frontmatter: artifact.preview.frontmatter,
            size_bytes: artifact.preview.size_bytes,
        },
    }
}

fn to_source_agent(source_agent: ArtifactSourceAgent) -> SourceAgent {
    match source_agent {
        ArtifactSourceAgent::CursorIde => SourceAgent::CursorIde,
        ArtifactSourceAgent::ClaudeCode => SourceAgent::ClaudeCode,
        ArtifactSourceAgent::Codex => SourceAgent::Codex,
        ArtifactSourceAgent::GeminiCli => SourceAgent::GeminiCli,
        ArtifactSourceAgent::Copilot => SourceAgent::Copilot,
        ArtifactSourceAgent::Kiro => SourceAgent::Kiro,
    }
}

fn to_source_scope(source_scope: ArtifactSourceScope) -> SourceScope {
    match source_scope {
        ArtifactSourceScope::UserGlobal => SourceScope::UserGlobal,
        ArtifactSourceScope::WorkspaceLocal { repo_path } => {
            SourceScope::WorkspaceLocal { repo_path }
        }
    }
}

fn to_item_kind(kind: ArtifactKind) -> ItemKind {
    match kind {
        ArtifactKind::Policy => ItemKind::Policy,
        ArtifactKind::Skill => ItemKind::Skill,
        ArtifactKind::Mcp => ItemKind::Mcp,
        ArtifactKind::AgentDefinition => ItemKind::AgentDefinition,
    }
}

fn to_fidelity_warning(warning: ArtifactWarning) -> FidelityWarning {
    match warning {
        ArtifactWarning::UnmappedField { field } => FidelityWarning::UnmappedField { field },
        ArtifactWarning::FrontmatterParseError { detail } => {
            FidelityWarning::FrontmatterParseError { detail }
        }
        ArtifactWarning::LargeBundle { bytes } => FidelityWarning::LargeBundle { bytes },
        ArtifactWarning::ReadonlyDeclared => FidelityWarning::ReadonlyDowngraded {
            excluded_tools: readonly_excluded_tool_names(),
        },
    }
}

fn already_imported(kind: ItemKind, scope: &SourceScope, suggested_name: &str) -> bool {
    match kind {
        ItemKind::Policy => {
            let (source, workspace_path) = policy_source_for_scope(scope);
            orgii_policy_exists(source, workspace_path.as_deref(), suggested_name)
        }
        ItemKind::Skill => orgii_skill_exists(target_repo_path(scope).as_deref(), suggested_name),
        ItemKind::Mcp => orgii_mcp_exists(target_repo_path(scope).as_deref(), suggested_name),
        ItemKind::AgentDefinition => orgii_agent_definition_exists(suggested_name),
    }
}

fn policy_source_for_scope(scope: &SourceScope) -> (PolicySource, Option<PathBuf>) {
    match scope {
        SourceScope::WorkspaceLocal { repo_path } => {
            (PolicySource::Workspace, Some(repo_path.clone()))
        }
        SourceScope::UserGlobal => (PolicySource::Personal, None),
    }
}

fn target_repo_path(scope: &SourceScope) -> Option<PathBuf> {
    match scope {
        SourceScope::WorkspaceLocal { repo_path } => Some(repo_path.clone()),
        SourceScope::UserGlobal => None,
    }
}

fn orgii_policy_exists(source: PolicySource, workspace_path: Option<&Path>, name: &str) -> bool {
    let Ok(dir) = policies_dir_for_source(source, workspace_path) else {
        return false;
    };
    dir.join(format!("{name}.md")).exists() || dir.join(format!("{name}.mdc")).exists()
}

fn orgii_skill_exists(target_repo_path: Option<&Path>, name: &str) -> bool {
    let root = match target_repo_path {
        Some(repo_path) => repo_path.join(".orgii").join("skills"),
        None => app_paths::global_skills_dir(),
    };
    root.join(name).join("SKILL.md").exists()
}

fn orgii_mcp_exists(target_repo_path: Option<&Path>, name: &str) -> bool {
    let path = match target_repo_path {
        Some(repo_path) => workspace_config_path(repo_path),
        None => global_config_path(),
    };
    let Ok(config) = McpConfigFile::load_from(&path) else {
        return false;
    };
    config.mcp_servers.contains_key(name)
}

fn orgii_agent_definition_exists(name: &str) -> bool {
    let path = app_paths::agent_definitions();
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    let Some(arr) = value.as_array() else {
        return false;
    };
    arr.iter()
        .any(|entry| entry.get("id").and_then(|value| value.as_str()) == Some(name))
}

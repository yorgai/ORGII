//! Tauri Commands for Component Index
//!
//! Provides commands for:
//! - `index_repo`: Index all components in a repository
//! - `ui_index_lookup_component`: Look up component source locations
//! - `update_file_index`: Incrementally update index for a single file
//! - `ui_index_clear`: Clear index for a repository
//! - `ui_index_extract_props`: Lazy prop extraction for a single component

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;
use std::time::Instant;

use tauri::State;

use super::indexer::UiIndexer;
use super::parser::{
    PropsExtractor, TokenDefinitionExtractor, TokenDefinitionsResult, TokenExtractionResult,
    TokenExtractor,
};
use super::types::{ComponentDetails, ComponentKind, ComponentLocation, UiIndex, UiIndexStats};

/// State for managing component indexes across repositories
pub struct UiIndexState {
    /// Map: repo_path → UiIndex
    pub indexes: RwLock<HashMap<PathBuf, UiIndex>>,
}

impl UiIndexState {
    /// Create a new empty state
    pub fn new() -> Self {
        Self {
            indexes: RwLock::new(HashMap::new()),
        }
    }
}

impl Default for UiIndexState {
    fn default() -> Self {
        Self::new()
    }
}

/// Index all components in a repository
///
/// # Arguments
/// * `repo_path` - Absolute path to the repository root
///
/// # Returns
/// Statistics about the indexing operation
#[tauri::command]
pub async fn ui_index_build_repo(
    repo_path: String,
    state: State<'_, UiIndexState>,
) -> Result<UiIndexStats, String> {
    let path = PathBuf::from(&repo_path);

    if !path.exists() {
        return Err(format!("Repository path does not exist: {}", repo_path));
    }

    let start = Instant::now();

    // Run indexing in blocking task to not block async runtime
    let index = tokio::task::spawn_blocking(move || {
        let indexer = UiIndexer::new();
        indexer.index_directory(&path)
    })
    .await
    .map_err(|e| format!("Indexing task failed: {}", e))??;

    let elapsed_ms = start.elapsed().as_millis() as u64;
    let stats = UiIndexer::get_stats(&index, elapsed_ms);

    // Store index
    let path = PathBuf::from(&repo_path);
    state.indexes.write().unwrap().insert(path, index);

    log::info!(
        "[UiIndexer] Indexed repo: {} components in {} files ({}ms)",
        stats.total_components,
        stats.total_files,
        stats.index_time_ms
    );

    Ok(stats)
}

/// Look up a component by name
///
/// # Arguments
/// * `repo_path` - Repository path where the index was created
/// * `component_name` - Name of the component to look up (case-insensitive)
///
/// # Returns
/// List of source locations where the component is defined or used
#[tauri::command]
pub async fn ui_index_lookup_component(
    repo_path: String,
    component_name: String,
    state: State<'_, UiIndexState>,
) -> Result<Vec<ComponentLocation>, String> {
    let path = PathBuf::from(&repo_path);
    let indexes = state.indexes.read().unwrap();

    let index = indexes
        .get(&path)
        .ok_or_else(|| format!("Repository not indexed: {}", repo_path))?;

    let results = index.lookup_prioritized(&component_name);

    log::debug!(
        "[UiIndexer] Lookup '{}': {} results",
        component_name,
        results.len()
    );

    Ok(results)
}

/// Update index for a single file (incremental)
///
/// # Arguments
/// * `repo_path` - Repository path
/// * `file_path` - Path to the file that changed
#[tauri::command]
pub async fn ui_index_update_file(
    repo_path: String,
    file_path: String,
    state: State<'_, UiIndexState>,
) -> Result<(), String> {
    let repo = PathBuf::from(&repo_path);
    let file = PathBuf::from(&file_path);

    let mut indexes = state.indexes.write().unwrap();
    let index = indexes
        .get_mut(&repo)
        .ok_or_else(|| format!("Repository not indexed: {}", repo_path))?;

    let indexer = UiIndexer::new();
    indexer.index_file(index, &file)?;

    log::debug!("[UiIndexer] Updated file: {}", file_path);

    Ok(())
}

/// Clear index for a repository
///
/// # Arguments
/// * `repo_path` - Repository path to clear
#[tauri::command]
pub async fn ui_index_clear(
    repo_path: String,
    state: State<'_, UiIndexState>,
) -> Result<(), String> {
    let path = PathBuf::from(&repo_path);
    state.indexes.write().unwrap().remove(&path);

    log::info!("[UiIndexer] Cleared index for: {}", repo_path);

    Ok(())
}

/// Check if a repository is indexed
///
/// # Arguments
/// * `repo_path` - Repository path to check
#[tauri::command]
pub async fn ui_index_is_repo_indexed(
    repo_path: String,
    state: State<'_, UiIndexState>,
) -> Result<bool, String> {
    let path = PathBuf::from(&repo_path);
    let indexes = state.indexes.read().unwrap();
    Ok(indexes.contains_key(&path))
}

/// Get index statistics for a repository
///
/// # Arguments
/// * `repo_path` - Repository path
#[tauri::command]
pub async fn ui_index_get_stats(
    repo_path: String,
    state: State<'_, UiIndexState>,
) -> Result<Option<UiIndexStats>, String> {
    let path = PathBuf::from(&repo_path);
    let indexes = state.indexes.read().unwrap();

    Ok(indexes.get(&path).map(|index| {
        let mut stats = index.stats();
        stats.index_time_ms = 0; // Not applicable for cached stats
        stats
    }))
}

/// Extract props for a single component (lazy, on-demand)
///
/// This is called when user selects a component to add/preview.
/// Results should be cached by the frontend after first extraction.
///
/// # Arguments
/// * `file_path` - Absolute path to the component file
/// * `component_name` - Name of the component
/// * `line` - Line number where the component is defined
/// * `kind` - Component kind (function_def, arrow_def, class_def)
///
/// # Returns
/// ComponentDetails with extracted props
#[tauri::command]
pub async fn ui_index_extract_props(
    file_path: String,
    component_name: String,
    line: u32,
    kind: ComponentKind,
) -> Result<ComponentDetails, String> {
    let path = PathBuf::from(&file_path);
    let start = Instant::now();

    // Read file content
    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;

    // Clone values for the closure
    let name_for_closure = component_name.clone();
    let kind_for_closure = kind.clone();

    // Run extraction in blocking task (tree-sitter parsing)
    let result = tokio::task::spawn_blocking(move || {
        let mut extractor = PropsExtractor::new()?;
        Ok::<_, String>(extractor.extract_props(
            &path,
            &content,
            &name_for_closure,
            line,
            &kind_for_closure,
        ))
    })
    .await
    .map_err(|e| format!("Extraction task failed: {}", e))??;

    let elapsed_ms = start.elapsed().as_millis() as u64;

    log::debug!(
        "[UiIndexer] Extracted {} props for {} in {}ms",
        result.props.len(),
        component_name,
        elapsed_ms
    );

    Ok(ComponentDetails {
        name: component_name,
        file: PathBuf::from(&file_path),
        line,
        kind,
        props: result.props,
        props_type_name: result.props_type_name,
        description: result.description,
        extraction_time_ms: elapsed_ms,
    })
}

/// List all components in a repository (definitions only)
///
/// Returns a flat list of all component definitions for the catalog view.
/// This uses the existing index and is very fast.
///
/// # Arguments
/// * `repo_path` - Repository path
///
/// # Returns
/// List of component locations (definitions only, no usages)
#[tauri::command]
pub async fn ui_index_list_components(
    repo_path: String,
    state: State<'_, UiIndexState>,
) -> Result<Vec<(String, ComponentLocation)>, String> {
    let path = PathBuf::from(&repo_path);
    let indexes = state.indexes.read().unwrap();

    let index = indexes
        .get(&path)
        .ok_or_else(|| format!("Repository not indexed: {}", repo_path))?;

    let mut definitions: Vec<(String, ComponentLocation)> = Vec::new();

    for (name, locations) in &index.components {
        for loc in locations {
            if loc.kind.is_definition() {
                // Use the original case from the file path for display
                let display_name = capitalize_component_name(name);
                definitions.push((display_name, loc.clone()));
            }
        }
    }

    // Sort by file path, then by line number
    definitions.sort_by(|a, b| {
        let file_cmp = a.1.file.cmp(&b.1.file);
        if file_cmp == std::cmp::Ordering::Equal {
            a.1.line.cmp(&b.1.line)
        } else {
            file_cmp
        }
    });

    log::debug!(
        "[UiIndexer] Listed {} component definitions",
        definitions.len()
    );

    Ok(definitions)
}

/// Capitalize component name (lowercase from index → PascalCase display)
fn capitalize_component_name(name: &str) -> String {
    let mut chars = name.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

// ============================================
// Story Extraction Commands
// ============================================

use super::parser::{StoryExtractor, StoryFileInfo};

/// List all story files in a repository
///
/// Scans for .orgii.tsx and .orgii.ts files.
///
/// # Arguments
/// * `repo_path` - Repository path
///
/// # Returns
/// List of story file paths
#[tauri::command]
pub async fn list_story_files(repo_path: String) -> Result<Vec<String>, String> {
    let path = PathBuf::from(&repo_path);

    if !path.exists() {
        return Err(format!("Repository path does not exist: {}", repo_path));
    }

    let files = tokio::task::spawn_blocking(move || {
        let mut story_files = Vec::new();
        collect_story_files(&path, &mut story_files);
        story_files
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?;

    log::info!("[UiIndexer] Found {} story files", files.len());

    Ok(files)
}

/// Recursively collect story files
fn collect_story_files(dir: &std::path::Path, files: &mut Vec<String>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();

            // Skip common non-source directories
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with('.')
                    || name == "node_modules"
                    || name == "dist"
                    || name == "build"
                {
                    continue;
                }
            }

            if path.is_dir() {
                collect_story_files(&path, files);
            } else if StoryExtractor::is_story_file(&path) {
                files.push(path.to_string_lossy().to_string());
            }
        }
    }
}

/// Extract stories from a specific file
///
/// Parses a .orgii.tsx file and returns the meta + stories.
///
/// # Arguments
/// * `file_path` - Absolute path to the story file
///
/// # Returns
/// StoryFileInfo with meta and stories
#[tauri::command]
pub async fn extract_stories(file_path: String) -> Result<StoryFileInfo, String> {
    let path = PathBuf::from(&file_path);
    let start = Instant::now();

    // Read file content
    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;

    // Run extraction in blocking task
    let result = tokio::task::spawn_blocking(move || {
        let mut extractor = StoryExtractor::new()?;
        extractor.extract_stories(&path, &content)
    })
    .await
    .map_err(|e| format!("Extraction task failed: {}", e))??;

    let elapsed_ms = start.elapsed().as_millis();

    log::info!(
        "[UiIndexer] Extracted {} stories from {} in {}ms",
        result.stories.len(),
        file_path,
        elapsed_ms
    );

    Ok(result)
}

/// Get stories for a specific component
///
/// Finds the .orgii.tsx file for a component and extracts its stories.
///
/// # Arguments
/// * `component_file` - Path to the component file (e.g., src/components/Button/index.tsx)
///
/// # Returns
/// StoryFileInfo if a story file exists, None otherwise
#[tauri::command]
pub async fn ui_index_get_component_stories(
    component_file: String,
) -> Result<Option<StoryFileInfo>, String> {
    let component_path = PathBuf::from(&component_file);

    // Look for story file in the same directory
    let parent = component_path.parent().ok_or("Invalid file path")?;

    // Try different naming patterns:
    // - Button.orgii.tsx (same name as file)
    // - index.orgii.tsx (if component is index.tsx)
    // - ComponentName.orgii.tsx (based on directory name)

    let stem = component_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("index");

    let dir_name = parent
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Component");

    let candidates = [
        parent.join(format!("{}.orgii.tsx", stem)),
        parent.join(format!("{}.orgii.ts", stem)),
        parent.join(format!("{}.orgii.tsx", dir_name)),
        parent.join(format!("{}.orgii.ts", dir_name)),
    ];

    for candidate in candidates {
        if candidate.exists() {
            let content = fs::read_to_string(&candidate)
                .map_err(|e| format!("Failed to read file: {}", e))?;

            let path = candidate.clone();
            let result = tokio::task::spawn_blocking(move || {
                let mut extractor = StoryExtractor::new()?;
                extractor.extract_stories(&path, &content)
            })
            .await
            .map_err(|e| format!("Extraction task failed: {}", e))??;

            return Ok(Some(result));
        }
    }

    Ok(None)
}

// ============================================
// Token Extraction Commands
// ============================================

/// Extract CSS variable tokens from a component file
///
/// Scans the file for CSS variable usage patterns like var(--token-name)
/// and returns a list of required tokens.
#[tauri::command]
pub async fn extract_tokens(file_path: String) -> Result<TokenExtractionResult, String> {
    let path = PathBuf::from(&file_path);

    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let extractor = TokenExtractor::new();
    extractor.extract_from_file(&path)
}

/// Extract CSS variable tokens from multiple files
///
/// Useful for scanning a component and its related files (e.g., component + stories)
#[tauri::command]
pub async fn extract_tokens_from_files(
    file_paths: Vec<String>,
) -> Result<TokenExtractionResult, String> {
    let paths: Vec<PathBuf> = file_paths.iter().map(PathBuf::from).collect();
    let path_refs: Vec<&std::path::Path> = paths.iter().map(|p| p.as_path()).collect();

    let extractor = TokenExtractor::new();
    Ok(extractor.extract_from_files(&path_refs))
}

// ============================================
// Global Token Commands
// ============================================

/// Scan a repository for CSS variable definitions
///
/// Scans CSS/SCSS files in the repo to find all defined design tokens.
/// Returns token names with their values and source files.
///
/// # Arguments
/// - `repo_path`: Path to the repository root
/// - `max_depth`: Maximum directory depth to scan (default: 5)
#[tauri::command]
pub async fn scan_global_tokens(
    repo_path: String,
    max_depth: Option<usize>,
) -> Result<TokenDefinitionsResult, String> {
    let path = PathBuf::from(&repo_path);

    if !path.exists() {
        return Err(format!("Repository path not found: {}", repo_path));
    }

    let depth = max_depth.unwrap_or(5);
    let extractor = TokenDefinitionExtractor::new();

    println!("[Global Tokens] Scanning {} (depth: {})", repo_path, depth);

    let result = extractor.scan_directory(&path, depth);

    println!("[Global Tokens] Found {} tokens", result.tokens.len());

    Ok(result)
}

/// Extract token definitions from specific CSS files
///
/// # Arguments
/// - `file_paths`: List of CSS/SCSS files to extract from
#[tauri::command]
pub async fn extract_token_definitions(
    file_paths: Vec<String>,
) -> Result<TokenDefinitionsResult, String> {
    let extractor = TokenDefinitionExtractor::new();
    let mut all_tokens = Vec::new();

    for file_path in file_paths {
        let path = PathBuf::from(&file_path);
        if path.exists() {
            if let Ok(tokens) = extractor.extract_from_file(&path) {
                all_tokens.extend(tokens);
            }
        }
    }

    Ok(TokenDefinitionsResult { tokens: all_tokens })
}

//! Symbol search and code intelligence commands (symbols, go-to-definition, find-references).

use std::collections::HashMap;
use std::path::PathBuf;

use tracing::{debug, info, warn};

use super::super::intelligence::{TreeSitterFile, ALL_LANGUAGES};
use super::helpers::{collect_files, read_file_content};
use super::types::{CodeLocation, CodeSymbolInfo, SearchFilters, SymbolSearchResult};

#[tauri::command]
pub async fn search_symbols(
    query: String,
    repo_paths: Vec<String>,
    symbol_types: Option<Vec<String>>,
) -> Result<Vec<SymbolSearchResult>, String> {
    tokio::task::spawn_blocking(move || search_symbols_inner(query, repo_paths, symbol_types))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

fn search_symbols_inner(
    query: String,
    repo_paths: Vec<String>,
    symbol_types: Option<Vec<String>>,
) -> Result<Vec<SymbolSearchResult>, String> {
    use std::time::Instant;
    let start = Instant::now();

    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for repo_path in repo_paths {
        let root = PathBuf::from(&repo_path);
        if !root.exists() {
            continue;
        }

        let filters = SearchFilters {
            file_extensions: None,
            exclude_dirs: None,
            case_sensitive: None,
            whole_word: None,
            use_regex: None,
            max_results: None,
        };

        let files = collect_files(&root, &filters);

        for file_path in files {
            if let Some(content) = read_file_content(&file_path) {
                if let Some(ext) = file_path.extension().and_then(|e| e.to_str()) {
                    if let Ok(ts_file) =
                        TreeSitterFile::try_build_from_extension(content.as_bytes(), ext)
                    {
                        if let Ok(scope_graph) = ts_file.scope_graph() {
                            let symbols = scope_graph.symbols();

                            let matching_symbols: Vec<CodeSymbolInfo> = symbols
                                .into_iter()
                                .filter(|s| {
                                    let name_range = s.range.start.byte..s.range.end.byte;
                                    if let Some(name) = content.get(name_range) {
                                        let matches_query =
                                            name.to_lowercase().contains(&query_lower);
                                        let matches_type =
                                            symbol_types.as_ref().is_none_or(|types| {
                                                types.iter().any(|t| {
                                                    t.to_lowercase() == s.kind.to_lowercase()
                                                })
                                            });
                                        matches_query && matches_type
                                    } else {
                                        false
                                    }
                                })
                                .filter_map(|s| {
                                    let name_range = s.range.start.byte..s.range.end.byte;
                                    content.get(name_range).map(|name| CodeSymbolInfo {
                                        name: name.to_string(),
                                        kind: s.kind,
                                        line: s.range.start.line + 1,
                                        column: s.range.start.column + 1,
                                        end_line: s.range.end.line + 1,
                                        end_column: s.range.end.column + 1,
                                    })
                                })
                                .collect();

                            if !matching_symbols.is_empty() {
                                results.push(SymbolSearchResult {
                                    file_path: file_path.to_string_lossy().to_string(),
                                    symbols: matching_symbols,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    let duration = start.elapsed();
    let total_symbols: usize = results.iter().map(|r| r.symbols.len()).sum();
    info!(
        symbols = total_symbols,
        files = results.len(),
        ?duration,
        "search::symbol: search complete"
    );

    Ok(results)
}

/// Extract all symbols from a file.
#[tauri::command]
pub fn get_file_symbols(file_path: String) -> Result<Vec<CodeSymbolInfo>, String> {
    let path = PathBuf::from(&file_path);

    debug!(file_path = %file_path, "search::symbol: parsing file");

    let content = std::fs::read_to_string(&path).map_err(|e| {
        warn!(file_path = %file_path, error = %e, "search::symbol: failed to read file");
        format!("Failed to read file: {}", e)
    })?;

    let ext = path.extension().and_then(|e| e.to_str()).ok_or_else(|| {
        warn!(file_path = %file_path, "search::symbol: unknown file extension");
        "Unknown file extension".to_string()
    })?;

    debug!(ext = %ext, size = content.len(), "search::symbol: file metadata");

    let ts_file =
        TreeSitterFile::try_build_from_extension(content.as_bytes(), ext).map_err(|e| {
            warn!(file_path = %file_path, error = ?e, "search::symbol: tree-sitter build failed");
            format!("Unsupported language or parse error: {:?}", e)
        })?;

    let scope_graph = ts_file.scope_graph().map_err(|e| {
        warn!(file_path = %file_path, error = ?e, "search::symbol: scope graph failed");
        format!("Failed to build scope graph: {:?}", e)
    })?;

    let symbols = scope_graph.symbols();

    let result: Vec<CodeSymbolInfo> = symbols
        .into_iter()
        .filter_map(|s| {
            let name_range = s.range.start.byte..s.range.end.byte;
            content.get(name_range).map(|name| CodeSymbolInfo {
                name: name.to_string(),
                kind: s.kind,
                line: s.range.start.line + 1,
                column: s.range.start.column + 1,
                end_line: s.range.end.line + 1,
                end_column: s.range.end.column + 1,
            })
        })
        .collect();

    debug!(symbols = result.len(), "search::symbol: symbols extracted");

    Ok(result)
}

/// Go to definition — find where a symbol is defined.
#[tauri::command]
pub fn goto_definition(
    file_path: String,
    line: usize,
    column: usize,
) -> Result<Vec<CodeLocation>, String> {
    let path = PathBuf::from(&file_path);

    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .ok_or("Unknown file extension")?;

    let ts_file = TreeSitterFile::try_build_from_extension(content.as_bytes(), ext)
        .map_err(|_| "Unsupported language or parse error")?;

    let scope_graph = ts_file
        .scope_graph()
        .map_err(|_| "Failed to build scope graph")?;

    let target_line = line.saturating_sub(1);
    let target_column = column.saturating_sub(1);

    if let Some(node_idx) = scope_graph.node_by_position(target_line, target_column) {
        let definitions: Vec<CodeLocation> = scope_graph
            .definitions(node_idx)
            .map(|def_idx| {
                let def_node = scope_graph.get_node(def_idx).unwrap();
                let range = def_node.range();
                let text = content
                    .get(range.start.byte..range.end.byte)
                    .unwrap_or("")
                    .to_string();

                CodeLocation {
                    file_path: file_path.clone(),
                    line: range.start.line + 1,
                    column: range.start.column + 1,
                    end_line: range.end.line + 1,
                    end_column: range.end.column + 1,
                    text,
                }
            })
            .collect();

        return Ok(definitions);
    }

    Ok(vec![])
}

/// Find references — find all places where a symbol is used.
#[tauri::command]
pub fn find_references(
    file_path: String,
    line: usize,
    column: usize,
) -> Result<Vec<CodeLocation>, String> {
    let path = PathBuf::from(&file_path);

    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .ok_or("Unknown file extension")?;

    let ts_file = TreeSitterFile::try_build_from_extension(content.as_bytes(), ext)
        .map_err(|_| "Unsupported language or parse error")?;

    let scope_graph = ts_file
        .scope_graph()
        .map_err(|_| "Failed to build scope graph")?;

    let target_line = line.saturating_sub(1);
    let target_column = column.saturating_sub(1);

    if let Some(node_idx) = scope_graph.node_by_position(target_line, target_column) {
        let definition_idx = if scope_graph.is_definition(node_idx) {
            Some(node_idx)
        } else {
            scope_graph.definitions(node_idx).next()
        };

        if let Some(def_idx) = definition_idx {
            let references: Vec<CodeLocation> = scope_graph
                .references(def_idx)
                .map(|ref_idx| {
                    let ref_node = scope_graph.get_node(ref_idx).unwrap();
                    let range = ref_node.range();
                    let text = content
                        .get(range.start.byte..range.end.byte)
                        .unwrap_or("")
                        .to_string();

                    CodeLocation {
                        file_path: file_path.clone(),
                        line: range.start.line + 1,
                        column: range.start.column + 1,
                        end_line: range.end.line + 1,
                        end_column: range.end.column + 1,
                        text,
                    }
                })
                .collect();

            return Ok(references);
        }
    }

    Ok(vec![])
}

/// Get supported languages.
#[tauri::command]
pub fn get_supported_languages() -> Vec<HashMap<String, Vec<String>>> {
    ALL_LANGUAGES
        .iter()
        .map(|lang| {
            let mut info = HashMap::new();
            info.insert(
                "language_ids".to_string(),
                lang.language_ids.iter().map(|s| s.to_string()).collect(),
            );
            info.insert(
                "extensions".to_string(),
                lang.file_extensions.iter().map(|s| s.to_string()).collect(),
            );
            info
        })
        .collect()
}

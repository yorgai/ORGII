//! HTTP route handlers for code symbol lookup.
use axum::{extract::Query, http::StatusCode, Json};
use serde::Deserialize;

use crate::error::ApiError;
use crate::types::*;

/// Search for code symbols (functions, classes, etc.)
#[utoipa::path(
    get,
    path = "/api/search/code/symbols",
    params(
        ("repo_path" = String, Query, description = "Repository path to search"),
        ("query" = Option<String>, Query, description = "Symbol name query (fuzzy)"),
        ("kind" = Option<String>, Query, description = "Filter by symbol kind"),
        ("limit" = Option<usize>, Query, description = "Maximum results"),
    ),
    responses(
        (status = 200, description = "Search completed", body = SymbolSearchResponse),
        (status = 400, description = "Search failed", body = ApiError)
    ),
    tag = "code-search"
)]
pub async fn search_symbols(
    Query(params): Query<SymbolSearchParams>,
) -> Result<Json<SymbolSearchResponse>, (StatusCode, Json<ApiError>)> {
    use search::code::commands::search_symbols as search_fn;

    let repo_paths = vec![params.repo_path];
    let symbol_types = params.kind.map(|kind| vec![kind]);
    let query = params.query.unwrap_or_default();

    match search_fn(query, repo_paths, symbol_types).await {
        Ok(results) => {
            let mut symbols = results
                .into_iter()
                .flat_map(|result| {
                    result.symbols.into_iter().map(move |symbol| ApiSymbolInfo {
                        name: symbol.name,
                        kind: symbol.kind,
                        file_path: result.file_path.clone(),
                        line: symbol.line,
                        column: symbol.column,
                        end_line: symbol.end_line,
                        end_column: symbol.end_column,
                    })
                })
                .collect::<Vec<_>>();

            if let Some(limit) = params.limit {
                symbols.truncate(limit);
            }

            let total = symbols.len();

            Ok(Json(SymbolSearchResponse { symbols, total }))
        }
        Err(error) => Err((StatusCode::BAD_REQUEST, Json(ApiError::new(error)))),
    }
}

/// Get symbols for a single file using tree-sitter.
#[utoipa::path(
    get,
    path = "/api/search/code/file-symbols",
    params(
        ("file_path" = String, Query, description = "Absolute path to the file"),
    ),
    responses(
        (status = 200, description = "Symbols parsed successfully", body = FileSymbolsResponse),
        (status = 400, description = "Parse failed", body = ApiError),
        (status = 404, description = "File not found", body = ApiError),
        (status = 415, description = "Unsupported language", body = ApiError)
    ),
    tag = "code-search"
)]
pub async fn get_file_symbols(
    Query(params): Query<FileSymbolsParams>,
) -> Result<Json<FileSymbolsResponse>, (StatusCode, Json<ApiError>)> {
    use search::code::intelligence::TreeSitterFile;
    use std::path::Path;

    let start = std::time::Instant::now();
    let file_path = params.file_path;

    let content = std::fs::read(&file_path).map_err(|error| {
        (
            StatusCode::NOT_FOUND,
            Json(ApiError::new(format!("File not found: {error}"))),
        )
    })?;

    let extension = Path::new(&file_path)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_string();

    let tree_sitter_file =
        TreeSitterFile::try_build_from_extension(&content, &extension).map_err(|error| {
            (
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                Json(ApiError::new(format!(
                    "Unsupported language or parse error: {error:?}"
                ))),
            )
        })?;

    let scope_graph = tree_sitter_file.scope_graph().map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError::new(format!(
                "Failed to build scope graph: {error:?}"
            ))),
        )
    })?;

    let symbols = scope_graph
        .symbols()
        .into_iter()
        .map(|symbol| {
            let name = if symbol.range.start.byte < content.len()
                && symbol.range.end.byte <= content.len()
            {
                String::from_utf8_lossy(&content[symbol.range.start.byte..symbol.range.end.byte])
                    .to_string()
            } else {
                "unknown".to_string()
            };

            FileSymbol {
                name,
                kind: symbol.kind,
                line: symbol.range.start.line + 1,
                column: symbol.range.start.column + 1,
                end_line: symbol.range.end.line + 1,
                end_column: symbol.range.end.column + 1,
                children: vec![],
            }
        })
        .collect();

    let parse_time_ms = start.elapsed().as_millis() as u64;

    Ok(Json(FileSymbolsResponse {
        file_path,
        language: extension,
        symbols,
        parse_time_ms,
    }))
}

#[derive(Debug, Deserialize)]
pub struct SymbolSearchParams {
    pub repo_path: String,
    pub query: Option<String>,
    pub kind: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct FileSymbolsParams {
    pub file_path: String,
}

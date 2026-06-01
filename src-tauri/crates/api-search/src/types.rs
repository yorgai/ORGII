//! Request/response types for the search HTTP API.
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ApiInfo {
    pub name: String,
    pub version: String,
    pub status: String,
    pub endpoints: EndpointsList,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct EndpointsList {
    pub swagger_ui: String,
    pub openapi_spec: String,
    pub file_search: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FileSearchQuery {
    pub query: String,
    pub root_path: String,
    pub max_results: Option<usize>,
    pub file_extensions: Option<Vec<String>>,
    pub exclude_dirs: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FileSearchResult {
    pub path: String,
    #[serde(rename = "type")]
    pub file_type: String,
    pub score: i64,
    pub filename: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FileSearchResponse {
    pub files: Vec<FileSearchResult>,
    pub folders: Vec<FileSearchResult>,
    pub total_indexed: usize,
    pub search_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FileIndexRequest {
    pub root_path: String,
    pub exclude_dirs: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FileIndexResponse {
    pub count: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SymbolSearchQuery {
    pub repo_path: String,
    pub query: Option<String>,
    pub kind: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ApiSymbolInfo {
    pub name: String,
    pub kind: String,
    pub file_path: String,
    pub line: usize,
    pub column: usize,
    pub end_line: usize,
    pub end_column: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SymbolSearchResponse {
    pub symbols: Vec<ApiSymbolInfo>,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FileSymbolsQuery {
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FileSymbol {
    pub name: String,
    pub kind: String,
    pub line: usize,
    pub column: usize,
    pub end_line: usize,
    pub end_column: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[schema(no_recursion)]
    pub children: Vec<FileSymbol>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FileSymbolsResponse {
    pub file_path: String,
    pub language: String,
    pub symbols: Vec<FileSymbol>,
    pub parse_time_ms: u64,
}

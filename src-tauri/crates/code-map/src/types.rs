use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const SCHEMA_VERSION: i64 = 2;
pub const EXTRACTOR_VERSION: &str = "code-map-v2";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CodeMapStatusKind {
    NotIndexed,
    Indexing,
    Ready,
    Stale,
    Failed,
    Cancelled,
}

impl CodeMapStatusKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotIndexed => "not_indexed",
            Self::Indexing => "indexing",
            Self::Ready => "ready",
            Self::Stale => "stale",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CodeMapIndexPhase {
    Queued,
    Scanning,
    Extracting,
    Storing,
    Resolving,
    Complete,
    Failed,
    Cancelled,
}

impl CodeMapIndexPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Scanning => "scanning",
            Self::Extracting => "extracting",
            Self::Storing => "storing",
            Self::Resolving => "resolving",
            Self::Complete => "complete",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CodeMapConfidence {
    Exact,
    High,
    Medium,
    Low,
    Heuristic,
}

impl CodeMapConfidence {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Exact => "exact",
            Self::High => "high",
            Self::Medium => "medium",
            Self::Low => "low",
            Self::Heuristic => "heuristic",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CodeMapExtractionMethod {
    FileSystem,
    TreeSitter,
    Regex,
    Resolver,
}

impl CodeMapExtractionMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::FileSystem => "file_system",
            Self::TreeSitter => "tree_sitter",
            Self::Regex => "regex",
            Self::Resolver => "resolver",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CodeMapResolutionStatus {
    NotApplicable,
    Unresolved,
    Resolved,
    Ambiguous,
}

impl CodeMapResolutionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotApplicable => "not_applicable",
            Self::Unresolved => "unresolved",
            Self::Resolved => "resolved",
            Self::Ambiguous => "ambiguous",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CodeMapIndexMode {
    Auto,
    Incremental,
    Full,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CodeMapFreshnessKind {
    Fresh,
    Stale,
    Unknown,
}

impl CodeMapFreshnessKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Fresh => "fresh",
            Self::Stale => "stale",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub enum CodeMapLanguage {
    #[serde(rename = "typescript")]
    TypeScript,
    #[serde(rename = "tsx")]
    Tsx,
    #[serde(rename = "javascript")]
    JavaScript,
    #[serde(rename = "jsx")]
    Jsx,
    #[serde(rename = "python")]
    Python,
    #[serde(rename = "go")]
    Go,
    #[serde(rename = "rust")]
    Rust,
    #[serde(rename = "java")]
    Java,
    #[serde(rename = "c")]
    C,
    #[serde(rename = "cpp")]
    Cpp,
    #[serde(rename = "csharp")]
    CSharp,
    #[serde(rename = "php")]
    Php,
    #[serde(rename = "ruby")]
    Ruby,
    #[serde(rename = "swift")]
    Swift,
    #[serde(rename = "kotlin")]
    Kotlin,
}

impl CodeMapLanguage {
    pub fn from_path(path: &std::path::Path) -> Option<Self> {
        let extension = path.extension()?.to_string_lossy().to_ascii_lowercase();
        match extension.as_str() {
            "ts" | "mts" | "cts" => Some(Self::TypeScript),
            "tsx" => Some(Self::Tsx),
            "js" | "mjs" | "cjs" | "xsjs" | "xsjslib" => Some(Self::JavaScript),
            "jsx" => Some(Self::Jsx),
            "py" | "pyw" => Some(Self::Python),
            "go" => Some(Self::Go),
            "rs" => Some(Self::Rust),
            "java" => Some(Self::Java),
            "c" => Some(Self::C),
            "h" => Some(Self::C),
            "cpp" | "cc" | "cxx" | "hpp" | "hxx" => Some(Self::Cpp),
            "cs" => Some(Self::CSharp),
            "php" | "module" | "install" | "theme" | "inc" => Some(Self::Php),
            "rb" | "rake" => Some(Self::Ruby),
            "swift" => Some(Self::Swift),
            "kt" | "kts" => Some(Self::Kotlin),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::TypeScript => "typescript",
            Self::Tsx => "tsx",
            Self::JavaScript => "javascript",
            Self::Jsx => "jsx",
            Self::Python => "python",
            Self::Go => "go",
            Self::Rust => "rust",
            Self::Java => "java",
            Self::C => "c",
            Self::Cpp => "cpp",
            Self::CSharp => "csharp",
            Self::Php => "php",
            Self::Ruby => "ruby",
            Self::Swift => "swift",
            Self::Kotlin => "kotlin",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CodeMapNodeKind {
    File,
    Module,
    Class,
    Struct,
    Interface,
    Trait,
    Function,
    Method,
    Property,
    Field,
    Variable,
    Constant,
    Enum,
    TypeAlias,
    Namespace,
    Import,
    Component,
}

impl CodeMapNodeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Module => "module",
            Self::Class => "class",
            Self::Struct => "struct",
            Self::Interface => "interface",
            Self::Trait => "trait",
            Self::Function => "function",
            Self::Method => "method",
            Self::Property => "property",
            Self::Field => "field",
            Self::Variable => "variable",
            Self::Constant => "constant",
            Self::Enum => "enum",
            Self::TypeAlias => "type_alias",
            Self::Namespace => "namespace",
            Self::Import => "import",
            Self::Component => "component",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CodeMapEdgeKind {
    Contains,
    Imports,
    Exports,
    References,
    Calls,
    Extends,
    Implements,
    TypeOf,
    Returns,
    Instantiates,
}

impl CodeMapEdgeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Contains => "contains",
            Self::Imports => "imports",
            Self::Exports => "exports",
            Self::References => "references",
            Self::Calls => "calls",
            Self::Extends => "extends",
            Self::Implements => "implements",
            Self::TypeOf => "type_of",
            Self::Returns => "returns",
            Self::Instantiates => "instantiates",
        }
    }

    pub fn is_semantic_dependency(self) -> bool {
        !matches!(self, Self::Contains)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CodeMapNode {
    pub id: String,
    pub kind: CodeMapNodeKind,
    pub name: String,
    pub qualified_name: String,
    pub file_path: String,
    pub language: CodeMapLanguage,
    pub start_line: u32,
    pub end_line: u32,
    pub start_column: u32,
    pub end_column: u32,
    pub signature: Option<String>,
    pub updated_at: i64,
    pub confidence: CodeMapConfidence,
    pub extraction_method: CodeMapExtractionMethod,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CodeMapEdge {
    pub source: String,
    pub target: String,
    pub kind: CodeMapEdgeKind,
    pub line: Option<u32>,
    pub column: Option<u32>,
    pub provenance: Option<String>,
    pub confidence: CodeMapConfidence,
    pub resolution_status: CodeMapResolutionStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CodeMapUnresolvedRef {
    pub file_path: String,
    pub from_node_id: Option<String>,
    pub name: String,
    pub kind: CodeMapEdgeKind,
    pub language: CodeMapLanguage,
    pub line: u32,
    pub column: u32,
    pub candidates: Vec<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CodeMapFileRecord {
    pub path: String,
    pub content_hash: String,
    pub language: CodeMapLanguage,
    pub size: u64,
    pub modified_at: i64,
    pub indexed_at: i64,
    pub node_count: u32,
    pub errors: Vec<String>,
    pub stale: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CodeMapWorkspaceSummary {
    pub workspace_path: String,
    pub status: CodeMapStatusKind,
    pub files: u32,
    pub symbols: u32,
    pub relationships: u32,
    pub unresolved: u32,
    pub stale_files: u32,
    pub index_size_bytes: u64,
    pub freshness: CodeMapFreshnessKind,
    pub last_indexed_at: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CodeMapStatus {
    pub workspace_path: String,
    pub status: CodeMapStatusKind,
    pub files: u32,
    pub symbols: u32,
    pub relationships: u32,
    pub unresolved: u32,
    pub stale_files: u32,
    pub index_size_bytes: u64,
    pub freshness: CodeMapFreshnessKind,
    pub last_indexed_at: Option<i64>,
    pub error: Option<String>,
    pub progress: Option<CodeMapIndexProgress>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CodeMapIndexProgress {
    pub workspace_path: String,
    pub phase: CodeMapIndexPhase,
    pub files_processed: u32,
    pub files_total: u32,
    pub current_file: Option<String>,
    pub added_files: u32,
    pub modified_files: u32,
    pub deleted_files: u32,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CodeMapIndexRequest {
    pub workspace_path: PathBuf,
    pub force: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CodeMapAction {
    Status,
    Search,
    Node,
    Callers,
    Callees,
    Impact,
    Explore,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CodeMapQueryRequest {
    pub workspace_path: PathBuf,
    pub query: Option<String>,
    pub node_id: Option<String>,
    pub file_path: Option<PathBuf>,
    pub kind: Option<CodeMapNodeKind>,
    pub language: Option<CodeMapLanguage>,
    pub path_prefix: Option<String>,
    pub include_source: bool,
    pub include_relationships: bool,
    pub max_results: usize,
    pub max_depth: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CodeMapRelationship {
    pub edge: CodeMapEdge,
    pub node: CodeMapNode,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CodeMapSourceWindow {
    pub file_path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CodeMapNodeDetails {
    pub node: CodeMapNode,
    pub incoming: Vec<CodeMapRelationship>,
    pub outgoing: Vec<CodeMapRelationship>,
    pub source: Option<CodeMapSourceWindow>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CodeMapSearchResult {
    pub node: CodeMapNode,
    pub rank: f64,
    pub source: Option<CodeMapSourceWindow>,
    pub incoming_count: u32,
    pub outgoing_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CodeMapSearchResponse {
    pub workspace_path: String,
    pub query: String,
    pub results: Vec<CodeMapSearchResult>,
    pub unresolved_count: u32,
    pub stale_files: u32,
    pub truncated: bool,
}

#[derive(Debug, Clone)]
pub struct ExtractedFile {
    pub record: CodeMapFileRecord,
    pub nodes: Vec<CodeMapNode>,
    pub edges: Vec<CodeMapEdge>,
    pub unresolved_refs: Vec<CodeMapUnresolvedRef>,
}

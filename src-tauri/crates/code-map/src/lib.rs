use std::path::PathBuf;

pub mod commands;
mod db;
mod extract;
mod format;
mod indexer;
mod paths;
mod resolver;
mod service;
mod types;

#[derive(Debug, thiserror::Error)]
pub enum CodeMapError {
    #[error("failed to canonicalize path {path}: {source}")]
    PathCanonicalize {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to create directory {path}: {source}")]
    CreateDir {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("index for workspace {0} was cancelled")]
    Cancelled(String),
    #[error("index for workspace {0} is already running")]
    AlreadyIndexing(String),
    #[error("node not found: {0}")]
    NodeNotFound(String),
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("blocking task failed: {0}")]
    Join(String),
}

impl serde::Serialize for CodeMapError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, CodeMapError>;

pub use service::{
    cancel_index, clear_index, get_many_statuses, get_status, node_details, search, start_index,
    CodeMapService,
};
pub use types::{
    CodeMapAction, CodeMapConfidence, CodeMapEdge, CodeMapExtractionMethod, CodeMapFreshnessKind,
    CodeMapIndexMode, CodeMapIndexPhase, CodeMapIndexProgress, CodeMapIndexRequest,
    CodeMapLanguage, CodeMapNode, CodeMapNodeDetails, CodeMapNodeKind, CodeMapQueryRequest,
    CodeMapRelationship, CodeMapResolutionStatus, CodeMapSearchResponse, CodeMapSearchResult,
    CodeMapSourceWindow, CodeMapStatus, CodeMapStatusKind, CodeMapUnresolvedRef,
    CodeMapWorkspaceSummary,
};

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;

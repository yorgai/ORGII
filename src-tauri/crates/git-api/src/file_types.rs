//! Types for file-status HTTP API operations
//!
//! Used by `routes/file.rs` for VSCode-style on-tab-switch file verification.
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// ============================================
// Git File Status
// ============================================

/// Git file status information (from `git ls-files --stage`)
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct GitFileStatus {
    /// Whether the file is tracked in git
    pub is_tracked: bool,
    /// Whether the file is staged
    pub is_staged: bool,
    /// Git blob hash (if tracked)
    pub blob_hash: Option<String>,
    /// File modification time (milliseconds since UNIX epoch)
    pub mtime: u128,
    /// Git conflict stage (0=normal, 1=base, 2=ours, 3=theirs)
    pub conflict_stage: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct GitFileStatusResponse {
    pub success: bool,
    pub data: GitFileStatus,
}

// ============================================
// File Metadata
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FileMtimeResponse {
    pub success: bool,
    pub mtime: u128,
}

//! Merkle Tree for File Change Detection
//!
//! Provides efficient O(log n) directory-level change detection for
//! incremental indexing. Each file is hashed with blake3, and directory
//! hashes are computed from sorted child hashes. Comparing two trees
//! skips entire unchanged subtrees.

pub mod commands;
mod diff;
mod persistence;
mod tree;

pub use diff::{diff_trees, ChangeType, MerkleChange};
pub use tree::{MerkleNode, MerkleTree};

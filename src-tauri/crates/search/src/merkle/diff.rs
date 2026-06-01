//! Merkle tree diff algorithm.
//!
//! Compares two Merkle trees and returns the list of changed files.
//! Unchanged subtrees are skipped in O(1) via hash comparison.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::tree::MerkleNode;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ChangeType {
    Added,
    Modified,
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MerkleChange {
    pub path: String,
    pub change_type: ChangeType,
}

/// Diff two Merkle trees and return a list of changed files.
pub fn diff_trees(old: &MerkleNode, new: &MerkleNode) -> Vec<MerkleChange> {
    let mut changes = Vec::new();
    diff_nodes(old, new, &PathBuf::new(), &mut changes);
    changes
}

fn diff_nodes(old: &MerkleNode, new: &MerkleNode, prefix: &Path, changes: &mut Vec<MerkleChange>) {
    if old.hash() == new.hash() {
        return;
    }

    match (old, new) {
        (
            MerkleNode::Directory {
                children: old_children,
                ..
            },
            MerkleNode::Directory {
                children: new_children,
                ..
            },
        ) => {
            // Files/dirs in new but not in old -> Added
            for (name, new_node) in new_children {
                let child_path = prefix.join(name);
                match old_children.get(name) {
                    Some(old_node) => {
                        diff_nodes(old_node, new_node, &child_path, changes);
                    }
                    None => {
                        collect_all_files(new_node, &child_path, changes, ChangeType::Added);
                    }
                }
            }

            // Files/dirs in old but not in new -> Deleted
            for (name, old_node) in old_children {
                if !new_children.contains_key(name) {
                    let child_path = prefix.join(name);
                    collect_all_files(old_node, &child_path, changes, ChangeType::Deleted);
                }
            }
        }
        (MerkleNode::File { .. }, MerkleNode::File { .. }) => {
            changes.push(MerkleChange {
                path: prefix.to_string_lossy().to_string(),
                change_type: ChangeType::Modified,
            });
        }
        (MerkleNode::File { .. }, MerkleNode::Directory { .. }) => {
            changes.push(MerkleChange {
                path: prefix.to_string_lossy().to_string(),
                change_type: ChangeType::Deleted,
            });
            collect_all_files(new, prefix, changes, ChangeType::Added);
        }
        (MerkleNode::Directory { .. }, MerkleNode::File { .. }) => {
            collect_all_files(old, prefix, changes, ChangeType::Deleted);
            changes.push(MerkleChange {
                path: prefix.to_string_lossy().to_string(),
                change_type: ChangeType::Added,
            });
        }
    }
}

fn collect_all_files(
    node: &MerkleNode,
    prefix: &Path,
    changes: &mut Vec<MerkleChange>,
    change_type: ChangeType,
) {
    match node {
        MerkleNode::File { .. } => {
            changes.push(MerkleChange {
                path: prefix.to_string_lossy().to_string(),
                change_type,
            });
        }
        MerkleNode::Directory { children, .. } => {
            for (name, child) in children {
                let child_path = prefix.join(name);
                collect_all_files(child, &child_path, changes, change_type.clone());
            }
        }
    }
}

#[cfg(test)]
#[path = "tests/diff_tests.rs"]
mod tests;

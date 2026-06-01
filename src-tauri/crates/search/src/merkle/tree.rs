//! Merkle tree data structure and construction.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rayon::prelude::*;
use serde::{Deserialize, Serialize};

/// A node in the Merkle tree — either a file or a directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MerkleNode {
    File {
        hash: String,
        size: u64,
    },
    Directory {
        hash: String,
        children: BTreeMap<String, MerkleNode>,
    },
}

impl MerkleNode {
    pub fn hash(&self) -> &str {
        match self {
            MerkleNode::File { hash, .. } => hash,
            MerkleNode::Directory { hash, .. } => hash,
        }
    }
}

/// Merkle tree over a repository's file system.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MerkleTree {
    pub root: MerkleNode,
    pub repo_path: PathBuf,
    pub file_count: usize,
    pub built_at_ms: u64,
}

impl MerkleTree {
    /// Build a Merkle tree from a repository path.
    /// Uses `ignore` crate for .gitignore-aware traversal and rayon for parallel hashing.
    pub fn build(repo_path: &Path) -> anyhow::Result<Self> {
        use ignore::WalkBuilder;

        let entries: Mutex<Vec<(PathBuf, u64)>> = Mutex::new(Vec::new());

        WalkBuilder::new(repo_path)
            .hidden(true)
            .git_ignore(true)
            .git_global(false)
            .git_exclude(true)
            .filter_entry(|entry| {
                let name = entry.file_name().to_string_lossy();
                !matches!(
                    name.as_ref(),
                    "node_modules"
                        | ".git"
                        | "target"
                        | "dist"
                        | "build"
                        | ".next"
                        | "__pycache__"
                        | ".venv"
                        | "venv"
                        | "coverage"
                        | ".cache"
                        | ".idea"
                        | ".vscode"
                )
            })
            .build()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_some_and(|ft| ft.is_file()))
            .filter(|e| {
                e.path()
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .is_some_and(is_indexable_extension)
            })
            .for_each(|entry| {
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                entries.lock().unwrap().push((entry.into_path(), size));
            });

        let file_entries = entries.into_inner().unwrap();
        let file_count = file_entries.len();

        // Parallel blake3 hashing
        let hashed: Vec<(PathBuf, String, u64)> = file_entries
            .into_par_iter()
            .filter_map(|(path, size)| {
                let hash = hash_file(&path)?;
                Some((path, hash, size))
            })
            .collect();

        // Build tree structure from flat list
        let mut root_children: BTreeMap<String, MerkleNode> = BTreeMap::new();

        for (path, hash, size) in hashed {
            let rel = path.strip_prefix(repo_path).unwrap_or(&path);
            insert_file_node(&mut root_children, rel, hash, size);
        }

        // Compute directory hashes bottom-up
        compute_dir_hashes(&mut root_children);

        let root_hash = compute_children_hash(&root_children);

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        Ok(MerkleTree {
            root: MerkleNode::Directory {
                hash: root_hash,
                children: root_children,
            },
            repo_path: repo_path.to_path_buf(),
            file_count,
            built_at_ms: now_ms,
        })
    }

    /// Update specific files in the tree (re-hash and propagate).
    pub fn update_files(&mut self, relative_paths: &[PathBuf]) {
        let MerkleNode::Directory {
            ref mut children,
            ref mut hash,
        } = self.root
        else {
            return;
        };

        for rel_path in relative_paths {
            let abs_path = self.repo_path.join(rel_path);
            if abs_path.exists() {
                if let Some(file_hash) = hash_file(&abs_path) {
                    let size = std::fs::metadata(&abs_path).map(|m| m.len()).unwrap_or(0);
                    insert_file_node(children, rel_path, file_hash, size);
                }
            } else {
                remove_file_node(children, rel_path);
            }
        }

        compute_dir_hashes(children);
        *hash = compute_children_hash(children);

        self.built_at_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
    }
}

// ============================================
// Internal helpers
// ============================================

fn hash_file(path: &Path) -> Option<String> {
    let data = std::fs::read(path).ok()?;
    let hash = blake3::hash(&data);
    Some(hash.to_hex().to_string())
}

fn insert_file_node(
    children: &mut BTreeMap<String, MerkleNode>,
    rel_path: &Path,
    hash: String,
    size: u64,
) {
    let components: Vec<&str> = rel_path
        .components()
        .filter_map(|c| c.as_os_str().to_str())
        .collect();

    if components.is_empty() {
        return;
    }

    if components.len() == 1 {
        children.insert(components[0].to_string(), MerkleNode::File { hash, size });
        return;
    }

    let dir_name = components[0].to_string();
    let rest: PathBuf = components[1..].iter().collect();

    let dir_node = children
        .entry(dir_name)
        .or_insert_with(|| MerkleNode::Directory {
            hash: String::new(),
            children: BTreeMap::new(),
        });

    if let MerkleNode::Directory {
        children: ref mut dir_children,
        ..
    } = dir_node
    {
        insert_file_node(dir_children, &rest, hash, size);
    }
}

fn remove_file_node(children: &mut BTreeMap<String, MerkleNode>, rel_path: &Path) {
    let components: Vec<&str> = rel_path
        .components()
        .filter_map(|c| c.as_os_str().to_str())
        .collect();

    if components.is_empty() {
        return;
    }

    if components.len() == 1 {
        children.remove(components[0]);
        return;
    }

    let dir_name = components[0];
    let rest: PathBuf = components[1..].iter().collect();

    if let Some(MerkleNode::Directory {
        children: ref mut dir_children,
        ..
    }) = children.get_mut(dir_name)
    {
        remove_file_node(dir_children, &rest);
        if dir_children.is_empty() {
            children.remove(dir_name);
        }
    }
}

fn compute_dir_hashes(children: &mut BTreeMap<String, MerkleNode>) {
    for node in children.values_mut() {
        if let MerkleNode::Directory {
            children: ref mut sub,
            hash,
        } = node
        {
            compute_dir_hashes(sub);
            *hash = compute_children_hash(sub);
        }
    }
}

fn compute_children_hash(children: &BTreeMap<String, MerkleNode>) -> String {
    let mut hasher = blake3::Hasher::new();
    for (name, node) in children {
        hasher.update(name.as_bytes());
        hasher.update(node.hash().as_bytes());
    }
    hasher.finalize().to_hex().to_string()
}

fn is_indexable_extension(ext: &str) -> bool {
    matches!(
        ext,
        "rs" | "js"
            | "jsx"
            | "ts"
            | "tsx"
            | "py"
            | "go"
            | "java"
            | "c"
            | "cpp"
            | "h"
            | "hpp"
            | "cs"
            | "rb"
            | "php"
            | "swift"
            | "kt"
            | "scala"
            | "html"
            | "css"
            | "scss"
            | "json"
            | "yaml"
            | "yml"
            | "toml"
            | "md"
            | "sh"
            | "sql"
            | "vue"
            | "svelte"
    )
}

#[cfg(test)]
#[path = "tests/tree_tests.rs"]
mod tests;

//! Integration test: search::merkle tree + diff pipeline
//!
//! Tests the full Merkle tree build -> file modification -> diff detection
//! pipeline, verifying that the tree and diff modules produce consistent
//! results when used together against real filesystem operations.

use search::merkle::{diff_trees, ChangeType, MerkleTree};
use std::path::PathBuf;
use tempfile::TempDir;

fn rust_project() -> (TempDir, PathBuf) {
    let dir = TempDir::new().unwrap();
    let root = dir.path().to_path_buf();

    let src = root.join("src");
    std::fs::create_dir_all(&src).unwrap();
    std::fs::write(src.join("main.rs"), "fn main() {}\n").unwrap();
    std::fs::write(src.join("lib.rs"), "pub mod utils;\n").unwrap();
    std::fs::write(
        src.join("utils.rs"),
        "pub fn add(a: i32, b: i32) -> i32 { a + b }\n",
    )
    .unwrap();
    std::fs::write(root.join("Cargo.toml"), "[package]\nname = \"test\"\n").unwrap();

    (dir, root)
}

#[test]
fn identical_trees_produce_no_diff() {
    let (_dir, root) = rust_project();

    let tree_a = MerkleTree::build(&root).unwrap();
    let tree_b = MerkleTree::build(&root).unwrap();

    let changes = diff_trees(&tree_a.root, &tree_b.root);
    assert!(changes.is_empty(), "identical trees should produce no diff");
}

#[test]
fn modify_add_delete_detected_correctly() {
    let (_dir, root) = rust_project();

    let tree_before = MerkleTree::build(&root).unwrap();

    std::fs::write(
        root.join("src/main.rs"),
        "fn main() { println!(\"changed\"); }\n",
    )
    .unwrap();
    std::fs::write(root.join("src/new_module.rs"), "pub fn new_fn() {}\n").unwrap();
    std::fs::remove_file(root.join("src/utils.rs")).unwrap();

    let tree_after = MerkleTree::build(&root).unwrap();

    let changes = diff_trees(&tree_before.root, &tree_after.root);
    let modified: Vec<_> = changes
        .iter()
        .filter(|c| c.change_type == ChangeType::Modified)
        .collect();
    let added: Vec<_> = changes
        .iter()
        .filter(|c| c.change_type == ChangeType::Added)
        .collect();
    let deleted: Vec<_> = changes
        .iter()
        .filter(|c| c.change_type == ChangeType::Deleted)
        .collect();

    assert!(!modified.is_empty(), "should detect modified main.rs");
    assert!(modified.iter().any(|c| c.path.contains("main.rs")));

    assert!(!added.is_empty(), "should detect added new_module.rs");
    assert!(added.iter().any(|c| c.path.contains("new_module.rs")));

    assert!(!deleted.is_empty(), "should detect deleted utils.rs");
    assert!(deleted.iter().any(|c| c.path.contains("utils.rs")));
}

#[test]
fn incremental_update_matches_full_rebuild() {
    let (_dir, root) = rust_project();

    let mut tree = MerkleTree::build(&root).unwrap();
    let initial_hash = tree.root.hash().to_string();

    std::fs::write(root.join("src/main.rs"), "fn main() { /* updated */ }\n").unwrap();

    tree.update_files(&[PathBuf::from("src/main.rs")]);
    let incremental_hash = tree.root.hash().to_string();

    let full_rebuild = MerkleTree::build(&root).unwrap();
    let rebuild_hash = full_rebuild.root.hash().to_string();

    assert_ne!(
        initial_hash, incremental_hash,
        "hash should change after update"
    );
    assert_eq!(
        incremental_hash, rebuild_hash,
        "incremental update should match full rebuild"
    );
}

#[test]
fn file_count_reflects_filesystem() {
    let (_dir, root) = rust_project();

    let tree = MerkleTree::build(&root).unwrap();
    assert_eq!(tree.file_count, 4, "should count all 4 files");

    std::fs::write(root.join("src/extra.rs"), "// extra\n").unwrap();
    let tree2 = MerkleTree::build(&root).unwrap();
    assert_eq!(tree2.file_count, 5, "should count 5 files after adding one");
}

use crate::merkle::diff::diff_trees;
use crate::merkle::tree::MerkleTree;
use crate::merkle::ChangeType;
use app_utils::testing::temp_dir_with_files;

#[test]
fn test_diff_no_changes() {
    let (_dir, root) = temp_dir_with_files(&[("src/main.rs", "fn main() {}")]);

    let tree1 = MerkleTree::build(&root).unwrap();
    let tree2 = MerkleTree::build(&root).unwrap();

    let changes = diff_trees(&tree1.root, &tree2.root);
    assert!(changes.is_empty());
}

#[test]
fn test_diff_modified_file() {
    let (_dir, root) = temp_dir_with_files(&[("src/main.rs", "fn main() {}")]);

    let tree1 = MerkleTree::build(&root).unwrap();

    std::fs::write(root.join("src/main.rs"), "fn main() { changed }").unwrap();
    let tree2 = MerkleTree::build(&root).unwrap();

    let changes = diff_trees(&tree1.root, &tree2.root);
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].change_type, ChangeType::Modified);
    assert!(changes[0].path.contains("main.rs"));
}

#[test]
fn test_diff_added_and_deleted() {
    let (_dir, root) = temp_dir_with_files(&[("src/a.rs", "a"), ("src/b.rs", "b")]);

    let tree1 = MerkleTree::build(&root).unwrap();

    std::fs::remove_file(root.join("src/a.rs")).unwrap();
    std::fs::write(root.join("src/c.rs"), "c").unwrap();
    let tree2 = MerkleTree::build(&root).unwrap();

    let changes = diff_trees(&tree1.root, &tree2.root);
    let added: Vec<_> = changes
        .iter()
        .filter(|c| c.change_type == ChangeType::Added)
        .collect();
    let deleted: Vec<_> = changes
        .iter()
        .filter(|c| c.change_type == ChangeType::Deleted)
        .collect();

    assert_eq!(added.len(), 1);
    assert!(added[0].path.contains("c.rs"));
    assert_eq!(deleted.len(), 1);
    assert!(deleted[0].path.contains("a.rs"));
}

use std::path::PathBuf;

use crate::merkle::tree::MerkleTree;
use app_utils::testing::temp_dir_with_files;

#[test]
fn test_build_and_update() {
    let (_dir, root) = temp_dir_with_files(&[
        ("src/main.rs", "fn main() {}"),
        ("src/lib.rs", "pub fn hello() {}"),
    ]);

    let tree = MerkleTree::build(&root).unwrap();
    assert_eq!(tree.file_count, 2);

    let old_hash = tree.root.hash().to_string();

    let mut tree2 = MerkleTree::build(&root).unwrap();
    assert_eq!(tree2.root.hash(), old_hash);

    std::fs::write(root.join("src/main.rs"), "fn main() { println!(\"hi\"); }").unwrap();
    tree2.update_files(&[PathBuf::from("src/main.rs")]);
    assert_ne!(tree2.root.hash(), old_hash);
}

use crate::infrastructure::index_manager::{IndexManager, IndexState};

#[test]
fn test_index_manager_deduplication() {
    let manager = IndexManager::new();
    let repo = "/test/repo";

    // First call creates index
    let handle1 = manager.get_or_index(repo, None).unwrap();
    assert_eq!(handle1.state, IndexState::Pending);

    // Second call returns same index
    let handle2 = manager.get_or_index(repo, None).unwrap();
    assert_eq!(handle1.repo_hash, handle2.repo_hash);

    // Check reference counting
    let indexes = manager.indexes.lock().unwrap();
    let entry = indexes.get(&handle1.repo_hash).unwrap();
    assert_eq!(entry.reference_count, 2);
}

#[test]
fn test_hash_consistency() {
    let path1 = "/Users/test/repo";
    let path2 = "/Users/test/repo";
    let path3 = "/Users/test/other";

    assert_eq!(
        IndexManager::hash_repo_path(path1),
        IndexManager::hash_repo_path(path2)
    );
    assert_ne!(
        IndexManager::hash_repo_path(path1),
        IndexManager::hash_repo_path(path3)
    );
}

#[test]
fn test_index_manager_normalizes_equivalent_repo_paths() {
    let manager = IndexManager::new();

    let handle1 = manager.get_or_index("/Users/test/repo", None).unwrap();
    let handle2 = manager.get_or_index("/Users/test/repo/./", None).unwrap();

    assert_eq!(handle1.repo_hash, handle2.repo_hash);
    assert_eq!(handle1.repo_path, "/Users/test/repo");

    let indexes = manager.indexes.lock().unwrap();
    assert_eq!(indexes.len(), 1);
}

#[test]
fn test_index_manager_keeps_same_basename_repos_distinct() {
    let manager = IndexManager::new();

    let handle1 = manager.get_or_index("/tmp/workspace-a/app", None).unwrap();
    let handle2 = manager.get_or_index("/tmp/workspace-b/app", None).unwrap();

    assert_ne!(handle1.repo_hash, handle2.repo_hash);

    let indexes = manager.indexes.lock().unwrap();
    assert_eq!(indexes.len(), 2);
}

use crate::recent_files::add_to_recent_documents;

#[test]
fn test_add_nonexistent_path() {
    let result = add_to_recent_documents("/nonexistent/path/file.txt".to_string());
    assert!(result.is_err());
}

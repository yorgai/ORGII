use std::path::Path;

use crate::infrastructure::archive::{get_relative_path, should_exclude};

#[test]
fn test_should_exclude() {
    assert!(should_exclude(Path::new("node_modules")));
    assert!(should_exclude(Path::new(".git")));
    assert!(should_exclude(Path::new(".DS_Store")));
    assert!(!should_exclude(Path::new("src")));
    assert!(!should_exclude(Path::new("main.rs")));
}

#[test]
fn test_get_relative_path() {
    let root = Path::new("/home/user/project");
    let file = Path::new("/home/user/project/src/main.rs");
    assert_eq!(get_relative_path(root, file), "src/main.rs");
}

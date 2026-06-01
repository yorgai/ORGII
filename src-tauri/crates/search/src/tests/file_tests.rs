use crate::file::{fuzzy_search, FileEntry};

#[test]
fn test_fuzzy_matching() {
    let entries = vec![
        FileEntry {
            path: "/src/components/Button.tsx".to_string(),
            filename: "Button.tsx".to_string(),
            is_dir: false,
        },
        FileEntry {
            path: "/src/components/ComponentList.tsx".to_string(),
            filename: "ComponentList.tsx".to_string(),
            is_dir: false,
        },
        FileEntry {
            path: "/src/index.tsx".to_string(),
            filename: "index.tsx".to_string(),
            is_dir: false,
        },
    ];

    // Test fuzzy matching
    let results = fuzzy_search(&entries, "btn", 10, None);
    assert!(!results.is_empty());

    // "btn" should match "Button" better than others
    assert_eq!(results[0].0.filename, "Button.tsx");
}

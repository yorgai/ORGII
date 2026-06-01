use super::*;

#[test]
fn source_dir_path_maps_ai_research_builtin_source() {
    let path = source_dir_path("builtin://ai-research-skills");

    assert_eq!(path, ai_research_skills_dir());
    assert!(path.ends_with("prebuilt-skill-sources/ai-research"));
}

#[test]
fn source_dir_path_preserves_filesystem_paths() {
    let path = source_dir_path("custom-skills");

    assert_eq!(path, PathBuf::from("custom-skills"));
}

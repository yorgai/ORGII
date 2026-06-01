use super::*;

#[test]
fn test_check_lint_tools() {
    let tools = check_lint_tools();
    assert!(!tools.is_empty());

    // Verify structure
    for tool in &tools {
        assert!(!tool.id.is_empty());
        assert!(!tool.name.is_empty());
        assert!(!tool.languages.is_empty());
        assert!(!tool.install_hint.is_empty());
    }
}

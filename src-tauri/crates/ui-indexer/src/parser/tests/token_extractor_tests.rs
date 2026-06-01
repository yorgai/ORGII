use super::*;

#[test]
fn test_extract_var_pattern() {
    let extractor = TokenExtractor::new();

    let content = r#"
        const style = {
            color: "var(--color-text-1)",
            background: "rgb(var(--primary-6))",
            border: "1px solid rgba(var(--border-2), 0.5)",
        };
    "#;

    let result = extractor.extract_from_content(content);

    assert!(result.tokens.contains(&"color-text-1".to_string()));
    assert!(result.tokens.contains(&"primary-6".to_string()));
    assert!(result.tokens.contains(&"border-2".to_string()));
}

#[test]
fn test_extract_css_var_definition() {
    let extractor = TokenExtractor::new();

    let content = r#"
        return {
            ...baseStyles,
            "--hover-bg": hoverBg,
        };
    "#;

    let result = extractor.extract_from_content(content);

    assert!(result.tokens.contains(&"hover-bg".to_string()));
}

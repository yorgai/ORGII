use crate::intelligence::policies::{parse_source, PolicySource};
use crate::tool_infra::slugify;

// -- slugify --

#[test]
fn slugify_basic() {
    assert_eq!(slugify("My Cool Rule"), "my-cool-rule");
}

#[test]
fn slugify_special_chars() {
    assert_eq!(slugify("rule_v2.0 (draft)"), "rule-v2-0-draft");
}

#[test]
fn slugify_already_clean() {
    assert_eq!(slugify("clean-name"), "clean-name");
}

#[test]
fn slugify_consecutive_separators() {
    assert_eq!(slugify("a---b___c"), "a-b-c");
}

#[test]
fn slugify_leading_trailing_separators() {
    assert_eq!(slugify("--hello--"), "hello");
}

#[test]
fn slugify_empty() {
    assert_eq!(slugify(""), "");
}

#[test]
fn slugify_unicode() {
    let result = slugify("café règle");
    assert!(result.starts_with("caf"));
    assert!(!result.contains(' '));
    assert!(!result.contains('é'));
}

// -- parse_source --

#[test]
fn parse_source_global() {
    assert_eq!(parse_source("global").unwrap(), PolicySource::Global);
}

#[test]
fn parse_source_workspace() {
    assert_eq!(parse_source("workspace").unwrap(), PolicySource::Workspace);
}

#[test]
fn parse_source_unknown_errors() {
    let err = parse_source("local").unwrap_err();
    assert!(err.contains("Unknown policy source"));
}

// -- PolicySource serde --

#[test]
fn policy_source_serde() {
    let json = serde_json::to_string(&PolicySource::Global).unwrap();
    assert_eq!(json, "\"global\"");
    let parsed: PolicySource = serde_json::from_str("\"workspace\"").unwrap();
    assert_eq!(parsed, PolicySource::Workspace);
}

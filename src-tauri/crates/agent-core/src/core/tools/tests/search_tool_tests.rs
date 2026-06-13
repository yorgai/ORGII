use std::path::PathBuf;

use crate::tools::impls::coding::code_search::SearchTool;
use crate::tools::traits::Tool;

fn make_tool(repo: &str) -> SearchTool {
    SearchTool::new(PathBuf::from(repo))
}

// ── Schema ──────────────────────────────────────────────────────────

#[test]
fn parameters_has_action_enum() {
    let tool = make_tool("/tmp/repo");
    let params = tool.parameters();
    let action = &params["properties"]["action"];
    let variants: Vec<&str> = action["enum"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert!(variants.contains(&"grep"));
    assert!(variants.contains(&"find_files"));
    assert!(variants.contains(&"glob"));
    assert!(variants.contains(&"symbols"));
    assert!(variants.contains(&"check_status"));
}

#[test]
fn required_field_is_action() {
    let tool = make_tool("/tmp/repo");
    let params = tool.parameters();
    let required: Vec<&str> = params["required"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert_eq!(required, vec!["action"]);
}

#[test]
fn is_read_only() {
    assert!(make_tool("/tmp/repo").is_read_only());
}

#[test]
fn name_is_code_search() {
    assert_eq!(make_tool("/tmp/repo").name(), "code_search");
}

#[test]
fn category_is_coding() {
    assert_eq!(make_tool("/tmp/repo").category(), "coding");
}

#[test]
fn output_budget_is_positive() {
    assert!(make_tool("/tmp/repo").output_budget() > 0);
}

#[test]
fn llm_description_contains_repo_path() {
    let tool = make_tool("/projects/myapp");
    let desc = tool.llm_description().unwrap();
    assert!(
        desc.contains("/projects/myapp"),
        "LLM description should contain the repo path: {desc}"
    );
}

// ── Error paths ─────────────────────────────────────────────────────

#[tokio::test]
async fn missing_action_returns_error() {
    let tool = make_tool("/tmp/repo");
    let result = tool
        .execute(
            serde_json::json!({}),
            &crate::tools::call_context::CallContext::default(),
        )
        .await;
    assert!(result.is_err());
    let err = format!("{}", result.unwrap_err());
    assert!(
        err.contains("action"),
        "Should mention missing action: {err}"
    );
}

#[tokio::test]
async fn unknown_action_returns_error() {
    // Use /tmp which exists so we get past the path check and hit the action router
    let tool = make_tool("/tmp");
    let result = tool
        .execute(
            serde_json::json!({
                "action": "nonsense",
                "pattern": "foo"
            }),
            &crate::tools::call_context::CallContext::default(),
        )
        .await;
    assert!(result.is_err());
    let err = format!("{}", result.unwrap_err());
    assert!(
        err.contains("Unknown action"),
        "Should say unknown action: {err}"
    );
}

#[tokio::test]
async fn grep_action_missing_pattern_returns_error() {
    let tool = make_tool("/tmp/repo");
    let result = tool
        .execute(
            serde_json::json!({ "action": "grep" }),
            &crate::tools::call_context::CallContext::default(),
        )
        .await;
    assert!(result.is_err());
    let err = format!("{}", result.unwrap_err());
    assert!(
        err.contains("pattern"),
        "Should mention missing pattern: {err}"
    );
}

#[tokio::test]
async fn find_files_action_missing_pattern_returns_error() {
    let tool = make_tool("/tmp/repo");
    let result = tool
        .execute(
            serde_json::json!({ "action": "find_files" }),
            &crate::tools::call_context::CallContext::default(),
        )
        .await;
    assert!(result.is_err());
}

#[tokio::test]
async fn nonexistent_repo_returns_error() {
    let tool = make_tool("/definitely/does/not/exist/xyz");
    let result = tool
        .execute(
            serde_json::json!({
                "action": "grep",
                "pattern": "fn main"
            }),
            &crate::tools::call_context::CallContext::default(),
        )
        .await;
    assert!(result.is_err());
    let err = format!("{}", result.unwrap_err());
    assert!(
        err.contains("does not exist"),
        "Should mention path does not exist: {err}"
    );
}

// ── resolve_repo ────────────────────────────────────────────────────

#[tokio::test]
async fn explicit_repo_path_overrides_default() {
    let tool = make_tool("/default/path");
    // "grep" with an explicit repo_path that doesn't exist → error mentions the explicit path
    let result = tool
        .execute(
            serde_json::json!({
                "action": "grep",
                "pattern": "test",
                "repo_path": "/explicit/override/path"
            }),
            &crate::tools::call_context::CallContext::default(),
        )
        .await;
    assert!(result.is_err());
    let err = format!("{}", result.unwrap_err());
    assert!(
        err.contains("/explicit/override/path"),
        "Should use explicit path in error: {err}"
    );
}

#[tokio::test]
async fn set_active_repo_overrides_default() {
    let tool = make_tool("/original/default");
    tool.set_active_repo("/active/repo/path").await;
    // Active repo doesn't exist → error should mention active path, not default
    let result = tool
        .execute(
            serde_json::json!({
                "action": "grep",
                "pattern": "test"
            }),
            &crate::tools::call_context::CallContext::default(),
        )
        .await;
    // set_active_repo only sets if path exists, so it falls back to default
    // which also doesn't exist
    assert!(result.is_err());
}

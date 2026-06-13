use std::path::PathBuf;
use std::sync::Arc;

use serde_json::json;

use super::*;
use crate::session::workspace::SessionWorkspace;
use crate::tools::traits::Tool;

fn fresh_tool() -> ManageCodeMapTool {
    let workspace = SessionWorkspace::new(PathBuf::from("/workspace"));
    ManageCodeMapTool::new(
        PathBuf::from("/workspace"),
        None,
        Arc::new(parking_lot::RwLock::new(workspace)),
    )
}

#[test]
fn manage_code_map_uses_canonical_name_and_is_mutating() {
    let tool = fresh_tool();

    assert_eq!(tool.name(), tool_names::MANAGE_CODE_MAP);
    assert_eq!(tool.category(), crate::tools::categories::CODING);
    assert!(!tool.is_read_only());
}

#[test]
fn manage_code_map_schema_exposes_lifecycle_actions() {
    let schema = fresh_tool().parameters();

    assert_eq!(
        schema.get("type").and_then(|value| value.as_str()),
        Some("object")
    );
    let enum_values = schema
        .pointer("/properties/action/enum")
        .and_then(|value| value.as_array())
        .expect("action enum should exist");
    for action in ["status", "index", "reindex", "cancel", "clear"] {
        assert!(enum_values.iter().any(|value| value == action));
    }
    assert!(schema
        .get("required")
        .and_then(|value| value.as_array())
        .is_some_and(|required| required.iter().any(|value| value == "action")));
}

#[tokio::test]
async fn manage_code_map_rejects_clear_without_confirmation() {
    let error = fresh_tool()
        .execute_text(json!({ "action": "clear" }), &Default::default())
        .await
        .expect_err("clear should require explicit confirmation");

    assert!(error.to_string().contains("confirm: true"));
}

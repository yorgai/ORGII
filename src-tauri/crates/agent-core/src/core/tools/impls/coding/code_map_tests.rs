use std::path::PathBuf;
use std::sync::Arc;

use serde_json::json;

use super::*;
use crate::session::workspace::SessionWorkspace;
use crate::tools::traits::{parse_params_described, Tool};

fn fresh_tool() -> CodeMapTool {
    let workspace = SessionWorkspace::new(PathBuf::from("/workspace"));
    CodeMapTool::new(
        PathBuf::from("/workspace"),
        Arc::new(parking_lot::RwLock::new(workspace)),
    )
}

#[test]
fn code_map_tool_uses_canonical_name_and_is_read_only() {
    let tool = fresh_tool();

    assert_eq!(tool.name(), tool_names::USE_CODE_MAP);
    assert_eq!(tool.category(), crate::tools::categories::CODING);
    assert!(tool.is_read_only());
}

#[test]
fn code_map_params_schema_exposes_action_property() {
    let schema = fresh_tool().parameters();

    assert_eq!(
        schema.get("type").and_then(|value| value.as_str()),
        Some("object")
    );
    assert!(schema.pointer("/properties/action").is_some());
    assert!(schema
        .get("required")
        .and_then(|value| value.as_array())
        .is_some_and(|required| required.iter().any(|value| value == "action")));
}

#[test]
fn code_map_params_parse_snake_case_actions() {
    let params: CodeMapToolParams = parse_params_described(json!({
        "action": "callers",
        "query": "run_query",
        "max_results": 25,
        "max_depth": 3
    }))
    .expect("params should parse");

    assert!(matches!(params.action, CodeMapToolAction::Callers));
    assert_eq!(params.query.as_deref(), Some("run_query"));
    assert_eq!(params.max_results, Some(25));
    assert_eq!(params.max_depth, Some(3));
}

#[test]
fn code_map_tool_action_maps_to_service_action() {
    assert!(matches!(
        CodeMapToolAction::Impact.as_code_map_action(),
        CodeMapAction::Impact
    ));
    assert!(matches!(
        CodeMapToolAction::Explore.as_code_map_action(),
        CodeMapAction::Explore
    ));
}

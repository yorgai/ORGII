use super::ELEMENT_INSPECTOR_SCRIPT;

#[test]
fn element_inspector_script_is_non_empty() {
    assert!(
        ELEMENT_INSPECTOR_SCRIPT.len() > 10_000,
        "expected bundled inspector script to be large; got {} bytes",
        ELEMENT_INSPECTOR_SCRIPT.len()
    );
}

#[test]
fn element_inspector_script_contains_iife_and_globals() {
    let script = ELEMENT_INSPECTOR_SCRIPT;
    assert!(script.starts_with("(function()"));
    assert!(script.contains("window.__ORGII_ELEMENT_INSPECTOR__"));
    assert!(script.contains("window.__ORGII_ENABLE_INSPECT_MODE__"));
    assert!(script.contains("window.__ORGII_GET_DOM_TREE__"));
    assert!(script.contains("window.__ORGII_INSERT_ELEMENT__"));
    assert!(script.contains("window.__ORGII_MULTI_SELECT_ADD__"));
    assert!(script.ends_with("})();\n"));
}

#[test]
fn element_inspector_script_includes_all_js_chunks() {
    let script = ELEMENT_INSPECTOR_SCRIPT;
    assert!(script.contains("__orgii_highlight_overlay__"));
    assert!(script.contains("getReactFiberSource"));
    assert!(script.contains("getElementInfo"));
    assert!(script.contains("handleMouseMove"));
    assert!(script.contains("__ORGII_HIGHLIGHT_BY_XPATH__"));
    assert!(script.contains("__ORGII_UNDO__"));
    assert!(script.contains("__ORGII_RESIZE_ELEMENT__"));
}

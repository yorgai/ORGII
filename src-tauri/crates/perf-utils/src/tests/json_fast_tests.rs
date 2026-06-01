use crate::json_fast::*;

#[test]
fn test_parse_json() {
    let result = parse_json_fast(r#"{"name": "test", "value": 42}"#.to_string()).unwrap();
    assert_eq!(result.value["name"], "test");
    assert_eq!(result.value["value"], 42);
}

#[test]
fn test_validate_json() {
    let valid = validate_json_fast(r#"{"valid": true}"#.to_string());
    assert!(valid.valid);

    let invalid = validate_json_fast(r#"{"invalid": }"#.to_string());
    assert!(!invalid.valid);
    assert!(invalid.error.is_some());
}

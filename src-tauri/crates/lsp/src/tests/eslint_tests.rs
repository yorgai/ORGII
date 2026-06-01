use super::*;

#[test]
fn test_eslint_message_parse() {
    let json = r#"[{
        "filePath": "/test/file.ts",
        "messages": [{
            "line": 1,
            "column": 1,
            "severity": 2,
            "message": "Test error",
            "ruleId": "no-unused-vars"
        }],
        "errorCount": 1,
        "warningCount": 0
    }]"#;

    let results: Vec<EslintFileResult> = serde_json::from_str(json).unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].messages.len(), 1);
    assert_eq!(results[0].messages[0].severity, 2);
}

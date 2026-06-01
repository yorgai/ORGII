use crate::providers::cursor::CursorValidator;
use crate::test_support::install_crypto_provider_for_tests;

#[test]
fn test_validate_format_valid() {
    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();

    // Valid key_ prefix
    let (valid, _) = validator.validate_format("key_1234567890abcdefghij");
    assert!(valid);

    // Valid crsr_ prefix (new User API Key format)
    let (valid, _) = validator.validate_format("crsr_00c8c4483743f18b389e4af9533fc522");
    assert!(valid);
}

#[test]
fn test_validate_format_invalid_prefix() {
    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();

    let (valid, msg) = validator.validate_format("invalid_key_12345");
    assert!(!valid);
    assert!(msg.contains("key_") || msg.contains("crsr_"));
}

#[test]
fn test_validate_format_too_short() {
    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();

    let (valid, msg) = validator.validate_format("key_123");
    assert!(!valid);
    assert!(msg.contains("short"));
}

#[test]
fn test_validate_format_empty() {
    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();

    let (valid, _) = validator.validate_format("");
    assert!(!valid);
}

#[test]
fn test_parse_model_list() {
    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();

    let output = r#"
Available models

auto - Auto  (current)
composer-1 - Composer 1
gpt-4 - GPT-4
claude-3.5-sonnet - Claude 3.5 Sonnet

Tip: use --model <id> to select a model
"#;

    let models = validator.parse_model_list(output);
    assert_eq!(
        models,
        vec!["auto", "composer-1", "gpt-4", "claude-3.5-sonnet"]
    );
}

#[test]
fn test_parse_error_model_list() {
    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();

    let output = "Model '___invalid_model_name___' not found. Available models: auto, gpt-4, claude-3.5-sonnet";
    let models = validator.parse_error_model_list(output);
    assert!(models.contains(&"auto".to_string()));
    assert!(models.contains(&"gpt-4".to_string()));
    assert!(models.contains(&"claude-3.5-sonnet".to_string()));
}

#[test]
fn test_parse_error_model_list_choose_from() {
    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();

    let output = "Invalid model. Choose from: model-a, model-b, model-c";
    let models = validator.parse_error_model_list(output);
    assert_eq!(
        models,
        vec![
            "model-a".to_string(),
            "model-b".to_string(),
            "model-c".to_string(),
        ]
    );
}

#[test]
fn test_parse_error_model_list_supported_models() {
    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();

    let output = "Error: bad request. Supported models: model-a, model-b";
    let models = validator.parse_error_model_list(output);
    assert_eq!(models, vec!["model-a".to_string(), "model-b".to_string()]);
}

#[test]
fn test_parse_error_model_list_regex_fallback() {
    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();

    let output = "Request failed: try gpt-4o, claude-sonnet-4 instead.";
    let models = validator.parse_error_model_list(output);
    assert_eq!(
        models,
        vec!["gpt-4o".to_string(), "claude-sonnet-4".to_string()]
    );
}

#[test]
fn test_parse_error_model_list_empty() {
    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();

    let models = validator.parse_error_model_list("");
    assert!(models.is_empty());
}

#[test]
fn test_parse_usage_response_basic_plan() {
    use serde_json::json;

    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();
    let data: crate::cursor::quota::UsageSummaryResponse = serde_json::from_value(json!({
        "membershipType": "Pro",
        "isUnlimited": false,
        "individualUsage": {
            "plan": {
                "enabled": true,
                "used": 150,
                "limit": 500,
                "remaining": 350,
                "breakdown": { "total": 500 }
            }
        }
    }))
    .unwrap();

    let quota = validator.parse_usage_response(data);

    assert_eq!(quota.plan_type, Some("Pro".to_string()));
    assert!(!quota.is_unlimited);
    assert_eq!(quota.usage_items.len(), 1);
    let plan_item = &quota.usage_items[0];
    assert_eq!(plan_item.usage_type, "plan");
    assert_eq!(plan_item.remaining, Some(350));
    assert_eq!(plan_item.limit, Some(500));
    assert_eq!(plan_item.used, Some(150));
    assert!((plan_item.remaining_percentage - 70.0).abs() < f64::EPSILON);
    assert!((quota.remaining_percentage - 70.0).abs() < f64::EPSILON);
}

#[test]
fn test_parse_usage_response_on_demand() {
    use serde_json::json;

    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();
    let data: crate::cursor::quota::UsageSummaryResponse = serde_json::from_value(json!({
        "membershipType": "Business",
        "isUnlimited": false,
        "individualUsage": {
            "plan": {
                "enabled": true,
                "used": 150,
                "limit": 500,
                "remaining": 350,
                "breakdown": { "total": 500 }
            },
            "onDemand": {
                "enabled": true,
                "used": 20,
                "limit": 100
            }
        }
    }))
    .unwrap();

    let quota = validator.parse_usage_response(data);

    assert_eq!(quota.plan_type, Some("Business".to_string()));
    assert!(!quota.is_unlimited);
    assert_eq!(quota.usage_items.len(), 2);

    let plan_item = quota
        .usage_items
        .iter()
        .find(|item| item.usage_type == "plan")
        .expect("plan item");
    assert_eq!(plan_item.remaining, Some(350));
    assert!((plan_item.remaining_percentage - 70.0).abs() < f64::EPSILON);

    let on_demand_item = quota
        .usage_items
        .iter()
        .find(|item| item.usage_type == "on_demand")
        .expect("on_demand item");
    assert_eq!(on_demand_item.used, Some(20));
    assert_eq!(on_demand_item.limit, Some(100));
    assert_eq!(on_demand_item.remaining, Some(80));
    assert!((on_demand_item.remaining_percentage - 80.0).abs() < f64::EPSILON);

    let expected_overall = (430.0_f64 / 600.0_f64) * 100.0;
    assert!((quota.remaining_percentage - expected_overall).abs() < 1e-9);
}

#[test]
fn test_parse_usage_response_unlimited() {
    use serde_json::json;

    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();
    let data: crate::cursor::quota::UsageSummaryResponse = serde_json::from_value(json!({
        "membershipType": "Enterprise",
        "isUnlimited": true,
        "individualUsage": {}
    }))
    .unwrap();

    let quota = validator.parse_usage_response(data);

    assert_eq!(quota.plan_type, Some("Enterprise".to_string()));
    assert!(quota.is_unlimited);
    assert_eq!(quota.usage_items.len(), 1);
    let item = &quota.usage_items[0];
    assert_eq!(item.usage_type, "plan");
    assert_eq!(item.remaining_percentage, 100.0);
    assert!((quota.remaining_percentage - 100.0).abs() < f64::EPSILON);
}

#[test]
fn test_parse_usage_response_team_pooled() {
    use serde_json::json;

    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();
    let data: crate::cursor::quota::UsageSummaryResponse = serde_json::from_value(json!({
        "membershipType": "Team",
        "isUnlimited": false,
        "teamUsage": {
            "pooled": {
                "enabled": true,
                "used": 10,
                "limit": 200,
                "remaining": 190
            }
        }
    }))
    .unwrap();

    let quota = validator.parse_usage_response(data);

    assert_eq!(quota.plan_type, Some("Team".to_string()));
    assert!(!quota.is_unlimited);
    assert_eq!(quota.usage_items.len(), 1);
    let item = &quota.usage_items[0];
    assert_eq!(item.usage_type, "team_pooled");
    assert_eq!(item.used, Some(10));
    assert_eq!(item.limit, Some(200));
    assert_eq!(item.remaining, Some(190));
    assert!((item.remaining_percentage - 95.0).abs() < f64::EPSILON);
    assert!((quota.remaining_percentage - 95.0).abs() < f64::EPSILON);
}

#[test]
fn test_parse_usage_response_empty() {
    use serde_json::json;

    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();
    let data: crate::cursor::quota::UsageSummaryResponse =
        serde_json::from_value(json!({ "isUnlimited": false })).unwrap();

    let quota = validator.parse_usage_response(data);

    assert_eq!(quota.plan_type, Some("unknown".to_string()));
    assert!(!quota.is_unlimited);
    assert!(quota.usage_items.is_empty());
    assert_eq!(quota.remaining_percentage, 0.0);
}

// ── parse_usage_response ──
//
// Focused regression tests for the pure quota-math function. Inputs are built
// via `serde_json::from_value` because `UsageSummaryResponse` and its inner
// buckets have private fields.

#[test]
fn parse_usage_response_plan_only() {
    use serde_json::json;

    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();
    let data: crate::cursor::quota::UsageSummaryResponse = serde_json::from_value(json!({
        "membershipType": "Pro",
        "isUnlimited": false,
        "individualUsage": {
            "plan": {
                "enabled": true,
                "used": 250,
                "limit": 1000,
                "remaining": 750,
                "breakdown": { "total": 1000 }
            }
        }
    }))
    .unwrap();

    let quota = validator.parse_usage_response(data);

    assert_eq!(quota.usage_items.len(), 1);
    let plan_item = &quota.usage_items[0];
    assert_eq!(plan_item.usage_type, "plan");
    assert_eq!(plan_item.remaining, Some(750));
    assert_eq!(plan_item.limit, Some(1000));
    assert!((plan_item.remaining_percentage - 75.0).abs() < 0.01);
    assert!((quota.remaining_percentage - 75.0).abs() < 0.01);
}

#[test]
fn parse_usage_response_on_demand_unlimited() {
    use serde_json::json;

    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();
    let data: crate::cursor::quota::UsageSummaryResponse = serde_json::from_value(json!({
        "membershipType": "Business",
        "isUnlimited": false,
        "individualUsage": {
            "onDemand": {
                "enabled": true,
                "used": 50
            }
        }
    }))
    .unwrap();

    let quota = validator.parse_usage_response(data);

    assert_eq!(quota.usage_items.len(), 1);
    let item = &quota.usage_items[0];
    assert_eq!(item.usage_type, "on_demand");
    assert_eq!(item.limit, None);
    assert_eq!(item.remaining, None);
    assert!((item.remaining_percentage - 100.0).abs() < 0.01);
    assert!((quota.remaining_percentage - 100.0).abs() < 0.01);
}

#[test]
fn parse_usage_response_on_demand_overage() {
    use serde_json::json;

    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();
    let data: crate::cursor::quota::UsageSummaryResponse = serde_json::from_value(json!({
        "membershipType": "Business",
        "isUnlimited": false,
        "individualUsage": {
            "onDemand": {
                "enabled": true,
                "used": 150,
                "limit": 100
            }
        }
    }))
    .unwrap();

    let quota = validator.parse_usage_response(data);

    assert_eq!(quota.usage_items.len(), 1);
    let item = &quota.usage_items[0];
    assert_eq!(item.usage_type, "on_demand");
    assert_eq!(item.limit, Some(100));
    // Critical: clamped to 0, not negative.
    assert_eq!(item.remaining, Some(0));
    assert!((item.remaining_percentage - 0.0).abs() < 0.01);
}

#[test]
fn parse_usage_response_team_pooled() {
    use serde_json::json;

    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();
    let data: crate::cursor::quota::UsageSummaryResponse = serde_json::from_value(json!({
        "membershipType": "Team",
        "isUnlimited": false,
        "teamUsage": {
            "pooled": {
                "enabled": true,
                "used": 500,
                "limit": 2000,
                "remaining": 1500
            }
        }
    }))
    .unwrap();

    let quota = validator.parse_usage_response(data);

    assert_eq!(quota.usage_items.len(), 1);
    let item = &quota.usage_items[0];
    assert_eq!(item.usage_type, "team_pooled");
    assert_eq!(item.limit, Some(2000));
    assert_eq!(item.remaining, Some(1500));
    assert!((item.remaining_percentage - 75.0).abs() < 0.01);
}

#[test]
fn parse_usage_response_unlimited_with_no_buckets() {
    use serde_json::json;

    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();
    let data: crate::cursor::quota::UsageSummaryResponse = serde_json::from_value(json!({
        "membershipType": "Enterprise",
        "isUnlimited": true
    }))
    .unwrap();

    let quota = validator.parse_usage_response(data);

    assert!(quota.is_unlimited);
    assert_eq!(quota.usage_items.len(), 1);
    let item = &quota.usage_items[0];
    assert_eq!(item.usage_type, "plan");
    assert!((item.remaining_percentage - 100.0).abs() < 0.01);
}

#[test]
fn parse_usage_response_combined_plan_and_on_demand() {
    use serde_json::json;

    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();
    let data: crate::cursor::quota::UsageSummaryResponse = serde_json::from_value(json!({
        "membershipType": "Pro",
        "isUnlimited": false,
        "individualUsage": {
            "plan": {
                "enabled": true,
                "used": 300,
                "limit": 1000,
                "remaining": 700,
                "breakdown": { "total": 1000 }
            },
            "onDemand": {
                "enabled": true,
                "used": 100,
                "limit": 500,
                "remaining": 400
            }
        }
    }))
    .unwrap();

    let quota = validator.parse_usage_response(data);

    assert_eq!(quota.usage_items.len(), 2);
    // ((700 + 400) / (1000 + 500)) * 100 ≈ 73.33
    let expected = (1100.0_f64 / 1500.0_f64) * 100.0;
    assert!((quota.remaining_percentage - expected).abs() < 0.01);
    assert!((quota.remaining_percentage - 73.33).abs() < 0.01);
}

#[test]
fn parse_usage_response_individual_overall() {
    use serde_json::json;

    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();
    let data: crate::cursor::quota::UsageSummaryResponse = serde_json::from_value(json!({
        "membershipType": "Enterprise",
        "isUnlimited": false,
        "individualUsage": {
            "overall": {
                "enabled": true,
                "used": 1000,
                "limit": 5000,
                "remaining": 4000
            }
        }
    }))
    .unwrap();

    let quota = validator.parse_usage_response(data);

    assert_eq!(quota.usage_items.len(), 1);
    let item = &quota.usage_items[0];
    assert_eq!(item.usage_type, "individual_overall");
    assert_eq!(item.limit, Some(5000));
    assert_eq!(item.remaining, Some(4000));
    assert!((item.remaining_percentage - 80.0).abs() < 0.01);
    assert!((quota.remaining_percentage - 80.0).abs() < 0.01);
}

#[test]
fn parse_usage_response_clamps_remaining_above_total() {
    use serde_json::json;

    install_crypto_provider_for_tests();
    let validator = CursorValidator::new();
    let data: crate::cursor::quota::UsageSummaryResponse = serde_json::from_value(json!({
        "membershipType": "Pro",
        "isUnlimited": false,
        "individualUsage": {
            "plan": {
                "enabled": true,
                "used": 0,
                "limit": 100,
                "remaining": 999,
                "breakdown": { "total": 100 }
            }
        }
    }))
    .unwrap();

    let quota = validator.parse_usage_response(data);

    assert_eq!(quota.usage_items.len(), 1);
    let item = &quota.usage_items[0];
    // Clamped to plan_total (100), not the upstream 999.
    assert_eq!(item.remaining, Some(100));
    assert_eq!(item.limit, Some(100));
    assert!((item.remaining_percentage - 100.0).abs() < 0.01);
}

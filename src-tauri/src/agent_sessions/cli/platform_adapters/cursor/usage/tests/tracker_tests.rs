use crate::agent_sessions::cli::platform_adapters::cursor::usage::tracker::{
    models_match, normalize_model,
};

#[test]
fn test_normalize_model_basic() {
    let (base, ver, _mods) = normalize_model("sonnet-4.5");
    assert_eq!(base, "sonnet");
    assert_eq!(ver, "4.5");
}

#[test]
fn test_normalize_model_api_format() {
    let (base, ver, _mods) = normalize_model("claude-4.5-sonnet");
    assert_eq!(base, "sonnet");
    assert_eq!(ver, "4.5");
}

#[test]
fn test_normalize_model_auto() {
    let (base, ver, mods) = normalize_model("auto");
    assert_eq!(base, "auto");
    assert_eq!(ver, "");
    assert!(mods.is_empty());
}

#[test]
fn test_normalize_model_default() {
    let (base, _, _) = normalize_model("default");
    assert_eq!(base, "auto");
}

#[test]
fn test_normalize_model_gpt4o_mini() {
    let (base, ver, mods) = normalize_model("gpt-4o-mini");
    assert_eq!(base, "gpt");
    assert_eq!(ver, "4o");
    assert!(mods.contains("mini"));
}

#[test]
fn test_normalize_model_opus_high_thinking() {
    let (base, ver, mods) = normalize_model("claude-4.5-opus-high-thinking");
    assert_eq!(base, "opus");
    assert_eq!(ver, "4.5");
    assert!(mods.contains("high"));
    assert!(mods.contains("thinking"));
}

#[test]
fn test_models_match_sonnet() {
    assert!(models_match("sonnet-4.5", "claude-4.5-sonnet"));
}

#[test]
fn test_models_match_opus_high() {
    assert!(models_match("opus-4.5", "claude-4.5-opus-high"));
}

#[test]
fn test_models_match_auto_matches_any() {
    assert!(models_match("auto", "claude-4.5-sonnet"));
    assert!(models_match("auto", "gpt-4o"));
}

#[test]
fn test_models_match_composer() {
    assert!(models_match("composer-1", "composer-2"));
}

#[test]
fn test_models_no_false_positive() {
    assert!(!models_match("sonnet-4.5", "gpt-4o"));
    assert!(!models_match("opus-4.5", "sonnet-4.5"));
}

//! Tests for the tokenizer facade (`count_tokens`, message token estimates, model limits).

use crate::model_context::tokenizer::{
    count_message_tokens, count_messages_tokens, count_tokens, count_tokens_for_model,
    MESSAGE_OVERHEAD_TOKENS, SAMPLE_THRESHOLD,
};
use crate::test_support::{assistant_msg, user_msg};
use serde_json::{json, Value};

// -- count_tokens --

#[test]
fn count_tokens_empty() {
    assert_eq!(count_tokens(""), 0);
}

#[test]
fn count_tokens_simple_english() {
    let count = count_tokens("Hello, world!");
    assert!(
        (3..=5).contains(&count),
        "expected 3-5 tokens for 'Hello, world!', got {count}"
    );
}

#[test]
fn count_tokens_longer_text_scales() {
    let short = count_tokens("hello");
    let long = count_tokens("hello world, this is a longer sentence with more tokens");
    assert!(long > short, "longer text should produce more tokens");
}

#[test]
fn count_tokens_code_snippet() {
    let code = "fn main() {\n    println!(\"Hello, world!\");\n}";
    let tokens = count_tokens(code);
    assert!(
        tokens > 5,
        "code should tokenize to at least a few tokens, got {tokens}"
    );
}

#[test]
fn count_tokens_whitespace_only() {
    let tokens = count_tokens("   \n\t\n   ");
    assert!(tokens > 0, "whitespace should still produce tokens");
}

#[test]
fn count_tokens_unicode() {
    let tokens = count_tokens("你好世界");
    assert!(tokens > 0, "CJK text should produce tokens");
}

#[test]
fn count_tokens_json_content() {
    let json_str = r#"{"file_path": "/src/main.rs", "content": "fn hello() {}"}"#;
    let tokens = count_tokens(json_str);
    assert!(tokens > 5, "JSON content should produce multiple tokens");
}

// -- count_tokens_for_model --

#[test]
fn count_tokens_for_model_gpt4o_uses_o200k() {
    let text = "The quick brown fox jumps over the lazy dog";
    let cl100k = count_tokens(text);
    let o200k = count_tokens_for_model(text, "gpt-4o-mini");
    assert!(cl100k > 0);
    assert!(o200k > 0);
}

#[test]
fn count_tokens_for_model_gpt5() {
    let tokens = count_tokens_for_model("hello world", "gpt-5-turbo");
    assert!(tokens > 0, "GPT-5 model should use o200k encoder");
}

#[test]
fn count_tokens_for_model_o_series() {
    let text = "test input";
    let o1 = count_tokens_for_model(text, "o1-preview");
    let o3 = count_tokens_for_model(text, "o3-mini");
    let o4 = count_tokens_for_model(text, "o4-mini");
    assert!(o1 > 0);
    assert!(o3 > 0);
    assert!(o4 > 0);
}

#[test]
fn count_tokens_for_model_claude_uses_cl100k() {
    let text = "test input";
    let claude = count_tokens_for_model(text, "claude-sonnet-4-20250514");
    let cl100k = count_tokens(text);
    assert_eq!(claude, cl100k, "Claude should fall back to cl100k");
}

#[test]
fn count_tokens_for_model_deepseek_uses_cl100k() {
    let text = "test input";
    let deepseek = count_tokens_for_model(text, "deepseek-chat");
    let cl100k = count_tokens(text);
    assert_eq!(deepseek, cl100k, "DeepSeek should fall back to cl100k");
}

// -- count_with_encoder (sampling) --

#[test]
fn sampling_large_text_returns_nonzero() {
    let large = "function hello() { return 42; }\n".repeat(5_000);
    assert!(
        large.len() > SAMPLE_THRESHOLD,
        "test text should exceed threshold"
    );
    let tokens = count_tokens(&large);
    assert!(
        tokens > 1000,
        "large text should produce many tokens, got {tokens}"
    );
}

#[test]
fn sampling_result_proportional_to_length() {
    let base = "The quick brown fox jumps over the lazy dog. ";
    let medium = base.repeat(200);
    let large = base.repeat(2000);
    assert!(large.len() > SAMPLE_THRESHOLD);
    let medium_tokens = count_tokens(&medium);
    let large_tokens = count_tokens(&large);
    let ratio = large_tokens as f64 / medium_tokens as f64;
    assert!(
        ratio > 5.0 && ratio < 15.0,
        "10x text should produce ~10x tokens, got ratio {ratio:.1}"
    );
}

// -- count_message_tokens --

#[test]
fn message_tokens_includes_overhead() {
    let msg = user_msg("hi");
    let content_tokens = count_tokens("hi");
    let total = count_message_tokens(&msg);
    assert_eq!(
        total,
        content_tokens + MESSAGE_OVERHEAD_TOKENS,
        "message tokens should equal content + overhead"
    );
}

#[test]
fn message_tokens_empty_content() {
    let msg = json!({"role": "assistant", "content": ""});
    let tokens = count_message_tokens(&msg);
    assert_eq!(
        tokens, MESSAGE_OVERHEAD_TOKENS,
        "empty content = overhead only"
    );
}

#[test]
fn message_tokens_no_content_field() {
    let msg = json!({"role": "assistant"});
    let tokens = count_message_tokens(&msg);
    assert_eq!(
        tokens, MESSAGE_OVERHEAD_TOKENS,
        "missing content = overhead only"
    );
}

#[test]
fn message_tokens_counts_structured_text_blocks() {
    let msg = json!({
        "role": "system",
        "content": [{
            "type": "text",
            "text": "compacted baseline summary"
        }]
    });
    let tokens = count_message_tokens(&msg);
    assert_eq!(
        tokens,
        count_tokens("compacted baseline summary") + MESSAGE_OVERHEAD_TOKENS
    );
}

#[test]
fn message_tokens_with_tool_calls() {
    let msg = json!({
        "role": "assistant",
        "content": "",
        "tool_calls": [{
            "function": {
                "name": "read_file",
                "arguments": "{\"path\": \"/tmp/test.txt\"}"
            }
        }]
    });
    let tokens = count_message_tokens(&msg);
    assert!(
        tokens > MESSAGE_OVERHEAD_TOKENS + 5,
        "tool calls should add tokens beyond overhead"
    );
}

#[test]
fn message_tokens_with_multiple_tool_calls() {
    let single = json!({
        "role": "assistant",
        "content": "",
        "tool_calls": [{
            "function": { "name": "read_file", "arguments": "{}" }
        }]
    });
    let double = json!({
        "role": "assistant",
        "content": "",
        "tool_calls": [
            { "function": { "name": "read_file", "arguments": "{}" } },
            { "function": { "name": "edit_file", "arguments": "{\"content\": \"hello\"}" } }
        ]
    });
    assert!(
        count_message_tokens(&double) > count_message_tokens(&single),
        "more tool calls should produce more tokens"
    );
}

#[test]
fn message_tokens_with_reasoning() {
    let reasoning = "Let me think step by step about this problem.".repeat(5);
    let msg = json!({
        "role": "assistant",
        "content": "answer",
        "reasoning_content": reasoning
    });
    let without = json!({"role": "assistant", "content": "answer"});
    assert!(
        count_message_tokens(&msg) > count_message_tokens(&without),
        "reasoning_content should add tokens"
    );
}

// -- count_messages_tokens --

#[test]
fn messages_tokens_empty_list() {
    assert_eq!(count_messages_tokens(&[]), 0);
}

#[test]
fn messages_tokens_sums_correctly() {
    let msgs = vec![user_msg("hello"), assistant_msg("world")];
    let total = count_messages_tokens(&msgs);
    let sum: usize = msgs.iter().map(count_message_tokens).sum();
    assert_eq!(total, sum);
}

#[test]
fn messages_tokens_scales_with_count() {
    let few: Vec<Value> = (0..3)
        .map(|idx| user_msg(&format!("message {idx}")))
        .collect();
    let many: Vec<Value> = (0..30)
        .map(|idx| user_msg(&format!("message {idx}")))
        .collect();
    assert!(
        count_messages_tokens(&many) > count_messages_tokens(&few) * 5,
        "10x messages should produce significantly more tokens"
    );
}

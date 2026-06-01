use std::collections::HashMap;
use std::sync::Mutex;

use async_trait::async_trait;
use serde_json::{json, Value};

use crate::core::side_query::{side_query, SideQueryConfig};
use crate::providers::traits::{LLMProvider, LLMResponse, ProviderError};

struct MockProvider {
    response_content: String,
    usage: HashMap<String, i64>,
    observed_messages: Mutex<Vec<Value>>,
    observed_tools_were_none: Mutex<bool>,
}

impl MockProvider {
    fn new(content: &str) -> Self {
        let mut usage = HashMap::new();
        usage.insert("prompt_tokens".to_string(), 100);
        usage.insert("completion_tokens".to_string(), 50);
        Self {
            response_content: content.to_string(),
            usage,
            observed_messages: Mutex::new(Vec::new()),
            observed_tools_were_none: Mutex::new(false),
        }
    }

    fn empty() -> Self {
        Self {
            response_content: String::new(),
            usage: HashMap::new(),
            observed_messages: Mutex::new(Vec::new()),
            observed_tools_were_none: Mutex::new(false),
        }
    }
}

#[async_trait]
impl LLMProvider for MockProvider {
    async fn chat(
        &self,
        messages: &[Value],
        tools: Option<&[Value]>,
        _model: &str,
        _max_tokens: u32,
        _temperature: f32,
    ) -> Result<LLMResponse, ProviderError> {
        *self.observed_messages.lock().unwrap() = messages.to_vec();
        *self.observed_tools_were_none.lock().unwrap() = tools.is_none();

        if self.response_content.is_empty() {
            Ok(LLMResponse {
                content: None,
                tool_calls: vec![],
                finish_reason: crate::providers::finish_reason::STOP.to_string(),
                usage: self.usage.clone(),
                reasoning_content: None,
                blocks: Vec::new(),
                stream_error_kind: None,
                retry_after_ms: None,
            })
        } else {
            Ok(LLMResponse {
                content: Some(self.response_content.clone()),
                tool_calls: vec![],
                finish_reason: crate::providers::finish_reason::STOP.to_string(),
                usage: self.usage.clone(),
                reasoning_content: None,
                blocks: Vec::new(),
                stream_error_kind: None,
                retry_after_ms: None,
            })
        }
    }

    fn default_model(&self) -> &str {
        "mock-model"
    }

    fn provider_name(&self) -> &str {
        "mock"
    }
}

#[tokio::test]
async fn returns_content_from_provider() {
    let provider = MockProvider::new("Classification: bug-fix");
    let messages = vec![json!({"role": "user", "content": "Classify this PR"})];
    let config = SideQueryConfig::default();

    let result = side_query(&provider, &messages, &config, "test-model")
        .await
        .unwrap();

    assert_eq!(result.content, "Classification: bug-fix");
    assert_eq!(result.prompt_tokens, 100);
    assert_eq!(result.completion_tokens, 50);
}

#[tokio::test]
async fn applies_default_config_values() {
    let config = SideQueryConfig::default();
    assert_eq!(config.max_tokens, 1024);
    assert_eq!(config.temperature, 0.0);
    assert!(config.model.is_none());
    assert!(config.system_prompt.is_none());
}

#[tokio::test]
async fn uses_custom_model_when_set() {
    let provider = MockProvider::new("ok");
    let messages = vec![json!({"role": "user", "content": "test"})];
    let config = SideQueryConfig {
        model: Some("custom-haiku".to_string()),
        ..SideQueryConfig::default()
    };

    let result = side_query(&provider, &messages, &config, "default-model").await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn includes_system_prompt_when_set() {
    let provider = MockProvider::new("summarized");
    let messages = vec![json!({"role": "user", "content": "Summarize this"})];
    let config = SideQueryConfig {
        system_prompt: Some("You are a summarizer".to_string()),
        ..SideQueryConfig::default()
    };

    let result = side_query(&provider, &messages, &config, "test-model")
        .await
        .unwrap();
    assert_eq!(result.content, "summarized");
}

#[tokio::test]
async fn sends_only_explicit_side_query_prompt_and_no_tools() {
    let provider = MockProvider::new("ok");
    let messages = vec![json!({"role": "user", "content": "Classify this"})];
    let config = SideQueryConfig {
        system_prompt: Some("Short classifier prompt".to_string()),
        ..SideQueryConfig::default()
    };

    side_query(&provider, &messages, &config, "test-model")
        .await
        .unwrap();

    let observed = provider.observed_messages.lock().unwrap().clone();
    assert_eq!(observed.len(), 2);
    assert_eq!(observed[0]["role"], "system");
    assert_eq!(observed[0]["content"], "Short classifier prompt");
    assert_eq!(observed[1]["content"], "Classify this");
    assert!(*provider.observed_tools_were_none.lock().unwrap());
    let serialized = serde_json::to_string(&observed).unwrap();
    assert!(!serialized.contains("IdentitySection"));
    assert!(!serialized.contains("You are ORGII"));
    assert!(!serialized.contains("read_file"));
}

#[tokio::test]
async fn returns_error_on_empty_content() {
    let provider = MockProvider::empty();
    let messages = vec![json!({"role": "user", "content": "test"})];
    let config = SideQueryConfig::default();

    let result = side_query(&provider, &messages, &config, "test-model").await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("empty content"));
}

#[tokio::test]
async fn handles_zero_usage_gracefully() {
    let mut provider = MockProvider::new("ok");
    provider.usage.clear();
    let messages = vec![json!({"role": "user", "content": "test"})];
    let config = SideQueryConfig::default();

    let result = side_query(&provider, &messages, &config, "test-model")
        .await
        .unwrap();
    assert_eq!(result.prompt_tokens, 0);
    assert_eq!(result.completion_tokens, 0);
}

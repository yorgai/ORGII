use serde_json::Value;

use crate::session::prompt::cache::ORGII_SYSTEM_CACHE_SCOPE_KEY;
use crate::tools::metadata::strip_tool_schema_cache_scope;

pub fn strip_tool_schema_cache_scopes(tools: &[Value]) -> Vec<Value> {
    tools
        .iter()
        .map(|tool| {
            let mut tool = tool.clone();
            strip_tool_schema_cache_scope(&mut tool);
            tool
        })
        .collect()
}

pub fn sanitize_openai_compat_messages(messages: &[Value]) -> Vec<Value> {
    messages.iter().map(sanitize_message).collect()
}

fn sanitize_message(message: &Value) -> Value {
    let mut sanitized = message.clone();
    let role = sanitized
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let Some(content) = sanitized.get_mut("content") else {
        return sanitized;
    };

    if role == "system" || role == "developer" {
        if let Some(text) = flatten_text_content(content) {
            *content = Value::String(text);
        }
        return sanitized;
    }

    strip_content_cache_metadata(content);
    sanitized
}

pub fn flatten_text_content(content: &Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }

    let blocks = content.as_array()?;
    let text = blocks
        .iter()
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n\n");
    Some(text)
}

fn strip_content_cache_metadata(content: &mut Value) {
    let Some(blocks) = content.as_array_mut() else {
        return;
    };

    for block in blocks {
        if let Some(object) = block.as_object_mut() {
            object.remove(ORGII_SYSTEM_CACHE_SCOPE_KEY);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sanitize_openai_compat_messages_flattens_structured_system_cache_blocks() {
        let messages = vec![json!({
            "role": "system",
            "content": [
                {
                    "type": "text",
                    "text": "Stable summary",
                    (ORGII_SYSTEM_CACHE_SCOPE_KEY): "session"
                },
                {
                    "type": "text",
                    "text": "Rules snapshot",
                    (ORGII_SYSTEM_CACHE_SCOPE_KEY): "org"
                }
            ]
        })];

        let sanitized = sanitize_openai_compat_messages(&messages);

        assert_eq!(sanitized[0]["content"], "Stable summary\n\nRules snapshot");
        assert!(messages[0]["content"][0][ORGII_SYSTEM_CACHE_SCOPE_KEY].is_string());
    }

    #[test]
    fn sanitize_openai_compat_messages_strips_cache_metadata_from_user_blocks() {
        let messages = vec![json!({
            "role": "user",
            "content": [{
                "type": "text",
                "text": "Hello",
                (ORGII_SYSTEM_CACHE_SCOPE_KEY): "volatile"
            }]
        })];

        let sanitized = sanitize_openai_compat_messages(&messages);

        assert_eq!(sanitized[0]["content"][0]["text"], "Hello");
        assert!(sanitized[0]["content"][0]
            .get(ORGII_SYSTEM_CACHE_SCOPE_KEY)
            .is_none());
    }

    #[test]
    fn strip_tool_schema_cache_scopes_removes_internal_tool_metadata() {
        let tools = vec![json!({
            "type": "function",
            "function": { "name": "read_file" },
            (crate::tools::metadata::ORGII_TOOL_SCHEMA_CACHE_SCOPE_KEY): "stable_prefix"
        })];

        let sanitized = strip_tool_schema_cache_scopes(&tools);

        assert!(sanitized[0]
            .get(crate::tools::metadata::ORGII_TOOL_SCHEMA_CACHE_SCOPE_KEY)
            .is_none());
        assert!(tools[0]
            .get(crate::tools::metadata::ORGII_TOOL_SCHEMA_CACHE_SCOPE_KEY)
            .is_some());
    }
}

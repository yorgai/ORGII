//! OpenAI-compatible wire expansion for rich tool output.
//!
//! Translates the `_orgii_structured` sidecar attached
//! to `role: "tool"` messages (by
//! `turn_executor::helpers::add_tool_result_rich_with_timestamp`) into a
//! shape OpenAI Chat Completions understands.
//!
//! The OpenAI `role: "tool"` message schema is text-only (its `content`
//! must be a string). Images must be delivered via a separate
//! `role: "user"` message whose `content` is an array of content blocks
//! (`{"type": "image_url", "image_url": {"url": "data:<mime>;base64,<b64>"}}`).
//!
//! This differs from Anthropic-native, where `tool_result` blocks can host
//! sibling `image` blocks directly inside the same `user.content[]` array —
//! handled in `anthropic_native::client::extract_system`.
//!
//! ## Design
//!
//! - Pure function over `Vec<Value>`. Never mutates the source vec; returns
//!   a new vec only when at least one expansion happened, so the common
//!   (no-image) path is zero-copy on allocation size.
//! - Called unconditionally by every OpenAI-compat send path. We do not
//!   try to predict whether the model supports vision — proxies, custom
//!   deployment names, and future model families make keyword allow-lists
//!   a silent-image-drop footgun. If the target model does not accept
//!   images, the API returns a 400 with a clear message (fail-loud) —
//!   which is strictly better than dropping user images in silence.
//! - The sidecar field stays on the original tool message intact. OpenAI
//!   Chat Completions explicitly ignores unknown JSON fields, so leaving
//!   `_orgii_structured` in place is harmless and useful for debugging.
//! - Only `ToolContentBlock::Image` is lifted. Audio, resource, and
//!   resource_link blocks remain represented by the breadcrumb text that
//!   already sits in `content`.

use serde_json::Value;

use crate::turn_executor::helpers::STRUCTURED_SIDECAR_KEY;

/// Data URL MIME fallback when the sidecar's `mime_type` is missing or
/// malformed. PNG is the most common MCP return type and round-trips
/// losslessly through every known vision API.
const FALLBACK_MIME: &str = "image/png";

/// Expand MCP image sidecars into OpenAI-compat vision messages.
///
/// Scans `messages` for `role: "tool"` entries that carry a
/// `_orgii_structured.content_blocks[]` array with any `type: "image"`
/// block. For each such message, appends a follow-up `role: "user"`
/// message immediately after it whose `content` is an array of
/// `image_url` blocks, one per image block. The original tool message
/// is preserved verbatim (sidecar and all).
///
/// Returns a newly allocated `Vec<Value>` only when at least one tool
/// message needed expansion. Otherwise returns the input cloned once,
/// letting the caller preserve its existing lifetime model.
///
/// The follow-up `user` message deliberately carries a minimal text block
/// (`"Image(s) from the previous tool call."`) alongside the image blocks,
/// because several OpenAI-compatible endpoints (notably Azure OpenAI and
/// some OpenRouter routes) reject a `user` message whose `content` is an
/// array with zero text parts.
pub fn expand_tool_images_for_openai_wire(messages: &[Value]) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::with_capacity(messages.len());

    for msg in messages {
        out.push(msg.clone());

        let role = msg.get("role").and_then(Value::as_str).unwrap_or("");
        if role != "tool" {
            continue;
        }

        let Some(sidecar) = msg.get(STRUCTURED_SIDECAR_KEY) else {
            continue;
        };
        let Some(blocks) = sidecar.get("content_blocks").and_then(Value::as_array) else {
            continue;
        };

        let image_blocks = extract_image_blocks(blocks);
        if image_blocks.is_empty() {
            continue;
        }

        out.push(build_image_followup_user_message(&image_blocks));
    }

    out
}

/// Collect `{mime_type, data}` tuples for each `type: "image"` block.
fn extract_image_blocks(blocks: &[Value]) -> Vec<(String, String)> {
    blocks
        .iter()
        .filter_map(|block| {
            let ty = block.get("type").and_then(Value::as_str)?;
            if ty != "image" {
                return None;
            }
            let data = block.get("data").and_then(Value::as_str)?.to_string();
            if data.is_empty() {
                return None;
            }
            let mime = block
                .get("mime_type")
                .and_then(Value::as_str)
                .filter(|m| !m.is_empty())
                .unwrap_or(FALLBACK_MIME)
                .to_string();
            Some((mime, data))
        })
        .collect()
}

/// Build a `role: "user"` message whose `content` is an array of
/// `image_url` content blocks plus a short text preamble, matching the
/// [OpenAI vision guide](https://platform.openai.com/docs/guides/vision).
fn build_image_followup_user_message(images: &[(String, String)]) -> Value {
    let mut content: Vec<Value> = Vec::with_capacity(images.len() + 1);
    content.push(serde_json::json!({
        "type": "text",
        "text": "Image(s) from the previous tool call.",
    }));
    for (mime, data) in images {
        content.push(serde_json::json!({
            "type": "image_url",
            "image_url": {
                "url": format!("data:{};base64,{}", mime, data),
            },
        }));
    }
    serde_json::json!({
        "role": "user",
        "content": content,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tool_msg_no_sidecar() -> Value {
        json!({
            "role": "tool",
            "tool_call_id": "t1",
            "name": "read_file",
            "content": "file contents",
        })
    }

    fn tool_msg_with_image(mime: &str, data: &str) -> Value {
        json!({
            "role": "tool",
            "tool_call_id": "t2",
            "name": "mcp__foo__bar",
            "content": "[image breadcrumb]",
            STRUCTURED_SIDECAR_KEY: {
                "content_blocks": [
                    { "type": "image", "mime_type": mime, "data": data }
                ]
            }
        })
    }

    #[test]
    fn no_tool_messages_passes_through() {
        let input = vec![
            json!({"role": "system", "content": "sys"}),
            json!({"role": "user", "content": "hi"}),
            json!({"role": "assistant", "content": "hello"}),
        ];
        let out = expand_tool_images_for_openai_wire(&input);
        assert_eq!(out, input);
    }

    #[test]
    fn tool_without_sidecar_passes_through() {
        let input = vec![
            json!({"role": "user", "content": "run foo"}),
            tool_msg_no_sidecar(),
        ];
        let out = expand_tool_images_for_openai_wire(&input);
        assert_eq!(out, input);
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn tool_with_sidecar_but_no_image_passes_through() {
        let tool = json!({
            "role": "tool",
            "tool_call_id": "t",
            "name": "mcp__x__y",
            "content": "text only",
            STRUCTURED_SIDECAR_KEY: {
                "content_blocks": [
                    { "type": "audio", "mime_type": "audio/wav", "data": "AAAA" }
                ]
            }
        });
        let input = vec![tool.clone()];
        let out = expand_tool_images_for_openai_wire(&input);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0], tool);
    }

    #[test]
    fn single_image_appends_followup_user() {
        let input = vec![
            json!({"role": "user", "content": "take screenshot"}),
            tool_msg_with_image("image/png", "AAAA"),
        ];
        let out = expand_tool_images_for_openai_wire(&input);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0]["role"], "user");
        assert_eq!(out[1]["role"], "tool");
        assert_eq!(out[2]["role"], "user");

        let content = out[2]["content"].as_array().expect("array content");
        assert_eq!(content.len(), 2);
        assert_eq!(content[0]["type"], "text");
        assert_eq!(content[1]["type"], "image_url");
        assert_eq!(content[1]["image_url"]["url"], "data:image/png;base64,AAAA");
    }

    #[test]
    fn multiple_images_same_tool_same_followup() {
        let tool = json!({
            "role": "tool",
            "tool_call_id": "t",
            "name": "mcp__x__y",
            "content": "[two images]",
            STRUCTURED_SIDECAR_KEY: {
                "content_blocks": [
                    { "type": "image", "mime_type": "image/png", "data": "AAA" },
                    { "type": "text", "text": "middle text" },
                    { "type": "image", "mime_type": "image/jpeg", "data": "BBB" }
                ]
            }
        });
        let input = vec![tool];
        let out = expand_tool_images_for_openai_wire(&input);
        assert_eq!(out.len(), 2);

        let content = out[1]["content"].as_array().expect("array content");
        assert_eq!(content.len(), 3);
        assert_eq!(content[0]["type"], "text");
        assert_eq!(content[1]["image_url"]["url"], "data:image/png;base64,AAA");
        assert_eq!(content[2]["image_url"]["url"], "data:image/jpeg;base64,BBB");
    }

    #[test]
    fn multiple_tool_messages_each_get_own_followup() {
        let input = vec![
            tool_msg_with_image("image/png", "AAA"),
            json!({"role": "assistant", "content": "ok"}),
            tool_msg_with_image("image/gif", "BBB"),
        ];
        let out = expand_tool_images_for_openai_wire(&input);
        assert_eq!(out.len(), 5);
        assert_eq!(out[0]["role"], "tool");
        assert_eq!(out[1]["role"], "user");
        assert_eq!(out[2]["role"], "assistant");
        assert_eq!(out[3]["role"], "tool");
        assert_eq!(out[4]["role"], "user");
    }

    #[test]
    fn empty_data_string_skipped() {
        let tool = json!({
            "role": "tool",
            "tool_call_id": "t",
            "name": "mcp__x__y",
            "content": "",
            STRUCTURED_SIDECAR_KEY: {
                "content_blocks": [
                    { "type": "image", "mime_type": "image/png", "data": "" }
                ]
            }
        });
        let input = vec![tool.clone()];
        let out = expand_tool_images_for_openai_wire(&input);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0], tool);
    }

    #[test]
    fn missing_mime_uses_fallback() {
        let tool = json!({
            "role": "tool",
            "tool_call_id": "t",
            "name": "mcp__x__y",
            "content": "",
            STRUCTURED_SIDECAR_KEY: {
                "content_blocks": [
                    { "type": "image", "data": "CCC" }
                ]
            }
        });
        let input = vec![tool];
        let out = expand_tool_images_for_openai_wire(&input);
        assert_eq!(out.len(), 2);
        let content = out[1]["content"].as_array().unwrap();
        assert_eq!(content[1]["image_url"]["url"], "data:image/png;base64,CCC");
    }

    #[test]
    fn sidecar_preserved_on_original_tool_message() {
        let tool = tool_msg_with_image("image/png", "AAA");
        let input = vec![tool.clone()];
        let out = expand_tool_images_for_openai_wire(&input);
        assert_eq!(out[0], tool, "original tool msg should be unchanged");
        assert!(out[0].get(STRUCTURED_SIDECAR_KEY).is_some());
    }
}

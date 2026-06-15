use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::Value;

use super::request::GeminiContent;
use crate::providers::traits::{
    finish_reason, usage_key, LLMResponse, ProviderError, StreamDelta, StreamErrorKind,
    ToolCallDelta, ToolCallRequest,
};
use crate::utils::http_retry::extract_retry_after_secs;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodeAssistResponse {
    response: Option<GenerateContentResponse>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateContentResponse {
    #[serde(default)]
    candidates: Vec<GeminiCandidate>,
    usage_metadata: Option<GeminiUsageMetadata>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiCandidate {
    content: Option<GeminiContent>,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiUsageMetadata {
    prompt_token_count: Option<i64>,
    candidates_token_count: Option<i64>,
    total_token_count: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct ErrorEnvelope {
    error: Option<ErrorBody>,
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ErrorBody {
    message: Option<String>,
    status: Option<String>,
    code: Option<i32>,
    #[serde(default)]
    details: Vec<Value>,
}

pub(super) async fn parse_http_response(
    response: reqwest::Response,
) -> Result<LLMResponse, ProviderError> {
    let status = response.status();
    let retry_after = extract_retry_after_secs(&response);
    let body = response
        .text()
        .await
        .map_err(|err| ProviderError::RequestFailed(err.to_string()))?;
    if !status.is_success() {
        let error = map_error(status.as_u16(), &body, retry_after);
        tracing::warn!(
            "[gemini_native] non-success response status={} error={}",
            status,
            error
        );
        #[cfg(debug_assertions)]
        eprintln!(
            "[gemini_native] non-success response status={} error={}",
            status, error
        );
        return Err(error);
    }
    let parsed: CodeAssistResponse = serde_json::from_str(&body)
        .map_err(|err| ProviderError::ParseError(format!("Gemini response parse failed: {err}")))?;
    let tool_call_id_prefix = gemini_tool_call_id_prefix();
    Ok(response_to_llm(
        parsed.response.unwrap_or(GenerateContentResponse {
            candidates: Vec::new(),
            usage_metadata: None,
        }),
        &tool_call_id_prefix,
    ))
}

pub(super) async fn parse_streaming_response(
    response: reqwest::Response,
    on_delta: &(dyn Fn(StreamDelta) + Send + Sync),
    cancel_flag: Option<&AtomicBool>,
) -> Result<LLMResponse, ProviderError> {
    let status = response.status();
    let retry_after = extract_retry_after_secs(&response);
    if !status.is_success() {
        let body = response
            .text()
            .await
            .map_err(|err| ProviderError::RequestFailed(err.to_string()))?;
        let error = map_error(status.as_u16(), &body, retry_after);
        tracing::warn!(
            "[gemini_native] non-success stream response status={} error={}",
            status,
            error
        );
        #[cfg(debug_assertions)]
        eprintln!(
            "[gemini_native] non-success stream response status={} error={}",
            status, error
        );
        return Err(error);
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut aggregate = GenerateContentResponse {
        candidates: Vec::new(),
        usage_metadata: None,
    };
    let mut emitted_text_len = 0usize;
    let mut emitted_tool_calls = 0usize;
    let mut stream_error_kind = None;
    let mut unknown_frame_count = 0usize;
    let tool_call_id_prefix = gemini_tool_call_id_prefix();
    const CHUNK_READ_TIMEOUT: Duration = Duration::from_secs(90);

    loop {
        if cancel_flag.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            drop(stream);
            return Err(ProviderError::Cancelled);
        }

        let chunk_result = match tokio::time::timeout(CHUNK_READ_TIMEOUT, stream.next()).await {
            Ok(Some(result)) => result,
            Ok(None) => break,
            Err(_elapsed) => {
                if has_response_data(&aggregate) {
                    stream_error_kind = Some(StreamErrorKind::IdleTimeout);
                    break;
                }
                return Err(ProviderError::RequestFailed(format!(
                    "Gemini native stream timed out: no data received for {}s",
                    CHUNK_READ_TIMEOUT.as_secs()
                )));
            }
        };

        let chunk = match chunk_result {
            Ok(bytes) => bytes,
            Err(err) => {
                if has_response_data(&aggregate) {
                    stream_error_kind = Some(StreamErrorKind::ConnectionError);
                    break;
                }
                return Err(ProviderError::RequestFailed(format!("Stream error: {err}")));
            }
        };

        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();
            if line.is_empty() || line.starts_with(':') || line.starts_with("event:") {
                continue;
            }
            if !line.starts_with("data:") {
                continue;
            }
            let data = line["data:".len()..].trim_start();
            if data == "[DONE]" {
                break;
            }
            if let Some(frame) = parse_stream_frame(data)? {
                merge_stream_frame(&mut aggregate, frame);
                emit_new_stream_deltas(
                    &aggregate,
                    on_delta,
                    &mut emitted_text_len,
                    &mut emitted_tool_calls,
                    &tool_call_id_prefix,
                );
            } else {
                unknown_frame_count += 1;
                tracing::warn!(
                    sample = %bounded_gemini_frame_sample(data),
                    "[gemini_native] stream frame did not contain response"
                );
            }
        }
    }

    if unknown_frame_count > 0 {
        tracing::warn!(
            unknown_frame_count,
            "[gemini_native] stream completed with unparsed non-response frame(s)"
        );
    }

    let mut llm = response_to_llm(aggregate, &tool_call_id_prefix);
    if let Some(kind) = stream_error_kind {
        llm.finish_reason = finish_reason::STREAM_ERROR.to_string();
        llm.stream_error_kind = Some(kind);
    }
    on_delta(StreamDelta {
        content: None,
        reasoning: None,
        tool_call_delta: None,
        finish_reason: Some(llm.finish_reason.clone()),
        usage: Some(llm.usage.clone()),
    });
    Ok(llm)
}

fn parse_stream_frame(data: &str) -> Result<Option<GenerateContentResponse>, ProviderError> {
    let parsed: CodeAssistResponse = serde_json::from_str(data).map_err(|err| {
        ProviderError::ParseError(format!("Gemini stream frame parse failed: {err}"))
    })?;
    Ok(parsed.response)
}

fn bounded_gemini_frame_sample(data: &str) -> String {
    crate::utils::safe_truncate_chars(data, 500).to_string()
}

fn response_to_llm(response: GenerateContentResponse, tool_call_id_prefix: &str) -> LLMResponse {
    let content = collect_text(&response);
    let tool_calls = collect_tool_calls(&response, tool_call_id_prefix);
    let finish = if tool_calls.is_empty() {
        response
            .candidates
            .first()
            .and_then(|candidate| candidate.finish_reason.as_deref())
            .map(map_finish_reason)
            .unwrap_or_else(|| finish_reason::STOP.to_string())
    } else {
        finish_reason::TOOL_CALLS.to_string()
    };

    LLMResponse {
        content: if content.is_empty() {
            None
        } else {
            Some(content)
        },
        tool_calls,
        finish_reason: finish,
        usage: usage_from_metadata(response.usage_metadata.as_ref()),
        reasoning_content: None,
        blocks: Vec::new(),
        stream_error_kind: None,
        retry_after_ms: None,
    }
}

fn merge_stream_frame(target: &mut GenerateContentResponse, frame: GenerateContentResponse) {
    target.candidates.extend(frame.candidates);
    if frame.usage_metadata.is_some() {
        target.usage_metadata = frame.usage_metadata;
    }
}

fn has_response_data(response: &GenerateContentResponse) -> bool {
    response.candidates.iter().any(|candidate| {
        candidate.content.as_ref().is_some_and(|content| {
            content.parts.iter().any(|part| {
                part.text.as_deref().is_some_and(|text| !text.is_empty())
                    || part.function_call.is_some()
            })
        })
    })
}

fn emit_new_stream_deltas(
    response: &GenerateContentResponse,
    on_delta: &(dyn Fn(StreamDelta) + Send + Sync),
    emitted_text_len: &mut usize,
    emitted_tool_calls: &mut usize,
    tool_call_id_prefix: &str,
) {
    let text = collect_text(response);
    if text.len() > *emitted_text_len {
        let delta = text[*emitted_text_len..].to_string();
        *emitted_text_len = text.len();
        on_delta(StreamDelta {
            content: Some(delta),
            reasoning: None,
            tool_call_delta: None,
            finish_reason: None,
            usage: None,
        });
    }

    let tool_calls = collect_tool_calls(response, tool_call_id_prefix);
    for (index, call) in tool_calls.iter().enumerate().skip(*emitted_tool_calls) {
        *emitted_tool_calls = index + 1;
        on_delta(StreamDelta {
            content: None,
            reasoning: None,
            tool_call_delta: Some(ToolCallDelta {
                index,
                id: Some(call.id.clone()),
                name: Some(call.name.clone()),
                arguments_delta: Some(call.arguments.to_string()),
            }),
            finish_reason: None,
            usage: None,
        });
    }
}

fn collect_text(response: &GenerateContentResponse) -> String {
    response
        .candidates
        .iter()
        .filter_map(|candidate| candidate.content.as_ref())
        .flat_map(|content| content.parts.iter())
        .filter_map(|part| part.text.as_deref())
        .collect::<Vec<_>>()
        .join("")
}

fn collect_tool_calls(
    response: &GenerateContentResponse,
    tool_call_id_prefix: &str,
) -> Vec<ToolCallRequest> {
    response
        .candidates
        .iter()
        .filter_map(|candidate| candidate.content.as_ref())
        .flat_map(|content| content.parts.iter())
        .filter_map(|part| {
            part.function_call
                .as_ref()
                .map(|function_call| (part, function_call))
        })
        .enumerate()
        .map(|(index, (part, call))| ToolCallRequest {
            id: format!("{tool_call_id_prefix}-{}", index + 1),
            name: call.name.clone(),
            arguments: call.args.clone(),
            thought_signature: part.thought_signature.clone(),
        })
        .collect()
}

fn gemini_tool_call_id_prefix() -> String {
    format!("gemini-call-{}", uuid::Uuid::new_v4().simple())
}

fn usage_from_metadata(metadata: Option<&GeminiUsageMetadata>) -> HashMap<String, i64> {
    let mut usage = HashMap::new();
    let Some(metadata) = metadata else {
        return usage;
    };
    if let Some(value) = metadata.prompt_token_count {
        usage.insert(usage_key::PROMPT_TOKENS.to_string(), value);
    }
    if let Some(value) = metadata.candidates_token_count {
        usage.insert(usage_key::COMPLETION_TOKENS.to_string(), value);
    }
    if let Some(value) = metadata.total_token_count {
        usage.insert(usage_key::TOTAL_TOKENS.to_string(), value);
    }
    usage
}

fn map_finish_reason(reason: &str) -> String {
    match reason {
        "STOP" => finish_reason::STOP.to_string(),
        "MAX_TOKENS" => finish_reason::LENGTH.to_string(),
        "SAFETY" | "RECITATION" => finish_reason::CONTENT_FILTER.to_string(),
        other => other.to_lowercase(),
    }
}

fn map_error(status: u16, body: &str, retry_after_secs: Option<u64>) -> ProviderError {
    let parsed_error = serde_json::from_str::<ErrorEnvelope>(body).ok();
    let detail_summary = parsed_error
        .as_ref()
        .and_then(|error| error.error.as_ref())
        .map(error_detail_summary);
    let message = parsed_error
        .and_then(|error| {
            error
                .error
                .and_then(|inner| {
                    inner
                        .message
                        .or(inner.status)
                        .or_else(|| inner.code.map(|code| code.to_string()))
                })
                .or(error.message)
        })
        .unwrap_or_else(|| crate::providers::http_error_body::clean_error_message(status, body));
    let retry_after_secs = retry_after_secs
        .or_else(|| {
            detail_summary
                .as_ref()
                .and_then(|summary| summary.retry_after_secs)
        })
        .or_else(|| quota_reset_after_secs(&message));
    let message = if let Some(summary) = detail_summary {
        summary.append_to_message(message)
    } else {
        message
    };
    match status {
        401 | 403 => ProviderError::AuthError(message),
        404 => ProviderError::ModelNotFound(message),
        429 => ProviderError::RateLimited {
            message,
            retry_after_secs,
        },
        500 | 502 | 503 | 504 => ProviderError::Overloaded {
            message,
            retry_after_secs,
        },
        _ => ProviderError::Other(message),
    }
}

#[derive(Debug, Default)]
struct ErrorDetailSummary {
    reasons: Vec<String>,
    quota_violations: Vec<String>,
    retry_after_secs: Option<u64>,
}

impl ErrorDetailSummary {
    fn append_to_message(&self, message: String) -> String {
        let mut parts = Vec::new();
        if !self.reasons.is_empty() {
            parts.push(format!("reasons={}", self.reasons.join(",")));
        }
        if !self.quota_violations.is_empty() {
            parts.push(format!(
                "quota_violations={}",
                self.quota_violations.join(" | ")
            ));
        }
        if let Some(retry_after_secs) = self.retry_after_secs {
            parts.push(format!("retry_info={}s", retry_after_secs));
        }
        if parts.is_empty() {
            message
        } else {
            format!("{} [{}]", message, parts.join("; "))
        }
    }
}

fn error_detail_summary(error: &ErrorBody) -> ErrorDetailSummary {
    let mut summary = ErrorDetailSummary::default();
    for detail in &error.details {
        let detail_type = detail
            .get("@type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match detail_type {
            "type.googleapis.com/google.rpc.ErrorInfo" => {
                if let Some(reason) = detail.get("reason").and_then(Value::as_str) {
                    summary.reasons.push(reason.to_string());
                }
                if let Some(quota_limit) = detail
                    .get("metadata")
                    .and_then(|metadata| metadata.get("quota_limit"))
                    .and_then(Value::as_str)
                {
                    summary.quota_violations.push(quota_limit.to_string());
                }
            }
            "type.googleapis.com/google.rpc.QuotaFailure" => {
                if let Some(violations) = detail.get("violations").and_then(Value::as_array) {
                    for violation in violations {
                        let quota_id = violation
                            .get("quotaId")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        let description = violation
                            .get("description")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        let rendered = format!("{} {}", quota_id, description).trim().to_string();
                        if !rendered.is_empty() {
                            summary.quota_violations.push(rendered);
                        }
                    }
                }
            }
            "type.googleapis.com/google.rpc.RetryInfo" => {
                summary.retry_after_secs = detail
                    .get("retryDelay")
                    .and_then(retry_delay_value_secs)
                    .or(summary.retry_after_secs);
            }
            _ => {}
        }
    }
    summary
}

fn retry_delay_value_secs(value: &Value) -> Option<u64> {
    if let Some(text) = value.as_str() {
        return retry_delay_text_secs(text);
    }
    let seconds = value.get("seconds").and_then(Value::as_u64).unwrap_or(0);
    let nanos = value.get("nanos").and_then(Value::as_u64).unwrap_or(0);
    if seconds == 0 && nanos == 0 {
        None
    } else {
        Some(seconds + u64::from(nanos > 0))
    }
}

fn retry_delay_text_secs(text: &str) -> Option<u64> {
    let trimmed = text.trim();
    if let Some(milliseconds) = trimmed.strip_suffix("ms") {
        let value = milliseconds.parse::<f64>().ok()?;
        return Some((value / 1000.0).ceil().max(1.0) as u64);
    }
    let seconds = trimmed.strip_suffix('s')?.parse::<f64>().ok()?;
    Some(seconds.ceil().max(1.0) as u64)
}

fn quota_reset_after_secs(message: &str) -> Option<u64> {
    let marker = "quota will reset after ";
    let lower = message.to_lowercase();
    let start = lower.find(marker)? + marker.len();
    let digits = lower[start..]
        .chars()
        .skip_while(|character| character.is_whitespace())
        .take_while(|character| character.is_ascii_digit())
        .collect::<String>();
    digits.parse::<u64>().ok()
}

#[cfg(test)]
mod tests {
    use super::{
        map_error, parse_stream_frame, quota_reset_after_secs, response_to_llm, GeminiCandidate,
        GeminiUsageMetadata, GenerateContentResponse,
    };
    use crate::core::providers::gemini_native::request::{
        GeminiContent, GeminiFunctionCall, GeminiPart,
    };
    use crate::providers::traits::{finish_reason, usage_key};
    use serde_json::json;

    #[test]
    fn response_maps_text_tool_calls_finish_and_usage() {
        let response = GenerateContentResponse {
            candidates: vec![GeminiCandidate {
                content: Some(GeminiContent {
                    role: "model".to_string(),
                    parts: vec![
                        GeminiPart {
                            text: Some("I will inspect it.".to_string()),
                            function_call: None,
                            function_response: None,
                            thought_signature: None,
                        },
                        GeminiPart {
                            text: None,
                            function_call: Some(GeminiFunctionCall {
                                name: "read_file".to_string(),
                                args: json!({ "path": "src/main.rs" }),
                            }),
                            function_response: None,
                            thought_signature: Some(json!("gemini-thought-sig")),
                        },
                    ],
                }),
                finish_reason: Some("STOP".to_string()),
            }],
            usage_metadata: Some(GeminiUsageMetadata {
                prompt_token_count: Some(10),
                candidates_token_count: Some(5),
                total_token_count: Some(15),
            }),
        };

        let llm = response_to_llm(response, "gemini-call-test-prefix");
        assert_eq!(llm.content.as_deref(), Some("I will inspect it."));
        assert_eq!(llm.finish_reason, finish_reason::TOOL_CALLS);
        assert_eq!(llm.tool_calls.len(), 1);
        assert_eq!(llm.tool_calls[0].id, "gemini-call-test-prefix-1");
        assert_eq!(llm.tool_calls[0].name, "read_file");
        assert_eq!(llm.tool_calls[0].arguments["path"], "src/main.rs");
        assert_eq!(
            llm.tool_calls[0].thought_signature,
            Some(json!("gemini-thought-sig"))
        );
        assert_eq!(llm.usage[usage_key::PROMPT_TOKENS], 10);
        assert_eq!(llm.usage[usage_key::COMPLETION_TOKENS], 5);
        assert_eq!(llm.usage[usage_key::TOTAL_TOKENS], 15);
    }

    #[test]
    fn stream_frame_without_response_is_unknown_but_later_response_parses() {
        let unknown = parse_stream_frame(r#"{"metadata":{"event":"heartbeat"}}"#)
            .expect("metadata-only frame should parse as an unknown frame");
        let response = parse_stream_frame(
            r#"{
                "response": {
                    "candidates": [
                        {
                            "content": {
                                "role": "model",
                                "parts": [{ "text": "Gemini streamed text" }]
                            },
                            "finishReason": "STOP"
                        }
                    ]
                }
            }"#,
        )
        .expect("response frame should parse")
        .expect("response frame should contain response data");

        assert!(unknown.is_none());
        let llm = response_to_llm(response, "gemini-call-test-prefix");
        assert_eq!(llm.content.as_deref(), Some("Gemini streamed text"));
    }

    #[test]
    fn quota_reset_after_secs_parses_code_assist_message() {
        assert_eq!(
            quota_reset_after_secs(
                "You have exhausted your capacity on this model. Your quota will reset after 37s."
            ),
            Some(37)
        );
    }

    #[test]
    fn rate_limit_error_preserves_body_retry_after_hint() {
        let err = map_error(
            429,
            r#"{"error":{"message":"You have exhausted your capacity on this model. Your quota will reset after 7s."}}"#,
            None,
        );
        match err {
            crate::providers::traits::ProviderError::RateLimited {
                retry_after_secs, ..
            } => assert_eq!(retry_after_secs, Some(7)),
            other => panic!("expected RateLimited, got {other:?}"),
        }
    }

    #[test]
    fn rate_limit_error_includes_code_assist_detail_reasons() {
        let err = map_error(
            429,
            r#"{
                "error": {
                    "message": "capacity exhausted",
                    "details": [
                        {
                            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                            "reason": "MODEL_CAPACITY_EXHAUSTED",
                            "domain": "cloudcode-pa.googleapis.com",
                            "metadata": { "quota_limit": "GenerateRequestsPerMinute" }
                        },
                        {
                            "@type": "type.googleapis.com/google.rpc.RetryInfo",
                            "retryDelay": "2.5s"
                        }
                    ]
                }
            }"#,
            None,
        );
        match err {
            crate::providers::traits::ProviderError::RateLimited {
                message,
                retry_after_secs,
            } => {
                assert_eq!(retry_after_secs, Some(3));
                assert!(message.contains("MODEL_CAPACITY_EXHAUSTED"));
                assert!(message.contains("GenerateRequestsPerMinute"));
            }
            other => panic!("expected RateLimited, got {other:?}"),
        }
    }
}

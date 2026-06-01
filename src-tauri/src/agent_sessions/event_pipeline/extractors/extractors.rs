//! Data Extractors
//!
//! Rust port of the TypeScript `dataExtractors.ts`.
//! Pulls structured rendering data from SessionEvent args/result fields.

use std::collections::HashMap;
use std::sync::LazyLock;

use crate::agent_sessions::event_pipeline::extractors::types::*;
use crate::agent_sessions::event_pipeline::types::{EventDisplayVariant, SessionEvent};
use agent_core::core::tools::builtin_tools::resolve_effective_app_subtool;
use agent_core::core::tools::names as tool_names;
use agent_core::core::tools::ui_metadata::AppSubtool;
use perf_utils::diff_patch::{convert_patch_to_unified, PatchSegment};

// ============================================================================
// Language Detection
// ============================================================================

static LANG_MAP: LazyLock<HashMap<&'static str, &'static str>> = LazyLock::new(|| {
    let mut m = HashMap::new();
    m.insert("ts", "typescript");
    m.insert("tsx", "typescript");
    m.insert("js", "javascript");
    m.insert("jsx", "javascript");
    m.insert("py", "python");
    m.insert("rs", "rust");
    m.insert("go", "go");
    m.insert("java", "java");
    m.insert("rb", "ruby");
    m.insert("php", "php");
    m.insert("css", "css");
    m.insert("scss", "scss");
    m.insert("html", "html");
    m.insert("json", "json");
    m.insert("yaml", "yaml");
    m.insert("yml", "yaml");
    m.insert("md", "markdown");
    m.insert("sh", "bash");
    m.insert("sql", "sql");
    m.insert("toml", "toml");
    m.insert("xml", "xml");
    m.insert("c", "c");
    m.insert("cpp", "cpp");
    m.insert("h", "c");
    m.insert("hpp", "cpp");
    m.insert("cs", "csharp");
    m.insert("swift", "swift");
    m.insert("kt", "kotlin");
    m
});

pub(crate) fn detect_language(file_name: &str) -> &'static str {
    let ext = file_name.rsplit('.').next().unwrap_or("");
    LANG_MAP.get(ext).copied().unwrap_or("plaintext")
}

// ============================================================================
// Safe Value Helpers
// ============================================================================

fn safe_str(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Object(obj) => obj
            .get("content")
            .and_then(|v| v.as_str())
            .or_else(|| obj.get("text").and_then(|v| v.as_str()))
            .or_else(|| obj.get("message").and_then(|v| v.as_str()))
            .map(|s| s.to_string()),
        serde_json::Value::Array(arr) => arr.iter().find_map(safe_str),
        _ => None,
    }
}

fn obj_str(obj: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<String> {
    obj.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

fn extract_fenced_diff(text: &str) -> Option<String> {
    let start_marker = "```diff";
    let start = text.find(start_marker)?;
    let after_marker = &text[start + start_marker.len()..];
    let after_newline = after_marker.strip_prefix('\n').unwrap_or(after_marker);
    let end = after_newline.find("```")?;
    Some(after_newline[..end].trim_end().to_string())
}

fn parse_diff_start_lines(diff: Option<&str>) -> (Option<usize>, Option<usize>) {
    let Some(diff_text) = diff else {
        return (None, None);
    };

    for line in diff_text.lines() {
        let Some(rest) = line.strip_prefix("@@ -") else {
            continue;
        };
        let Some((old_part, new_part_with_suffix)) = rest.split_once(" +") else {
            continue;
        };
        let Some((new_part, _suffix)) = new_part_with_suffix.split_once(" @@") else {
            continue;
        };
        let old_start = old_part
            .split(',')
            .next()
            .and_then(|value| value.parse::<usize>().ok());
        let new_start = new_part
            .split(',')
            .next()
            .and_then(|value| value.parse::<usize>().ok());
        return (old_start, new_start);
    }

    (None, None)
}

fn obj_i64(obj: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<i64> {
    obj.get(key).and_then(|v| v.as_i64())
}

fn obj_f64(obj: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<f64> {
    obj.get(key).and_then(|v| v.as_f64())
}

fn obj_bool(obj: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<bool> {
    obj.get(key).and_then(|v| v.as_bool())
}

fn obj_string_array(obj: &serde_json::Map<String, serde_json::Value>, key: &str) -> Vec<String> {
    obj.get(key)
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(ToString::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn parse_json_object_string(
    value: &serde_json::Value,
) -> Option<serde_json::Map<String, serde_json::Value>> {
    let text = value.as_str()?;
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(serde_json::Value::Object(obj)) => Some(obj),
        Ok(_) => None,
        Err(err) => {
            tracing::warn!(
                error = %err,
                len = text.len(),
                "extractors: string payload is not valid JSON object; skipping"
            );
            None
        }
    }
}

fn normalized_result_object(
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> serde_json::Map<String, serde_json::Value> {
    let Some(result) = result else {
        return serde_json::Map::new();
    };
    result
        .get("content")
        .and_then(parse_json_object_string)
        .or_else(|| result.get("observation").and_then(parse_json_object_string))
        .unwrap_or_else(|| result.clone())
}

/// Extract success data from nested or flat result formats.
fn get_success_data(
    result: &serde_json::Map<String, serde_json::Value>,
) -> serde_json::Map<String, serde_json::Value> {
    let empty = serde_json::Map::new();

    let nested = result
        .get("output")
        .and_then(|v| v.as_object())
        .and_then(|o| o.get("success"))
        .and_then(|v| v.as_object());

    let direct = result.get("success").and_then(|v| v.as_object());

    if let Some(n) = nested {
        if !n.is_empty() {
            return n.clone();
        }
    }
    if let Some(d) = direct {
        if !d.is_empty() {
            return d.clone();
        }
    }
    empty
}

/// Extract failure data from nested or flat result formats.
fn get_failure_data(
    result: &serde_json::Map<String, serde_json::Value>,
) -> serde_json::Map<String, serde_json::Value> {
    let empty = serde_json::Map::new();

    let nested = result
        .get("output")
        .and_then(|v| v.as_object())
        .and_then(|o| o.get("failure"))
        .and_then(|v| v.as_object());

    let direct = result.get("failure").and_then(|v| v.as_object());

    if let Some(n) = nested {
        if !n.is_empty() {
            return n.clone();
        }
    }
    if let Some(d) = direct {
        if !d.is_empty() {
            return d.clone();
        }
    }
    empty
}

fn strip_line_number_prefixes(content: &str) -> String {
    strip_line_number_prefixes_pub(content)
}

/// Separator characters written by `read_file_in_range` (and legacy variants)
/// between the right-aligned line number and the line content.
///
/// Current: `│` (U+2502 BOX DRAWINGS LIGHT VERTICAL), emitted by
/// `foundation/tool_infra/file.rs::format_text_result`.
/// Legacy: `→` (U+2192) for events created before the box-drawing switch.
const LINE_NUMBER_SEPARATORS: &[char] = &['│', '→'];

fn find_line_number_separator(line: &str) -> Option<(usize, char)> {
    LINE_NUMBER_SEPARATORS
        .iter()
        .filter_map(|sep| line.find(*sep).map(|idx| (idx, *sep)))
        .min_by_key(|(idx, _)| *idx)
}

/// Returns true if `line` looks like a numbered prefix line
/// (`<optional whitespace><digits><separator>...`).
fn looks_like_numbered_line(line: &str) -> bool {
    line.trim_start().starts_with(|c: char| c.is_ascii_digit())
        && find_line_number_separator(line).is_some()
}

/// Public version exposed to Tauri commands for direct invocation on large content.
///
/// Strips:
/// 1. The leading `[action: ...]` marker line that `read_file` prepends
///    (see `agent_core/core/tools/impls/coding/files.rs::classify_read_action`).
/// 2. Per-line `<digits><separator>` prefixes from each line of the body.
///
/// Both are written purely for the LLM's benefit; the UI must not show them.
pub fn strip_line_number_prefixes_pub(content: &str) -> String {
    let lines: Vec<&str> = content.split('\n').collect();

    // Skip a single leading `[action: ...]` marker if present.
    let body_start = if lines
        .first()
        .map(|l| l.starts_with("[action:") && l.ends_with(']'))
        .unwrap_or(false)
    {
        1
    } else {
        0
    };

    let body = &lines[body_start..];

    // Only strip when the first non-empty body line looks like a numbered
    // prefix. This avoids mangling file contents that happen to contain
    // `│` or `→` for unrelated reasons (e.g. ASCII art, comments).
    let first_non_empty = body.iter().find(|l| !l.trim().is_empty());
    let Some(first_line) = first_non_empty else {
        // Nothing to strip beyond the action marker; preserve original
        // structure unless we explicitly removed the marker.
        return if body_start > 0 {
            body.join("\n")
        } else {
            content.to_string()
        };
    };

    if !looks_like_numbered_line(first_line) {
        return if body_start > 0 {
            body.join("\n")
        } else {
            content.to_string()
        };
    }

    body.iter()
        .map(|l| {
            if let Some((idx, sep)) = find_line_number_separator(l) {
                &l[idx + sep.len_utf8()..]
            } else {
                *l
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

// ============================================================================
// Public Extraction API
// ============================================================================

/// Extract structured rendering data from a SessionEvent.
/// Returns `None` for event types that don't need pre-computation (e.g. approvals).
pub fn extract_event_data(event: &SessionEvent) -> Option<ExtractedData> {
    let args = event.args.as_object();
    let result = event.result.as_object();

    match event.display_variant {
        EventDisplayVariant::Thinking => {
            Some(ExtractedData::Thinking(extract_thinking(args, result)))
        }

        EventDisplayVariant::Message => Some(ExtractedData::Message(extract_message(event))),

        EventDisplayVariant::Session => None,

        EventDisplayVariant::ToolCall => extract_tool_call_data(event, args, result),

        EventDisplayVariant::Error => Some(ExtractedData::Message(ExtractedMessageData {
            content: result.and_then(|r| {
                obj_str(r, "error")
                    .or_else(|| obj_str(r, "error_message"))
                    .or_else(|| obj_str(r, "observation"))
            }),
            is_user: false,
        })),

        _ => None,
    }
}

// ============================================================================
// Per-Type Extractors
// ============================================================================

fn extract_thinking(
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedThinkingData {
    let content = result
        .and_then(|r| {
            obj_str(r, "thought")
                .or_else(|| obj_str(r, "content"))
                .or_else(|| obj_str(r, "observation"))
        })
        .or_else(|| args.and_then(|a| obj_str(a, "content")));

    let duration = result.and_then(|r| obj_f64(r, "duration"));

    ExtractedThinkingData { content, duration }
}

fn extract_message(event: &SessionEvent) -> ExtractedMessageData {
    let is_user = event.source == crate::agent_sessions::event_pipeline::types::EventSource::User;
    let content = event
        .result
        .as_object()
        .and_then(|r| obj_str(r, "content").or_else(|| obj_str(r, "observation")))
        .or_else(|| Some(event.display_text.clone()));

    ExtractedMessageData { content, is_user }
}

fn extract_tool_call_data(
    event: &SessionEvent,
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> Option<ExtractedData> {
    // Resolve action from args (primary source) then fall back to
    // event.action_type. Some wire formats send action under args.action,
    // others set the normalized SessionEvent.action_type.
    let action = args
        .and_then(|a| a.get("action").and_then(|v| v.as_str()))
        .map(|s| s.to_string())
        .unwrap_or_else(|| event.action_type.clone());
    let action_opt: Option<&str> = if action.is_empty() {
        None
    } else {
        Some(&action)
    };

    let tool = if !event.ui_canonical.is_empty() {
        event.ui_canonical.as_str()
    } else {
        event.function_name.as_str()
    };

    let org_task_tool = if matches!(
        tool,
        tool_names::TASK_CREATE
            | tool_names::TASK_UPDATE
            | tool_names::TASK_LIST
            | tool_names::TASK_GET
    ) {
        Some(tool)
    } else if matches!(
        event.function_name.as_str(),
        tool_names::TASK_CREATE
            | tool_names::TASK_UPDATE
            | tool_names::TASK_LIST
            | tool_names::TASK_GET
    ) {
        Some(event.function_name.as_str())
    } else {
        None
    };

    if let Some(org_task_tool) = org_task_tool {
        return Some(ExtractedData::OrgTask(extract_org_task(
            org_task_tool,
            args,
            result,
        )));
    }

    // Resolved AppSubtool is the single dispatch key. Built-in tools always
    // resolve; dynamic/unknown tools fall through to OtherTool.
    let subtool = resolve_effective_app_subtool(tool, action_opt)
        .or_else(|| resolve_effective_app_subtool(&event.function_name, action_opt))
        .unwrap_or(AppSubtool::OtherTool);

    match subtool {
        AppSubtool::FileRead => Some(ExtractedData::File(extract_file(args, result))),
        AppSubtool::FileWrite => {
            // Delete-file actions carry only a path, not a diff.
            if action_opt == Some("delete") || tool == "delete_file" {
                Some(ExtractedData::DeleteFile(extract_delete_file(args, result)))
            } else {
                Some(ExtractedData::Edit(extract_edit(args, result)))
            }
        }
        AppSubtool::Shell => {
            // await_output shares the Shell subtool but has its own payload shape.
            if tool == "await_output" {
                Some(ExtractedData::Await(extract_await(args, result)))
            } else {
                Some(ExtractedData::Shell(extract_shell(args, result)))
            }
        }
        AppSubtool::Search => Some(ExtractedData::Search(extract_search(args, result))),
        AppSubtool::Glob => Some(ExtractedData::Glob(extract_glob(args, result))),
        AppSubtool::Explore => Some(ExtractedData::ListDir(extract_list_dir(args, result))),
        AppSubtool::Browser => {
            // web_search has structured results; other browser actions fall through.
            if tool == "web_search" {
                Some(ExtractedData::WebSearch(extract_web_search(args, result)))
            } else {
                None
            }
        }
        AppSubtool::Todo => Some(ExtractedData::Todo(extract_todo(args, result))),
        AppSubtool::Subagent => Some(ExtractedData::Subagent(extract_subagent(args, result))),
        // Message/Thinking are handled by extract_event_data directly via
        // display_variant. The remaining subtools don't have a specialized
        // extractor yet; generic tool calls fall back to file extraction
        // when a file_path hint is present.
        AppSubtool::InternalBrowser
        | AppSubtool::Database
        | AppSubtool::Project
        | AppSubtool::Message
        | AppSubtool::OtherInteractions
        | AppSubtool::Thinking
        | AppSubtool::OtherTool => {
            if event.file_path.is_some() {
                Some(ExtractedData::File(extract_file(args, result)))
            } else {
                None
            }
        }
    }
}

fn extract_file(
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedFileData {
    let result_map = result.cloned().unwrap_or_default();
    let success = get_success_data(&result_map);

    let file_path = args
        .and_then(|a| {
            obj_str(a, "file_path")
                .or_else(|| obj_str(a, "target_file"))
                .or_else(|| obj_str(a, "path"))
        })
        .or_else(|| obj_str(&success, "path").or_else(|| obj_str(&success, "file_path")))
        .or_else(|| result.and_then(|r| obj_str(r, "file_path").or_else(|| obj_str(r, "path"))))
        .unwrap_or_default();

    let file_name = if !file_path.is_empty() {
        file_path
            .rsplit('/')
            .next()
            .unwrap_or(&file_path)
            .to_string()
    } else {
        args.and_then(|a| obj_str(a, "file_name"))
            .or_else(|| obj_str(&success, "file_name"))
            .unwrap_or_default()
    };

    let raw_content = obj_str(&success, "content")
        .or_else(|| result.and_then(|r| r.get("output").and_then(safe_str)))
        .or_else(|| result.and_then(|r| obj_str(r, "content")))
        .or_else(|| result.and_then(|r| obj_str(r, "file_content")))
        .or_else(|| result.and_then(|r| obj_str(r, "observation")));

    let content = raw_content.map(|c| strip_line_number_prefixes(&c));
    let language = detect_language(&file_name);
    let line_count = content.as_ref().map(|c| c.split('\n').count());

    ExtractedFileData {
        file_path,
        file_name,
        content,
        language: language.to_string(),
        line_count,
    }
}

fn extract_edit(
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedEditData {
    // apply_patch: multi-file patch with custom format. Delegate to the
    // Rust patch converter so per-file segments are pre-computed.
    if let Some(patch_text) = args
        .and_then(|a| a.get("patch_text"))
        .and_then(|v| v.as_str())
    {
        return extract_apply_patch(patch_text, result);
    }

    let file_data = extract_file(args, result);
    let result_map = result.cloned().unwrap_or_default();
    let success = get_success_data(&result_map);

    let old_content = args
        .and_then(|a| {
            obj_str(a, "old_str")
                .or_else(|| obj_str(a, "old_string"))
                .or_else(|| obj_str(a, "old_content"))
        })
        .or_else(|| obj_str(&success, "beforeFullFileContent"))
        .or_else(|| result.and_then(|r| obj_str(r, "old_content")));

    let new_content = args
        .and_then(|a| obj_str(a, "streamContent"))
        .or_else(|| obj_str(&success, "afterFullFileContent"))
        .or_else(|| {
            args.and_then(|a| {
                obj_str(a, "new_str")
                    .or_else(|| obj_str(a, "new_string"))
                    .or_else(|| obj_str(a, "new_content"))
            })
        })
        .or_else(|| result.and_then(|r| obj_str(r, "new_content")))
        .or_else(|| args.and_then(|a| obj_str(a, "content")))
        .or_else(|| result.and_then(|r| obj_str(r, "content")));

    let result_content = result.and_then(|r| obj_str(r, "content"));
    let diff = obj_str(&success, "diffString")
        .or_else(|| result.and_then(|r| obj_str(r, "diffString")))
        .or_else(|| result.and_then(|r| obj_str(r, "diff")))
        .or_else(|| result_content.as_deref().and_then(extract_fenced_diff));
    let (old_start_line, new_start_line) = parse_diff_start_lines(diff.as_deref());

    let lines_added = success
        .get("linesAdded")
        .and_then(|v| v.as_u64())
        .or_else(|| {
            result
                .and_then(|r| r.get("linesAdded"))
                .and_then(|v| v.as_u64())
        })
        .map(|v| v as usize);

    let lines_removed = success
        .get("linesRemoved")
        .and_then(|v| v.as_u64())
        .or_else(|| {
            result
                .and_then(|r| r.get("linesRemoved"))
                .and_then(|v| v.as_u64())
        })
        .map(|v| v as usize);

    // For full-file writes without diff/old/lineStats, compute from content
    let computed_added = if diff.is_none() && old_content.is_none() && lines_added.is_none() {
        new_content.as_ref().map(|c| c.split('\n').count())
    } else {
        lines_added
    };

    ExtractedEditData {
        file_path: file_data.file_path,
        file_name: file_data.file_name,
        language: file_data.language,
        content: file_data.content,
        line_count: file_data.line_count,
        old_content,
        new_content,
        diff,
        old_start_line,
        new_start_line,
        lines_added: computed_added,
        lines_removed,
        is_deleted: false,
        apply_patch_segments: Vec::new(),
    }
}

fn extract_apply_patch(
    patch_text: &str,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedEditData {
    if let Some(real) = result.and_then(extract_real_apply_patch_result) {
        return real;
    }

    let converted = convert_patch_to_unified(patch_text.to_string());
    let result_summary = result.and_then(|r| obj_str(r, "content"));

    let first_path = converted.file_paths.first().cloned().unwrap_or_default();
    let file_name = if first_path.is_empty() {
        "patch".to_string()
    } else {
        first_path
            .rsplit('/')
            .next()
            .unwrap_or(&first_path)
            .to_string()
    };

    let segments = if converted.segments.len() > 1 {
        converted
            .segments
            .iter()
            .enumerate()
            .map(|(idx, seg)| segment_to_edit(seg, &result_summary, idx, converted.segments.len()))
            .collect()
    } else {
        Vec::new()
    };

    let has_diff = !converted.diff.is_empty();
    let diff = if has_diff { Some(converted.diff) } else { None };
    let (old_start_line, new_start_line) = parse_diff_start_lines(diff.as_deref());
    ExtractedEditData {
        file_path: first_path,
        file_name,
        language: "diff".to_string(),
        content: None,
        line_count: None,
        old_content: None,
        new_content: if has_diff { None } else { result_summary },
        diff,
        old_start_line,
        new_start_line,
        lines_added: Some(converted.lines_added),
        lines_removed: Some(converted.lines_removed),
        is_deleted: false,
        apply_patch_segments: segments,
    }
}

fn extract_real_apply_patch_result(
    result: &serde_json::Map<String, serde_json::Value>,
) -> Option<ExtractedEditData> {
    let segments_value = result.get("segments")?.as_array()?;
    let result_summary = obj_str(result, "content");
    let segments: Vec<ExtractedEditData> = segments_value
        .iter()
        .filter_map(|value| value.as_object())
        .map(|segment| {
            let file_path = obj_str(segment, "filePath").unwrap_or_default();
            let file_name = file_path
                .rsplit('/')
                .next()
                .unwrap_or(&file_path)
                .to_string();
            let is_deleted = segment
                .get("isDeleted")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            let language = if is_deleted {
                let detected = detect_language(&file_name);
                if detected == "plaintext" {
                    "diff".to_string()
                } else {
                    detected.to_string()
                }
            } else {
                "diff".to_string()
            };

            let diff = obj_str(segment, "diff");
            let (old_start_line, new_start_line) = parse_diff_start_lines(diff.as_deref());

            ExtractedEditData {
                file_path,
                file_name,
                language,
                content: None,
                line_count: None,
                old_content: None,
                new_content: None,
                diff,
                old_start_line,
                new_start_line,
                lines_added: segment
                    .get("linesAdded")
                    .and_then(|value| value.as_u64())
                    .map(|value| value as usize),
                lines_removed: segment
                    .get("linesRemoved")
                    .and_then(|value| value.as_u64())
                    .map(|value| value as usize),
                is_deleted,
                apply_patch_segments: Vec::new(),
            }
        })
        .collect();

    let first_path = result
        .get("filePaths")
        .and_then(|value| value.as_array())
        .and_then(|paths| paths.first())
        .and_then(|value| value.as_str())
        .map(ToString::to_string)
        .or_else(|| segments.first().map(|segment| segment.file_path.clone()))
        .unwrap_or_default();
    let file_name = if first_path.is_empty() {
        "patch".to_string()
    } else {
        first_path
            .rsplit('/')
            .next()
            .unwrap_or(&first_path)
            .to_string()
    };
    let diff = obj_str(result, "diffString");
    let has_diff = diff.as_ref().is_some_and(|value| !value.is_empty());
    let (old_start_line, new_start_line) = parse_diff_start_lines(diff.as_deref());
    let segment_count = segments.len();

    Some(ExtractedEditData {
        file_path: first_path,
        file_name,
        language: "diff".to_string(),
        content: None,
        line_count: None,
        old_content: None,
        new_content: if has_diff {
            None
        } else {
            result_summary.clone()
        },
        diff,
        old_start_line,
        new_start_line,
        lines_added: result
            .get("linesAdded")
            .and_then(|value| value.as_u64())
            .map(|value| value as usize),
        lines_removed: result
            .get("linesRemoved")
            .and_then(|value| value.as_u64())
            .map(|value| value as usize),
        is_deleted: false,
        apply_patch_segments: if segment_count > 1 {
            segments
        } else {
            Vec::new()
        },
    })
}

fn segment_to_edit(
    segment: &PatchSegment,
    result_summary: &Option<String>,
    segment_index: usize,
    total_segments: usize,
) -> ExtractedEditData {
    let file_name = segment
        .file_path
        .rsplit('/')
        .next()
        .unwrap_or(&segment.file_path)
        .to_string();

    if segment.is_deleted {
        let detected = detect_language(&file_name);
        let language = if detected == "plaintext" {
            "diff".to_string()
        } else {
            detected.to_string()
        };
        return ExtractedEditData {
            file_path: segment.file_path.clone(),
            file_name,
            language,
            content: None,
            line_count: None,
            old_content: None,
            new_content: None,
            diff: None,
            old_start_line: None,
            new_start_line: None,
            lines_added: Some(0),
            lines_removed: Some(0),
            is_deleted: true,
            apply_patch_segments: Vec::new(),
        };
    }

    let has_real_diff = !segment.diff.is_empty();
    let detected = detect_language(&file_name);
    let language = if has_real_diff || detected == "plaintext" {
        "diff".to_string()
    } else {
        detected.to_string()
    };

    let new_content = if !has_real_diff && segment_index == total_segments - 1 {
        result_summary.clone()
    } else {
        None
    };

    let diff = if has_real_diff {
        Some(segment.diff.clone())
    } else {
        None
    };
    let (old_start_line, new_start_line) = parse_diff_start_lines(diff.as_deref());

    ExtractedEditData {
        file_path: segment.file_path.clone(),
        file_name,
        language,
        content: None,
        line_count: None,
        old_content: None,
        new_content,
        diff,
        old_start_line,
        new_start_line,
        lines_added: Some(segment.lines_added),
        lines_removed: Some(segment.lines_removed),
        is_deleted: false,
        apply_patch_segments: Vec::new(),
    }
}

fn extract_shell(
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedShellData {
    let result_map = result.cloned().unwrap_or_default();
    let success = get_success_data(&result_map);
    let failure = get_failure_data(&result_map);
    let is_failure = !failure.is_empty() && success.is_empty();

    let command_data = if !success.is_empty() {
        &success
    } else {
        &failure
    };

    let command = obj_str(command_data, "command")
        .or_else(|| args.and_then(|a| obj_str(a, "command")))
        .or_else(|| result.and_then(|r| obj_str(r, "command")))
        .unwrap_or_default();

    let stdout =
        obj_str(command_data, "stdout").or_else(|| result.and_then(|r| obj_str(r, "stdout")));
    let stderr =
        obj_str(command_data, "stderr").or_else(|| result.and_then(|r| obj_str(r, "stderr")));
    let interleaved = obj_str(command_data, "interleavedOutput")
        .or_else(|| obj_str(command_data, "interleaved_output"));
    let stream_output = args.and_then(|a| obj_str(a, "streamOutput"));

    let output = interleaved
        .or(stdout)
        .or(stderr)
        .or(stream_output)
        .or_else(|| result.and_then(|r| r.get("output").and_then(safe_str)))
        .or_else(|| result.and_then(|r| obj_str(r, "observation")));

    let exit_code = obj_i64(command_data, "exitCode")
        .or_else(|| obj_i64(command_data, "exit_code"))
        .or_else(|| result.and_then(|r| obj_i64(r, "exit_code")));

    let execution_time =
        obj_f64(command_data, "executionTime").or_else(|| obj_f64(command_data, "execution_time"));

    let cwd = args.and_then(|a| obj_str(a, "cwd"));

    // Extract new-parity fields
    let description = args.and_then(|a| obj_str(a, "description"));
    let kill_handle = args.and_then(|a| obj_str(a, "kill_handle"));
    let action = args.and_then(|a| match a.get("action") {
        Some(serde_json::Value::String(s)) => Some(s.clone()),
        _ => None,
    });
    let stream_output_owned = args.and_then(|a| obj_str(a, "streamOutput"));
    let shell_pid = args.and_then(|a| obj_i64(a, "shellPid"));
    let shell_process_status = args.and_then(|a| obj_str(a, "shellProcessStatus"));
    let shell_log_path = args.and_then(|a| obj_str(a, "shellLogPath"));

    ExtractedShellData {
        command,
        action,
        kill_handle,
        description,
        output,
        stream_output: stream_output_owned,
        exit_code,
        cwd,
        execution_time,
        is_failure,
        shell_pid,
        shell_process_status,
        shell_log_path,
    }
}

fn extract_search(
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedSearchData {
    let query = args
        .and_then(|a| {
            obj_str(a, "query")
                .or_else(|| obj_str(a, "pattern"))
                .or_else(|| obj_str(a, "search_query"))
                .or_else(|| obj_str(a, "regex"))
                .or_else(|| obj_str(a, "search_term"))
                .or_else(|| obj_str(a, "searchTerm"))
                .or_else(|| obj_str(a, "text"))
                .or_else(|| obj_str(a, "input"))
        })
        .unwrap_or_default();

    let results: Vec<EventSearchMatch> = result
        .and_then(|r| r.get("matches"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let obj = item.as_object()?;
                    Some(EventSearchMatch {
                        file: obj_str(obj, "file").unwrap_or_default(),
                        line: obj.get("line").and_then(|v| v.as_u64()).unwrap_or(0) as usize,
                        content: obj_str(obj, "content").unwrap_or_default(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let mut total_matches = result
        .and_then(|r| r.get("total"))
        .and_then(|v| v.as_u64())
        .unwrap_or(results.len() as u64) as usize;

    if total_matches == 0 {
        if let Some(content) = result.and_then(|r| obj_str(r, "content")) {
            // Parse "Found N matches" pattern
            if let Some(start) = content.find(char::is_numeric) {
                let num_str: String = content[start..]
                    .chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect();
                if let Ok(count) = num_str.parse::<usize>() {
                    total_matches = count;
                }
            }
        }
    }

    ExtractedSearchData {
        query,
        results,
        total_matches,
    }
}

fn extract_todo(
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedTodoData {
    let mut todos_value: Option<serde_json::Value> = None;
    let mut was_merge = false;

    // Try observation first (primary source)
    if let Some(obs) = result.and_then(|r| r.get("observation")) {
        let parsed = if let Some(s) = obs.as_str() {
            // The todo tool emits its observation as a JSON-stringified
            // object. Falling back to `None` here is intentional — the
            // event-pipeline extractors must not abort the whole event
            // on a corrupt observation string — but we warn so the
            // upstream-tool corruption surfaces in logs instead of
            // silently producing a "no todos" UI panel.
            match serde_json::from_str::<serde_json::Value>(s) {
                Ok(v) => Some(v),
                Err(err) => {
                    tracing::warn!(
                        error = %err,
                        len = s.len(),
                        "extractors::extract_todo: observation string is not valid JSON; skipping"
                    );
                    None
                }
            }
        } else {
            Some(obs.clone())
        };

        if let Some(ref parsed_val) = parsed {
            if let Some(obj) = parsed_val.as_object() {
                if let Some(success) = obj.get("success").and_then(|v| v.as_object()) {
                    if let Some(t) = success.get("todos") {
                        todos_value = Some(t.clone());
                        was_merge = success
                            .get("wasMerge")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                    }
                } else if let Some(t) = obj.get("todos") {
                    todos_value = Some(t.clone());
                    was_merge = obj
                        .get("wasMerge")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                }
            }
        }
    }

    // Fallback: try other locations
    let needs_fallback = todos_value
        .as_ref()
        .map(|t| t.as_array().map(|a| a.is_empty()).unwrap_or(true))
        .unwrap_or(true);

    if needs_fallback {
        let candidates: [Option<&serde_json::Value>; 5] = [
            args.and_then(|a| a.get("todos")),
            result
                .and_then(|r| r.get("output"))
                .and_then(|v| v.as_object())
                .and_then(|o| o.get("success"))
                .and_then(|v| v.as_object())
                .and_then(|s| s.get("todos")),
            result
                .and_then(|r| r.get("output"))
                .and_then(|v| v.as_object())
                .and_then(|o| o.get("todos")),
            result
                .and_then(|r| r.get("success"))
                .and_then(|v| v.as_object())
                .and_then(|s| s.get("todos")),
            result.and_then(|r| r.get("todos")),
        ];

        if let Some(t) = candidates.iter().flatten().next() {
            todos_value = Some((*t).clone());
        }
    }

    let todos: Vec<TodoItem> = todos_value
        .as_ref()
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let obj = item.as_object()?;
                    let blocked_by = obj
                        .get("blockedBy")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_u64().map(|n| n as usize))
                                .collect()
                        })
                        .unwrap_or_default();
                    Some(TodoItem {
                        id: obj_str(obj, "id").unwrap_or_default(),
                        content: obj_str(obj, "content")
                            .or_else(|| obj_str(obj, "description"))
                            .unwrap_or_default(),
                        status: obj_str(obj, "status").unwrap_or_else(|| "pending".to_string()),
                        blocked_by,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    ExtractedTodoData { todos, was_merge }
}

// ============================================================================
// Extractors
// ============================================================================

fn extract_await(
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedAwaitData {
    let handle = args.and_then(|a| obj_str(a, "handle").or_else(|| obj_str(a, "pid")));
    let block_until_ms = args.and_then(|a| obj_i64(a, "block_until_ms"));

    let result_text = match result {
        Some(r) => match r.get("output") {
            Some(serde_json::Value::String(s)) => Some(s.clone()),
            _ => obj_str(r, "output").or_else(|| obj_str(r, "text")),
        },
        None => None,
    };

    ExtractedAwaitData {
        handle,
        block_until_ms,
        result_text,
    }
}

fn parse_text_entries(text: &str) -> Vec<DirEntry> {
    let lines: Vec<&str> = text
        .split('\n')
        .filter(|line| !line.trim().is_empty())
        .collect();
    if lines.is_empty() {
        return Vec::new();
    }

    // First pass: look for `[dir] foo` / `[file] bar`
    let mut entries = Vec::new();
    let mut has_bracket_format = false;

    for line in &lines {
        let trimmed = line.trim();
        let lower = trimmed.to_lowercase();
        if let Some(rest) = lower.strip_prefix("[dir]") {
            has_bracket_format = true;
            // Use original casing on the trimmed tail after the bracket keyword
            let original_tail = trimmed.get(lower.len() - rest.len()..).unwrap_or("").trim();
            if !original_tail.is_empty() {
                entries.push(DirEntry {
                    name: original_tail.to_string(),
                    is_directory: true,
                });
            }
            continue;
        }
        if let Some(rest) = lower.strip_prefix("[file]") {
            has_bracket_format = true;
            let original_tail = trimmed.get(lower.len() - rest.len()..).unwrap_or("").trim();
            if !original_tail.is_empty() {
                entries.push(DirEntry {
                    name: original_tail.to_string(),
                    is_directory: false,
                });
            }
            continue;
        }
    }

    if has_bracket_format {
        return entries;
    }

    // Fallback: trailing `/` = directory
    for line in &lines {
        let trimmed = line.trim();
        if let Some(stripped) = trimmed.strip_suffix('/') {
            entries.push(DirEntry {
                name: stripped.to_string(),
                is_directory: true,
            });
        } else {
            entries.push(DirEntry {
                name: trimmed.to_string(),
                is_directory: false,
            });
        }
    }

    entries
}

fn extract_list_dir(
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedListDirData {
    let directory = args
        .and_then(|a| {
            obj_str(a, "target_directory")
                .or_else(|| obj_str(a, "targetDirectory"))
                .or_else(|| obj_str(a, "path"))
                .or_else(|| obj_str(a, "dir"))
                .or_else(|| obj_str(a, "dir_path"))
                .or_else(|| obj_str(a, "file_path"))
        })
        .unwrap_or_else(|| ".".to_string());

    let mut entries: Vec<DirEntry> = Vec::new();

    // Preferred structured form: result.output.success.directoryTreeRoot
    let tree_root = result
        .and_then(|r| r.get("output"))
        .and_then(|v| v.as_object())
        .and_then(|o| o.get("success"))
        .and_then(|v| v.as_object())
        .and_then(|s| s.get("directoryTreeRoot"))
        .and_then(|v| v.as_object());

    if let Some(tree) = tree_root {
        let root_path = obj_str(tree, "absPath");

        if let Some(children_files) = tree.get("childrenFiles").and_then(|v| v.as_array()) {
            for file in children_files {
                if let Some(name) = file.as_object().and_then(|o| obj_str(o, "name")) {
                    entries.push(DirEntry {
                        name,
                        is_directory: false,
                    });
                }
            }
        }

        if let Some(children_dirs) = tree.get("childrenDirs").and_then(|v| v.as_array()) {
            for dir in children_dirs {
                if let Some(dir_path) = dir.as_object().and_then(|o| obj_str(o, "absPath")) {
                    let name = dir_path.rsplit('/').next().unwrap_or(&dir_path).to_string();
                    entries.push(DirEntry {
                        name,
                        is_directory: true,
                    });
                }
            }
        }

        return ExtractedListDirData {
            directory: root_path.unwrap_or(directory),
            entries,
            content_summary: None,
        };
    }

    // Fallback: array under result.output / result.entries / result.files
    let raw_entries = result
        .and_then(|r| {
            r.get("output")
                .filter(|v| v.is_array())
                .or_else(|| r.get("entries"))
                .or_else(|| r.get("files"))
        })
        .and_then(|v| v.as_array());

    if let Some(arr) = raw_entries {
        for entry in arr {
            if let Some(s) = entry.as_str() {
                if let Some(stripped) = s.strip_suffix('/') {
                    entries.push(DirEntry {
                        name: stripped.to_string(),
                        is_directory: true,
                    });
                } else {
                    entries.push(DirEntry {
                        name: s.to_string(),
                        is_directory: false,
                    });
                }
            } else if let Some(obj) = entry.as_object() {
                let name = obj_str(obj, "name").unwrap_or_default();
                let is_directory = obj
                    .get("is_directory")
                    .and_then(|v| v.as_bool())
                    .or_else(|| obj.get("isDirectory").and_then(|v| v.as_bool()))
                    .unwrap_or_else(|| {
                        obj.get("type").and_then(|v| v.as_str()) == Some("directory")
                    });
                entries.push(DirEntry { name, is_directory });
            }
        }
    }

    // Text-parsing fallbacks
    if entries.is_empty() {
        if let Some(content) = result.and_then(|r| obj_str(r, "content")) {
            let parsed = parse_text_entries(&content);
            if !parsed.is_empty() {
                entries = parsed;
            }
        }
    }
    if entries.is_empty() {
        if let Some(observation) = result.and_then(|r| obj_str(r, "observation")) {
            let parsed = parse_text_entries(&observation);
            if !parsed.is_empty() {
                entries = parsed;
            }
        }
    }

    let content_summary = if entries.is_empty() {
        result.and_then(|r| obj_str(r, "content"))
    } else {
        None
    };

    ExtractedListDirData {
        directory,
        entries,
        content_summary,
    }
}

fn extract_glob(
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedGlobData {
    let output = result
        .and_then(|r| r.get("output"))
        .and_then(|v| v.as_object());
    let success = output
        .and_then(|o| o.get("success"))
        .and_then(|v| v.as_object());

    let pattern = args
        .and_then(|a| {
            obj_str(a, "pattern")
                .or_else(|| obj_str(a, "glob_pattern"))
                .or_else(|| obj_str(a, "globPattern"))
                .or_else(|| obj_str(a, "query"))
        })
        .or_else(|| success.and_then(|s| obj_str(s, "pattern")))
        .unwrap_or_else(|| "*".to_string());

    let mut files: Vec<String> = Vec::new();

    // Collect from structured sources first
    let candidates = [
        result.and_then(|r| r.get("files")),
        result.and_then(|r| r.get("matches")),
        success.and_then(|s| s.get("files")),
    ];

    for value in candidates.iter().flatten() {
        if let Some(arr) = value.as_array() {
            for item in arr {
                if let Some(s) = item.as_str() {
                    files.push(s.to_string());
                }
            }
            if !files.is_empty() {
                break;
            }
        }
    }

    // Fallback: parse text output
    if files.is_empty() {
        let text_content = result
            .and_then(|r| obj_str(r, "content"))
            .or_else(|| result.and_then(|r| obj_str(r, "observation")));
        if let Some(text) = text_content {
            for line in text.split('\n') {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with("Found ") {
                    continue;
                }
                let has_ext = trimmed.rfind('.').is_some_and(|idx| {
                    trimmed[idx + 1..]
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric())
                });
                if trimmed.contains('/') || has_ext {
                    files.push(trimmed.to_string());
                }
            }
        }
    }

    let mut total_files = success
        .and_then(|s| s.get("totalFiles"))
        .and_then(|v| v.as_u64())
        .map(|v| v as usize)
        .unwrap_or(files.len());

    if total_files == 0 {
        if let Some(content) = result.and_then(|r| obj_str(r, "content")) {
            // Parse "Found N (matching) file" — take first number
            if let Some(start) = content.find(char::is_numeric) {
                let num_str: String = content[start..]
                    .chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect();
                if let Ok(count) = num_str.parse::<usize>() {
                    total_files = count;
                }
            }
        }
    }

    ExtractedGlobData {
        pattern,
        files,
        total_files,
    }
}

fn extract_web_search(
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedWebSearchData {
    let query = args
        .and_then(|a| obj_str(a, "query").or_else(|| obj_str(a, "search_term")))
        .unwrap_or_default();

    let results = result
        .and_then(|r| r.get("results"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let obj = item.as_object()?;
                    Some(WebSearchResult {
                        title: obj_str(obj, "title").unwrap_or_default(),
                        url: obj_str(obj, "url")
                            .or_else(|| obj_str(obj, "link"))
                            .unwrap_or_default(),
                        snippet: obj_str(obj, "snippet")
                            .or_else(|| obj_str(obj, "description"))
                            .unwrap_or_default(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    ExtractedWebSearchData { query, results }
}

fn extract_org_task_item(
    task: &serde_json::Map<String, serde_json::Value>,
    args: Option<&serde_json::Map<String, serde_json::Value>>,
) -> Option<OrgTaskItem> {
    let id = obj_str(task, "id")
        .or_else(|| args.and_then(|a| obj_str(a, "id")))
        .unwrap_or_default();
    if id.is_empty() {
        return None;
    }

    let owner_member = task.get("owner_member").and_then(|value| value.as_object());
    let owner_name = owner_member.and_then(|member| {
        let name = obj_str(member, "name");
        let role = obj_str(member, "role");
        match (name, role) {
            (Some(name), Some(role)) => Some(format!("{name} · {role}")),
            (Some(name), None) => Some(name),
            _ => None,
        }
    });

    Some(OrgTaskItem {
        id,
        subject: obj_str(task, "subject").or_else(|| args.and_then(|a| obj_str(a, "subject"))),
        description: obj_str(task, "description")
            .or_else(|| args.and_then(|a| obj_str(a, "description"))),
        active_form: obj_str(task, "active_form")
            .or_else(|| args.and_then(|a| obj_str(a, "active_form"))),
        status: obj_str(task, "status").or_else(|| args.and_then(|a| obj_str(a, "status"))),
        owner: obj_str(task, "owner_member_id")
            .or_else(|| obj_str(task, "owner"))
            .or_else(|| args.and_then(|a| obj_str(a, "owner_member_id"))),
        owner_name,
        owner_agent_icon_id: owner_member.and_then(|member| obj_str(member, "agent_icon_id")),
        owner_cli_agent_type: owner_member.and_then(|member| obj_str(member, "cli_agent_type")),
        priority: obj_str(task, "priority"),
        blocks: obj_string_array(task, "blocks"),
        blocked_by: obj_string_array(task, "blocked_by"),
    })
}

fn extract_org_task_args_item(
    tool: &str,
    args: Option<&serde_json::Map<String, serde_json::Value>>,
) -> Option<OrgTaskItem> {
    if tool == tool_names::TASK_LIST {
        return None;
    }

    let args = args?;
    let id = obj_str(args, "id").unwrap_or_default();
    Some(OrgTaskItem {
        id,
        subject: obj_str(args, "subject"),
        description: obj_str(args, "description"),
        active_form: obj_str(args, "active_form"),
        status: obj_str(args, "status"),
        owner: obj_str(args, "owner_member_id").or_else(|| obj_str(args, "owner")),
        owner_name: None,
        owner_agent_icon_id: None,
        owner_cli_agent_type: None,
        priority: obj_str(args, "priority"),
        blocks: obj_string_array(args, "blocks"),
        blocked_by: obj_string_array(args, "blocked_by"),
    })
}

fn extract_org_task(
    tool: &str,
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedOrgTaskData {
    let result_object = normalized_result_object(result);
    let action = match tool {
        tool_names::TASK_CREATE => "create",
        tool_names::TASK_UPDATE => {
            if obj_bool(&result_object, "deleted") == Some(true) {
                "delete"
            } else {
                "update"
            }
        }
        tool_names::TASK_GET => "get",
        tool_names::TASK_LIST => "list",
        _ => "update",
    }
    .to_string();

    let task = result_object
        .get("task")
        .and_then(|value| value.as_object())
        .and_then(|task| extract_org_task_item(task, args))
        .or_else(|| extract_org_task_args_item(tool, args));

    let tasks: Vec<OrgTaskItem> = result_object
        .get("tasks")
        .and_then(|value| value.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_object())
                .filter_map(|task| extract_org_task_item(task, args))
                .collect()
        })
        .unwrap_or_default();

    let total = result_object
        .get("total")
        .and_then(|value| value.as_u64())
        .map(|value| value as usize)
        .or_else(|| {
            if tasks.is_empty() {
                task.as_ref().map(|_| 1)
            } else {
                Some(tasks.len())
            }
        });

    ExtractedOrgTaskData {
        action,
        task,
        tasks,
        total,
        org_run_id: obj_str(&result_object, "org_run_id"),
        owner_changed: obj_bool(&result_object, "owner_changed"),
        status_changed: obj_bool(&result_object, "status_changed"),
        task_assigned_dispatched: obj_bool(&result_object, "task_assigned_dispatched"),
    }
}

fn extract_subagent(
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedSubagentData {
    let description = args
        .and_then(|a| obj_str(a, "description").or_else(|| obj_str(a, "task")))
        .unwrap_or_default();
    let subagent_type = args
        .and_then(|a| obj_str(a, "subagent_type").or_else(|| obj_str(a, "type")))
        .unwrap_or_default();

    let result_content = result
        .and_then(|r| obj_str(r, "content").or_else(|| obj_str(r, "output")))
        .unwrap_or_default();
    let result_summary = result.and_then(|r| obj_str(r, "summary"));

    let has_explicit_error = result
        .map(|r| {
            r.get("error").and_then(|v| v.as_bool()) == Some(true)
                || r.get("is_error").and_then(|v| v.as_bool()) == Some(true)
                || r.get("error_message")
                    .and_then(|v| v.as_str())
                    .is_some_and(|s| !s.is_empty())
        })
        .unwrap_or(false);

    let success = !has_explicit_error
        && result
            .map(|r| {
                r.get("success").and_then(|v| v.as_bool()) == Some(true)
                    || r.get("status").and_then(|v| v.as_str()) == Some("completed")
                    || !result_content.is_empty()
            })
            .unwrap_or(false);

    let subagent_session_id = args.and_then(|a| obj_str(a, "subagentSessionId"));

    let elapsed_ms = args.and_then(|a| obj_f64(a, "elapsedMs"));
    let tool_call_count = args.and_then(|a| obj_i64(a, "toolCallCount"));
    let reasoning_text = args.and_then(|a| obj_str(a, "reasoningText"));
    let prompt = args.and_then(|a| obj_str(a, "prompt"));

    // Terminal failure state may ship its message via `error_message`, a
    // stringified `error`, or a generic `message` field. Only populate when
    // the call is not successful so the UI can surface the error text in the
    // expanded body (and collapsed summary) without bleeding into happy paths.
    let error_message = if !success {
        result.and_then(|r| {
            obj_str(r, "error_message")
                .or_else(|| obj_str(r, "error"))
                .or_else(|| obj_str(r, "message"))
        })
    } else {
        None
    };

    ExtractedSubagentData {
        description,
        subagent_type,
        result_content,
        result_summary,
        success,
        subagent_session_id,
        elapsed_ms,
        tool_call_count,
        reasoning_text,
        prompt,
        error_message,
    }
}

fn extract_delete_file(
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedDeleteFileData {
    let from_args = args.and_then(|a| {
        obj_str(a, "path")
            .or_else(|| obj_str(a, "file_path"))
            .or_else(|| obj_str(a, "target_file"))
    });

    let from_success = result
        .and_then(|r| r.get("success"))
        .and_then(|v| v.as_object())
        .and_then(|s| obj_str(s, "deletedFile").or_else(|| obj_str(s, "path")));

    let from_output_success = result
        .and_then(|r| r.get("output"))
        .and_then(|v| v.as_object())
        .and_then(|o| o.get("success"))
        .and_then(|v| v.as_object())
        .and_then(|s| obj_str(s, "deletedFile").or_else(|| obj_str(s, "path")));

    let file_path = from_args
        .or(from_success)
        .or(from_output_success)
        .unwrap_or_default();

    let file_name = if file_path.is_empty() {
        "file".to_string()
    } else {
        file_path
            .rsplit('/')
            .next()
            .unwrap_or(&file_path)
            .to_string()
    };

    ExtractedDeleteFileData {
        file_path,
        file_name,
    }
}

// ============================================================================
// Batch Extraction
// ============================================================================

/// Extract rendering data for a batch of events.
/// Returns pairs of (event_id, extracted_data) for events that have extractable data.
pub fn extract_batch(events: &[SessionEvent]) -> Vec<(String, ExtractedData)> {
    events
        .iter()
        .filter_map(|event| extract_event_data(event).map(|data| (event.id.clone(), data)))
        .collect()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
#[path = "tests/extractors_tests.rs"]
mod tests;

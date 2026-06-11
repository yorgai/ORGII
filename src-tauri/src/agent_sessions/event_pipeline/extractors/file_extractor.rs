//! File read, edit, apply_patch, and delete extractors.

use perf_utils::diff_patch::{convert_patch_to_unified, PatchSegment};

use super::helpers::{
    extract_fenced_diff, get_success_data, obj_str, parse_diff_start_lines, safe_str,
};
use super::lang::{detect_language, strip_line_number_prefixes_with_start};
use crate::agent_sessions::event_pipeline::extractors::types::*;

pub(super) fn extract_file(
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedFileData {
    let result_map = result.cloned().unwrap_or_default();
    let success = get_success_data(&result_map);

    let file_path = args
        .and_then(|a| {
            obj_str(a, "file_path")
                .or_else(|| obj_str(a, "filePath"))
                .or_else(|| obj_str(a, "target_file"))
                .or_else(|| obj_str(a, "targetFile"))
                .or_else(|| obj_str(a, "path"))
        })
        .or_else(|| {
            obj_str(&success, "path")
                .or_else(|| obj_str(&success, "file_path"))
                .or_else(|| obj_str(&success, "filePath"))
        })
        .or_else(|| {
            result.and_then(|r| {
                obj_str(r, "file_path")
                    .or_else(|| obj_str(r, "filePath"))
                    .or_else(|| obj_str(r, "path"))
            })
        })
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

    let (content, start_line) = match raw_content {
        Some(c) => {
            let (stripped, start) = strip_line_number_prefixes_with_start(&c);
            (Some(stripped), start)
        }
        None => (None, None),
    };
    let language = detect_language(&file_name);
    let line_count = content.as_ref().map(|c| c.split('\n').count());

    ExtractedFileData {
        file_path,
        file_name,
        content,
        language: language.to_string(),
        line_count,
        start_line,
    }
}

pub(super) fn extract_edit(
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

pub(super) fn extract_apply_patch(
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

pub(super) fn extract_real_apply_patch_result(
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

pub(super) fn segment_to_edit(
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

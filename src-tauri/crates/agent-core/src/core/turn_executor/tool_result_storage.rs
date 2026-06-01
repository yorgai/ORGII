//! Large tool result persistence — writes oversized results to disk and
//! replaces the in-context content with a compact preview + file path.
//!
//! The LLM can later `read_file` the persisted path to recover the full
//! content, so no information is permanently lost.
//!
//! Reference: `claude_code/utils/toolResultStorage.ts`

use std::fs;
use std::io;
use std::path::Path;

use tracing::info;

/// Default threshold (chars) above which a tool result is persisted to disk.
/// Referenced by `Tool::persist_threshold()` default in `traits.rs`.
pub(crate) const DEFAULT_PERSIST_THRESHOLD: usize = 50_000;

/// Max bytes shown in the inline preview.
const PREVIEW_SIZE_BYTES: usize = 2000;

const PERSISTED_OUTPUT_TAG: &str = "<persisted-output>";
const PERSISTED_OUTPUT_CLOSING_TAG: &str = "</persisted-output>";

pub struct PersistedResult {
    pub filepath: String,
    pub original_size: usize,
    pub preview: String,
    pub has_more: bool,
}

/// Persist a large tool result to disk.
///
/// Storage path: `{workspace}/.orgii/tool-results/{session_id}/{tool_call_id}.txt`
///
/// Writes are skipped if the file already exists (same tool_call_id = same
/// content), avoiding redundant I/O on retries.
pub fn persist_tool_result(
    workspace: &Path,
    session_id: &str,
    tool_call_id: &str,
    content: &str,
) -> io::Result<PersistedResult> {
    let dir = workspace
        .join(".orgii")
        .join("tool-results")
        .join(session_id);
    fs::create_dir_all(&dir)?;

    let filepath = dir.join(format!("{}.txt", sanitize_id(tool_call_id)));
    let filepath_str = filepath.display().to_string();

    if !filepath.exists() {
        fs::write(&filepath, content)?;
        info!(
            "[tool-result-storage] Persisted {} chars to {}",
            content.len(),
            filepath_str
        );
    }

    let (preview, has_more) = generate_preview(content, PREVIEW_SIZE_BYTES);

    Ok(PersistedResult {
        filepath: filepath_str,
        original_size: content.len(),
        preview,
        has_more,
    })
}

/// Build the replacement message that goes into the LLM context.
pub fn build_large_result_message(result: &PersistedResult) -> String {
    let size_display = format_size(result.original_size);
    let preview_display = format_size(PREVIEW_SIZE_BYTES);

    let mut msg = format!("{}\n", PERSISTED_OUTPUT_TAG);
    msg.push_str(&format!(
        "Output too large ({}). Full output saved to: {}\n\n",
        size_display, result.filepath
    ));
    msg.push_str(&format!("Preview (first {}):\n", preview_display));
    msg.push_str(&result.preview);
    if result.has_more {
        msg.push_str("\n...\n");
    } else {
        msg.push('\n');
    }
    msg.push_str(PERSISTED_OUTPUT_CLOSING_TAG);
    msg
}

fn generate_preview(content: &str, max_bytes: usize) -> (String, bool) {
    if content.len() <= max_bytes {
        return (content.to_string(), false);
    }
    let mut end = max_bytes;
    while !content.is_char_boundary(end) && end > 0 {
        end -= 1;
    }
    (content[..end].to_string(), true)
}

fn format_size(bytes: usize) -> String {
    if bytes >= 1_000_000 {
        format!("{:.1}MB", bytes as f64 / 1_000_000.0)
    } else if bytes >= 1_000 {
        format!("{:.1}KB", bytes as f64 / 1_000.0)
    } else {
        format!("{}B", bytes)
    }
}

fn sanitize_id(id: &str) -> String {
    id.chars()
        .map(|ch| {
            if ch.is_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_short_content() {
        let (preview, has_more) = generate_preview("hello", 100);
        assert_eq!(preview, "hello");
        assert!(!has_more);
    }

    #[test]
    fn preview_truncates_long_content() {
        let content = "x".repeat(5000);
        let (preview, has_more) = generate_preview(&content, 2000);
        assert_eq!(preview.len(), 2000);
        assert!(has_more);
    }

    #[test]
    fn format_size_kb() {
        assert_eq!(format_size(50_000), "50.0KB");
    }

    #[test]
    fn format_size_mb() {
        assert_eq!(format_size(1_500_000), "1.5MB");
    }

    #[test]
    fn build_message_contains_path() {
        let result = PersistedResult {
            filepath: "/tmp/test.txt".to_string(),
            original_size: 100_000,
            preview: "first 2000 chars...".to_string(),
            has_more: true,
        };
        let msg = build_large_result_message(&result);
        assert!(msg.contains("/tmp/test.txt"));
        assert!(msg.contains("<persisted-output>"));
        assert!(msg.contains("</persisted-output>"));
        assert!(msg.contains("100.0KB"));
    }

    #[test]
    fn persist_and_read_back() {
        let tmp = std::env::temp_dir().join("orgii_persist_test");
        let _ = std::fs::remove_dir_all(&tmp);
        let content = "a".repeat(60_000);
        let result = persist_tool_result(&tmp, "sess1", "call-123", &content).unwrap();
        assert!(result.has_more);
        assert_eq!(result.original_size, 60_000);

        let on_disk = std::fs::read_to_string(&result.filepath).unwrap();
        assert_eq!(on_disk.len(), 60_000);

        // Second write is a no-op (idempotent)
        let result2 = persist_tool_result(&tmp, "sess1", "call-123", &content).unwrap();
        assert_eq!(result2.filepath, result.filepath);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn sanitize_id_handles_special_chars() {
        assert_eq!(sanitize_id("tool/call:123"), "tool_call_123");
        assert_eq!(sanitize_id("normal-id_v2"), "normal-id_v2");
    }
}

//! Typed MCP tool call result + large-payload persistence.
//!
//! Pipeline:
//!
//! 1. Flatten MCP content blocks to a text string (handled by
//!    `McpClient::call_tool_typed`).
//! 2. If the flattened string is ≥ `MAX_RESULT_CHARS`, spill it to
//!    `~/.orgii/tool-results/<server>-<tool>-<utc>.txt` and return a
//!    reference stub the LLM can still read. Below that threshold we
//!    pass through unchanged.
//! 3. Propagate `_meta` and `structuredContent` alongside the text so
//!    future callers (auth pseudo-tool, diagnostics UI, the
//!    Anthropic-native wire format) can inspect them without re-calling
//!    the server.
//! 4. Preserve structured `content_blocks` (images, audio, resources,
//!    resource links) alongside the flattened text so the `McpBridgeTool`
//!    can propagate them as `ToolExecuteResult.content_blocks`. The
//!    bridge does not change the wire format — OpenAI-compat providers
//!    still receive only `text` — but the blocks survive inside the
//!    agent pipeline so Anthropic-native wire can start using them.
//!
//! The "fallback to truncation" branch fires when the user's home
//! directory can't be resolved, the `tool-results` directory can't be
//! created, or the write fails — we never want a disk error to hide the
//! tool's output.

use std::path::PathBuf;

use serde_json::Value;
use tracing::warn;

use crate::tools::traits::ToolContentBlock;

/// Max chars a single MCP tool result may carry in-memory before
/// falling back to disk persistence.
pub(crate) const MAX_RESULT_CHARS: usize = 100_000;

/// Typed result returned by `McpClient::call_tool_typed`.
///
/// Carries everything `McpBridgeTool` needs to populate
/// `ToolExecuteResult`:
/// - `text`: flattened LLM-facing string (the historical format every
///   provider has received).
/// - `content_blocks`: structured blocks (images/audio/resources/
///   resource links) so the Anthropic-native wire can pass them
///   through verbatim without re-parsing the string.
/// - `meta`: MCP `_meta` field from `CallToolResult` (opaque JSON).
/// - `structured_content`: `structuredContent` field (opaque JSON,
///   intended for machine-readable output alongside `content`).
///
/// `text` remains the only field the OpenAI-compat wire format uses —
/// the rest survive inside the agent pipeline until a consumer opts in
/// (diagnostics UI, Anthropic-native provider).
#[derive(Debug, Clone, Default)]
pub(crate) struct McpCallResult {
    pub(crate) text: String,
    pub(crate) content_blocks: Vec<ToolContentBlock>,
    pub(crate) meta: Option<Value>,
    pub(crate) structured_content: Option<Value>,
}

/// If `text` exceeds [`MAX_RESULT_CHARS`], spill it to disk and replace
/// `text` with a reference stub. Never panics: disk errors degrade to
/// hard truncation instead.
///
/// Returns `Some(path)` when the payload was persisted, `None` when it
/// fit in memory or persistence failed (caller can still surface the
/// truncated text in either case).
pub(crate) fn maybe_persist_large_payload(
    server: &str,
    tool: &str,
    text: &mut String,
) -> Option<PathBuf> {
    if text.chars().count() <= MAX_RESULT_CHARS {
        return None;
    }

    let dir = match tool_results_dir() {
        Some(dir) => dir,
        None => {
            hard_truncate(text);
            return None;
        }
    };

    if let Err(err) = std::fs::create_dir_all(&dir) {
        warn!(
            "[mcp:result] Failed to create {}: {}; falling back to in-memory truncation",
            dir.display(),
            err
        );
        hard_truncate(text);
        return None;
    }

    // Sanitize server/tool so we don't leak `/..` or spaces into the
    // filename (users can configure arbitrary server names).
    let server_s = sanitize(server);
    let tool_s = sanitize(tool);
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%3fZ").to_string();
    let filename = format!("{}-{}-{}.txt", server_s, tool_s, stamp);
    let path = dir.join(filename);

    if let Err(err) = std::fs::write(&path, text.as_bytes()) {
        warn!(
            "[mcp:result] Failed to persist to {}: {}; falling back to in-memory truncation",
            path.display(),
            err
        );
        hard_truncate(text);
        return None;
    }

    let reference = format!(
        "[MCP tool result was {} chars (>{} limit); full output persisted to {}]\n\nFirst {} chars follow:\n\n",
        text.chars().count(),
        MAX_RESULT_CHARS,
        path.display(),
        MAX_RESULT_CHARS / 4,
    );

    // Prefix a reference stub + include a short preview so the LLM can
    // still make forward progress without opening the file.
    let preview_chars = MAX_RESULT_CHARS / 4;
    let preview: String = crate::utils::safe_truncate_chars_to_string(&text, preview_chars);
    *text = reference + &preview + "…";

    Some(path)
}

/// Directory where oversized MCP tool results are spilled.
///
/// `$ORGII_HOME/tool-results/` when `ORGII_HOME` is set (used by tests to
/// redirect onto a temp dir), else `~/.orgii/tool-results/`.
fn tool_results_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("ORGII_HOME") {
        if !dir.is_empty() {
            return Some(PathBuf::from(dir).join("tool-results"));
        }
    }
    dirs::home_dir().map(|home| home.join(".orgii").join("tool-results"))
}

/// Replace characters that aren't safe in a filename with `_`. Keeps
/// the output ASCII-printable on every platform rmcp supports.
fn sanitize(input: &str) -> String {
    input
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Persist a raw binary blob (MCP `resources/read` response with a
/// `blob` branch) to `$ORGII_HOME/tool-results/` (or `~/.orgii/tool-results/`)
/// and return its on-disk path.
///
/// The LLM never sees the base64 bytes — only a path and a short English
/// breadcrumb. The filename encodes `<server>-<uri-slug>-<utc>.<ext>` so
/// concurrent reads of the same resource don't collide.
///
/// Returns `None` when disk persistence isn't available (no HOME, can't
/// create dir, write failed). Callers must surface a textual fallback to
/// the LLM in that case — we never want a disk error to stall a tool call.
pub(crate) fn persist_binary_blob(
    server: &str,
    uri: &str,
    mime_type: Option<&str>,
    bytes: &[u8],
) -> Option<PathBuf> {
    let dir = tool_results_dir()?;
    if let Err(err) = std::fs::create_dir_all(&dir) {
        warn!(
            "[mcp:result] Failed to create {}: {}; blob not persisted",
            dir.display(),
            err
        );
        return None;
    }

    let server_s = sanitize(server);
    let uri_s = sanitize(uri);
    // Truncate the URI slug so filename stays under typical FS limits
    // (256 bytes on most platforms). 80 chars leaves room for the
    // server, timestamp, and extension.
    let uri_trimmed: String = crate::utils::safe_truncate_chars_to_string(&uri_s, 80);
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%3fZ").to_string();
    let ext = extension_for_mime(mime_type);
    let filename = format!("{}-{}-{}.{}", server_s, uri_trimmed, stamp, ext);
    let path = dir.join(filename);

    if let Err(err) = std::fs::write(&path, bytes) {
        warn!(
            "[mcp:result] Failed to persist blob to {}: {}; blob not persisted",
            path.display(),
            err
        );
        return None;
    }

    Some(path)
}

/// Pick a file extension for a persisted MCP blob given its declared
/// MIME type. When the server doesn't declare a MIME, we fall back to
/// `bin` so the bytes are still recoverable — just without a helpful
/// suffix.
fn extension_for_mime(mime_type: Option<&str>) -> &'static str {
    match mime_type.unwrap_or("").to_ascii_lowercase().as_str() {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/bmp" => "bmp",
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/ogg" => "ogg",
        "audio/flac" => "flac",
        "application/pdf" => "pdf",
        "application/json" => "json",
        "application/zip" => "zip",
        "application/octet-stream" => "bin",
        "text/plain" => "txt",
        "text/csv" => "csv",
        "text/markdown" => "md",
        _ => "bin",
    }
}

/// Render the breadcrumb we surface to the LLM when a resource blob
/// was persisted. Short, uniform, and greppable — the LLM never has to
/// parse it, only know "hey, a file is there if I need it".
pub(crate) fn binary_blob_breadcrumb(
    path: &std::path::Path,
    mime_type: Option<&str>,
    size_bytes: u64,
    prefix: &str,
) -> String {
    let mime = mime_type.unwrap_or("application/octet-stream");
    format!(
        "{}Binary content ({}, {} bytes) saved to {}",
        prefix,
        mime,
        size_bytes,
        path.display()
    )
}

/// In-place char-boundary-safe truncation to [`MAX_RESULT_CHARS`] + a
/// trailing notice. Used only as the fallback when disk persistence
/// isn't available.
fn hard_truncate(text: &mut String) {
    let mut safe = MAX_RESULT_CHARS;
    while safe > 0 && !text.is_char_boundary(safe) {
        safe -= 1;
    }
    text.truncate(safe);
    text.push_str(&format!(
        "\n\n[Result truncated at {} chars — disk persistence unavailable]",
        MAX_RESULT_CHARS
    ));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_temp_orgii_home<F: FnOnce(&std::path::Path)>(test: F) {
        // Crate-wide sandbox: serializes every ORGII_HOME-mutating test
        // in the binary against a single process lock, and owns the
        // tempdir lifetime so nothing leaks on panic.
        let sb = test_helpers::test_env::sandbox();
        test(sb.path());
    }

    #[test]
    fn small_payload_passes_through() {
        let mut text = "hi there".to_string();
        let path = maybe_persist_large_payload("srv", "tool", &mut text);
        assert!(path.is_none());
        assert_eq!(text, "hi there");
    }

    #[test]
    fn oversized_payload_spills_to_disk() {
        with_temp_orgii_home(|home| {
            let big = "x".repeat(MAX_RESULT_CHARS + 10);
            let mut text = big.clone();
            let path =
                maybe_persist_large_payload("srv", "tool", &mut text).expect("should persist");
            assert!(path.starts_with(home));
            assert!(path.is_file());
            let on_disk = std::fs::read_to_string(&path).expect("read persisted");
            assert_eq!(on_disk, big);
            assert!(text.contains("persisted to"));
            assert!(text.len() < big.len());
        });
    }

    #[test]
    fn sanitize_strips_path_separators() {
        assert_eq!(sanitize("good_name-1"), "good_name-1");
        assert_eq!(sanitize("with/slash"), "with_slash");
        assert_eq!(sanitize("space here"), "space_here");
    }

    #[test]
    fn extension_for_mime_maps_known_types() {
        assert_eq!(extension_for_mime(Some("image/png")), "png");
        assert_eq!(extension_for_mime(Some("IMAGE/JPEG")), "jpg");
        assert_eq!(extension_for_mime(Some("audio/mp3")), "mp3");
        assert_eq!(extension_for_mime(Some("application/pdf")), "pdf");
        assert_eq!(extension_for_mime(Some("text/csv")), "csv");
    }

    #[test]
    fn extension_for_mime_falls_back_to_bin() {
        assert_eq!(extension_for_mime(None), "bin");
        assert_eq!(extension_for_mime(Some("")), "bin");
        assert_eq!(extension_for_mime(Some("weird/thing")), "bin");
    }

    #[test]
    fn persist_binary_blob_writes_bytes_and_picks_extension() {
        with_temp_orgii_home(|home| {
            let bytes: [u8; 5] = [0xDE, 0xAD, 0xBE, 0xEF, 0x00];
            let path =
                persist_binary_blob("srv", "file://example/foo.png", Some("image/png"), &bytes)
                    .expect("blob must persist");
            assert!(path.starts_with(home));
            assert!(path.is_file());
            assert_eq!(
                path.extension().and_then(|e| e.to_str()),
                Some("png"),
                "extension should follow the mime"
            );
            let read_back = std::fs::read(&path).expect("read persisted");
            assert_eq!(read_back, bytes);
        });
    }

    #[test]
    fn persist_binary_blob_uses_bin_extension_without_mime() {
        with_temp_orgii_home(|_home| {
            let path = persist_binary_blob("srv", "uri", None, b"data").expect("persist");
            assert_eq!(path.extension().and_then(|e| e.to_str()), Some("bin"));
        });
    }

    #[test]
    fn binary_blob_breadcrumb_includes_mime_and_path() {
        let path = std::path::PathBuf::from("/tmp/srv-foo-20260418.png");
        let msg = binary_blob_breadcrumb(&path, Some("image/png"), 123, "[res] ");
        assert!(msg.starts_with("[res] "));
        assert!(msg.contains("image/png"));
        assert!(msg.contains("123 bytes"));
        assert!(msg.contains("/tmp/srv-foo-20260418.png"));
    }
}

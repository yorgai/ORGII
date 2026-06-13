//! File read primitives: `read_file`, `read_file_in_range`, plus image/PDF/notebook handling.
//!
//! Every public read function is wrapped with [`super::FILE_IO_TIMEOUT`] so a
//! locked file or stalled network mount can never hang the agent loop.
//!
//! Read pipeline for `read_file_in_range_with_extras`:
//! 1. Resolve path through [`super::fallback::resolve_existing_entry`].
//! 2. Branch on file kind — notebook / image / PDF / plain text.
//! 3. For text-like content, format with offset+limit through [`format_text_result`].
//!
//! The byte/line limits guard against huge file dumps swamping the model context;
//! callers must explicitly opt-in to large reads by passing `offset`/`limit`.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use base64::Engine;

use super::fallback::resolve_existing_entry;
use super::formats::{
    detect_image_mime, extract_pdf_text, is_notebook, is_pdf, parse_notebook, MAX_IMAGE_SIZE_BYTES,
};
use super::path_resolution::EntryKind;
use super::FILE_IO_TIMEOUT;

/// Maximum file size (bytes) allowed for a full read without offset/limit.
/// Files larger than this require explicit offset/limit parameters.
const MAX_FILE_SIZE_BYTES: u64 = 256 * 1024; // 256 KB

/// Default maximum number of lines returned when no limit is specified.
const MAX_LINES_TO_READ: usize = 2000;

/// Metadata needed to validate whether a previous file read is still current.
#[derive(Debug, Clone)]
pub struct FileReadStat {
    pub total_bytes: u64,
    pub modified_millis: u128,
    pub resolved_path: PathBuf,
}

/// Result of a ranged file read.
#[derive(Debug)]
pub struct FileReadResult {
    /// Numbered content (lines with `   N│` prefix).
    pub content: String,
    /// 1-indexed start line of the returned range.
    pub start_line: usize,
    /// How many lines were actually returned.
    pub lines_read: usize,
    /// Total line count of the entire file.
    pub total_lines: usize,
    /// File size in bytes (from stat).
    pub total_bytes: u64,
    /// Last modified timestamp from metadata, milliseconds since unix epoch.
    pub modified_millis: u128,
    /// Canonical path after sandbox resolution.
    pub resolved_path: PathBuf,
    /// True when the default line limit truncated the output.
    pub truncated: bool,
}

fn modified_millis(metadata: &std::fs::Metadata) -> u128 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

/// Cheap streaming line count for the oversized-file error message, so the
/// model knows the file's shape before retrying with offset/limit. Bounded
/// by `FILE_IO_TIMEOUT` at the call site; `None` on any I/O error.
async fn count_lines(path: &Path) -> Option<usize> {
    use tokio::io::AsyncBufReadExt;
    let file = tokio::fs::File::open(path).await.ok()?;
    let mut reader = tokio::io::BufReader::new(file);
    let mut count = 0usize;
    let mut buf = Vec::with_capacity(8192);
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf).await {
            Ok(0) => break,
            Ok(_) => count += 1,
            Err(_) => return None,
        }
    }
    Some(count)
}

/// Resolve and stat a file without reading its content.
pub async fn stat_file_with_extras(
    path: &str,
    allowed_dir: Option<&Path>,
    additional_allowed_dirs: &[PathBuf],
) -> Result<FileReadStat, String> {
    let resolved =
        resolve_existing_entry(path, allowed_dir, additional_allowed_dirs, EntryKind::File)?;
    let inner = async {
        let metadata = tokio::fs::metadata(&resolved)
            .await
            .map_err(|err| format!("Failed to stat file: {}", err))?;
        if !metadata.is_file() {
            return Err(format!("Not a regular file: {}", path));
        }
        Ok(FileReadStat {
            total_bytes: metadata.len(),
            modified_millis: modified_millis(&metadata),
            resolved_path: resolved,
        })
    };

    tokio::time::timeout(FILE_IO_TIMEOUT, inner)
        .await
        .map_err(|_| {
            format!(
                "read_file stat timed out after {}s: {}",
                FILE_IO_TIMEOUT.as_secs(),
                path
            )
        })?
}

/// Read a file with optional line-range selection.
///
/// - `offset`: 1-indexed start line. Negative values count from end (e.g. -20 = last 20 lines).
///   `None` starts from line 1.
/// - `limit`: Maximum lines to return. `None` defaults to [`MAX_LINES_TO_READ`].
///
/// When neither `offset` nor `limit` is supplied and the file exceeds
/// [`MAX_FILE_SIZE_BYTES`], an error is returned that tells the model to
/// use `offset`/`limit` or search instead.
pub async fn read_file_in_range(
    path: &str,
    allowed_dir: Option<&Path>,
    offset: Option<i64>,
    limit: Option<usize>,
) -> Result<FileReadResult, String> {
    read_file_in_range_with_extras(path, allowed_dir, &[], offset, limit).await
}

/// Format extracted text (from any source: text file, PDF, notebook) into a `FileReadResult`
/// with line numbering and offset/limit support.
pub(crate) fn format_text_result(
    content: &str,
    file_size: u64,
    modified_millis: u128,
    resolved_path: PathBuf,
    offset: Option<i64>,
    limit: Option<usize>,
) -> Result<FileReadResult, String> {
    let all_lines: Vec<&str> = content.lines().collect();
    let total_lines = all_lines.len();
    let effective_limit = limit.unwrap_or(MAX_LINES_TO_READ);

    let start_idx = match offset {
        None | Some(0) => 0,
        Some(off) if off > 0 => ((off as usize).saturating_sub(1)).min(total_lines),
        Some(off) => total_lines.saturating_sub((-off) as usize),
    };

    let end_idx = (start_idx + effective_limit).min(total_lines);
    let selected = &all_lines[start_idx..end_idx];
    let truncated = end_idx < total_lines && limit.is_none();

    let numbered = selected
        .iter()
        .enumerate()
        .map(|(idx, line)| format!("{:>6}│{}", start_idx + idx + 1, line))
        .collect::<Vec<_>>()
        .join("\n");

    Ok(FileReadResult {
        content: numbered,
        start_line: start_idx + 1,
        lines_read: selected.len(),
        total_lines,
        total_bytes: file_size,
        modified_millis,
        resolved_path,
        truncated,
    })
}

/// Like [`read_file_in_range`], but with additional allowed directories (e.g., scratchpad).
pub async fn read_file_in_range_with_extras(
    path: &str,
    allowed_dir: Option<&Path>,
    additional_allowed_dirs: &[PathBuf],
    offset: Option<i64>,
    limit: Option<usize>,
) -> Result<FileReadResult, String> {
    let resolved =
        resolve_existing_entry(path, allowed_dir, additional_allowed_dirs, EntryKind::File)?;
    let path_display = path.to_string();

    let inner = async {
        let metadata = tokio::fs::metadata(&resolved)
            .await
            .map_err(|err| format!("Failed to stat file: {}", err))?;
        let file_size = metadata.len();
        let modified_millis = modified_millis(&metadata);

        // ── Notebook: parse .ipynb JSON before size check (they're usually small) ──
        if is_notebook(&resolved) {
            let raw = tokio::fs::read(&resolved)
                .await
                .map_err(|err| format!("Failed to read notebook: {}", err))?;
            let text = parse_notebook(&raw)?;
            return format_text_result(
                &text,
                file_size,
                modified_millis,
                resolved.clone(),
                offset,
                limit,
            );
        }

        // ── Image: return metadata + screenshot marker for inline display ──
        if let Some(mime) = detect_image_mime(&resolved) {
            if file_size > MAX_IMAGE_SIZE_BYTES {
                return Err(format!(
                    "Image too large ({:.1} MB, max {} MB).",
                    file_size as f64 / (1024.0 * 1024.0),
                    MAX_IMAGE_SIZE_BYTES / (1024 * 1024),
                ));
            }
            let raw = tokio::fs::read(&resolved)
                .await
                .map_err(|err| format!("Failed to read image: {}", err))?;

            let b64 = base64::engine::general_purpose::STANDARD.encode(&raw);
            let marker = format!(
                "Image: {} ({}, {:.1} KB)\n\n[image:{}:{}]",
                path_display,
                mime,
                file_size as f64 / 1024.0,
                mime,
                b64,
            );

            return Ok(FileReadResult {
                content: marker,
                start_line: 1,
                lines_read: 1,
                total_lines: 1,
                total_bytes: file_size,
                modified_millis,
                resolved_path: resolved.clone(),
                truncated: false,
            });
        }

        // ── PDF: extract text ──
        if is_pdf(&resolved, &[]) {
            let raw = tokio::fs::read(&resolved)
                .await
                .map_err(|err| format!("Failed to read PDF: {}", err))?;
            if is_pdf(&resolved, &raw) {
                let text = extract_pdf_text(&raw)?;
                if text.trim().is_empty() {
                    return Err("Scanned PDF with no extractable text layer.".to_string());
                }
                return format_text_result(
                    &text,
                    file_size,
                    modified_millis,
                    resolved.clone(),
                    offset,
                    limit,
                );
            }
        }

        // ── Standard text file ──
        // Reject oversized files when no range is specified
        if offset.is_none() && limit.is_none() && file_size > MAX_FILE_SIZE_BYTES {
            let total_lines = count_lines(&resolved).await;
            let line_hint = match total_lines {
                Some(count) => format!(" ({} lines total)", count),
                None => String::new(),
            };
            return Err(format!(
                "File is {:.1} KB{} — too large to read at once (limit {} KB without a range). \
                 Read it in chunks with `offset` and `limit` (e.g. offset=1, limit=2000), \
                 or filter it with `code_search` (action: grep) or `run_shell` with grep \
                 instead of reading the whole file.",
                file_size as f64 / 1024.0,
                line_hint,
                MAX_FILE_SIZE_BYTES / 1024,
            ));
        }

        let content = tokio::fs::read_to_string(&resolved).await.map_err(|err| {
            // Detect binary files that aren't recognized as image/PDF
            if err.kind() == std::io::ErrorKind::InvalidData {
                format!("Binary file — cannot read as text: {}", path_display)
            } else {
                format!("Failed to read file: {}", err)
            }
        })?;

        format_text_result(
            &content,
            file_size,
            modified_millis,
            resolved.clone(),
            offset,
            limit,
        )
    };

    tokio::time::timeout(FILE_IO_TIMEOUT, inner)
        .await
        .map_err(|_| {
            format!(
                "read_file timed out after {}s: {}",
                FILE_IO_TIMEOUT.as_secs(),
                path
            )
        })?
}

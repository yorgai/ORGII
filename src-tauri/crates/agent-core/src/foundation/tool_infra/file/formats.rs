//! Format detection and content extraction for non-text files.
//!
//! Handles three "non-plain-text" cases that `read_file_in_range` short-circuits:
//! - **Image** files (`detect_image_mime`) — returned as base64 markers.
//! - **PDF** files (`is_pdf` + `extract_pdf_text`) — text layer extracted with `pdf-extract`.
//! - **Jupyter notebooks** (`is_notebook` + `parse_notebook`) — JSON parsed into
//!   markdown-style cell concatenation.
//!
//! Pure helpers — no filesystem I/O, no async; callers do the reading.

use std::path::Path;

/// Maximum image file size for inline base64 encoding (20 MB).
pub(super) const MAX_IMAGE_SIZE_BYTES: u64 = 20 * 1024 * 1024;

/// Image MIME types supported for inline base64 reading.
const IMAGE_EXTENSIONS: &[(&str, &str)] = &[
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("png", "image/png"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
];

/// Detect image MIME type from file extension.
pub(crate) fn detect_image_mime(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    IMAGE_EXTENSIONS
        .iter()
        .find(|(e, _)| *e == ext)
        .map(|(_, mime)| *mime)
}

/// Detect if a file is a PDF (by extension or magic bytes).
pub(crate) fn is_pdf(path: &Path, bytes: &[u8]) -> bool {
    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
    {
        return true;
    }
    bytes.len() >= 4 && &bytes[0..4] == b"%PDF"
}

/// Detect if a file is a Jupyter notebook by `.ipynb` extension.
pub(crate) fn is_notebook(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("ipynb"))
}

/// Extract text content from a PDF file.
pub(crate) fn extract_pdf_text(bytes: &[u8]) -> Result<String, String> {
    pdf_extract::extract_text_from_mem(bytes).map_err(|err| format!("PDF parse error: {}", err))
}

/// Parse a Jupyter notebook (.ipynb) and convert to markdown-like text.
/// Extracts cell sources and outputs (text/plain only) so the LLM can
/// see both the code and its results.
pub(crate) fn parse_notebook(bytes: &[u8]) -> Result<String, String> {
    let json: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|err| format!("Notebook parse error: {}", err))?;

    let cells = json
        .get("cells")
        .and_then(|c| c.as_array())
        .ok_or_else(|| "Notebook missing 'cells' array".to_string())?;

    let mut output = String::new();
    for (idx, cell) in cells.iter().enumerate() {
        let cell_type = cell
            .get("cell_type")
            .and_then(|t| t.as_str())
            .unwrap_or("unknown");

        let source = cell
            .get("source")
            .and_then(|s| s.as_array())
            .map(|lines| lines.iter().filter_map(|l| l.as_str()).collect::<String>())
            .unwrap_or_default();

        if !output.is_empty() {
            output.push('\n');
        }
        output.push_str(&format!("# Cell {} [{}]\n", idx + 1, cell_type));
        output.push_str(&source);

        if let Some(outputs) = cell.get("outputs").and_then(|o| o.as_array()) {
            for out_item in outputs {
                if let Some(text) = out_item.get("text").and_then(|t| t.as_array()) {
                    let text_content: String = text.iter().filter_map(|l| l.as_str()).collect();
                    if !text_content.is_empty() {
                        output.push_str(&format!("\n# Output:\n{}", text_content));
                    }
                }
                if let Some(data) = out_item.get("data") {
                    if let Some(text) = data.get("text/plain").and_then(|t| t.as_array()) {
                        let text_content: String = text.iter().filter_map(|l| l.as_str()).collect();
                        if !text_content.is_empty() {
                            output.push_str(&format!("\n# Output:\n{}", text_content));
                        }
                    }
                }
            }
        }
    }

    if output.is_empty() {
        return Err("Notebook has no cells with content".to_string());
    }
    Ok(output)
}

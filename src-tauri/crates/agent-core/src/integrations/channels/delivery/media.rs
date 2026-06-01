//! `MEDIA:/path` protocol — extract from outbound, inject into inbound.
//!
//! Outbound flow: agent emits `MEDIA:/tmp/file.png` tokens in its response.
//! [`extract_media_refs`] strips them out of the user-facing content and
//! returns the resolved paths separately so the channel adapter can attach
//! them as actual files.
//!
//! Inbound flow: when the user sends a file/image, the channel adapter saves
//! the file locally and calls [`inject_inbound_media`] to append a
//! `[Image: MEDIA:/path]` (or `[Audio: …]` / `[Video: …]` / `[File: …]`) line
//! to the LLM-bound message so the model can reference it later.

const MEDIA_SCHEME: &str = "MEDIA:";

/// Extract `MEDIA:/path` references from an agent's response content.
///
/// Scans `content` for `MEDIA:/…` tokens. For each one:
/// - Removes the token from the text.
/// - Adds the resolved path to `media`.
///
/// Returns `(cleaned_content, media_paths)`.
///
/// Example:
/// ```text
/// "Here is the chart: MEDIA:/tmp/chart.png and MEDIA:/tmp/table.csv"
/// → content:  "Here is the chart:  and "
///   media:    ["/tmp/chart.png", "/tmp/table.csv"]
/// ```
pub fn extract_media_refs(content: &str) -> (String, Vec<String>) {
    let mut media: Vec<String> = Vec::new();
    let mut cleaned = String::with_capacity(content.len());

    let mut remaining = content;
    while let Some(start) = remaining.find(MEDIA_SCHEME) {
        cleaned.push_str(&remaining[..start]);
        let after_scheme = &remaining[start + MEDIA_SCHEME.len()..];
        let path_end = after_scheme
            .find(|c: char| c.is_whitespace() || c == ',' || c == ')' || c == ']')
            .unwrap_or(after_scheme.len());
        let path = &after_scheme[..path_end];
        if !path.is_empty() {
            media.push(path.to_string());
        }
        remaining = &after_scheme[path_end..];
    }
    cleaned.push_str(remaining);
    (cleaned.trim().to_string(), media)
}

/// Inject inbound media paths into the message content so the LLM can
/// reference them.
///
/// For each path in `media_paths`, appends a line of the form
/// `[Image: MEDIA:/path/to/file]` (or `[Audio: …]` / `[Video: …]` /
/// `[File: …]`).
///
/// This is called on `InboundMessage.content` before it reaches the agent.
pub fn inject_inbound_media(content: &str, media_paths: &[String]) -> String {
    if media_paths.is_empty() {
        return content.to_string();
    }
    let mut result = content.to_string();
    for path in media_paths {
        let label = classify_media_label(path);
        result.push_str(&format!("\n[{}: {}{}]", label, MEDIA_SCHEME, path));
    }
    result
}

fn classify_media_label(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".png")
        || lower.ends_with(".gif")
        || lower.ends_with(".webp")
        || lower.ends_with(".bmp")
    {
        "Image"
    } else if lower.ends_with(".mp3")
        || lower.ends_with(".wav")
        || lower.ends_with(".ogg")
        || lower.ends_with(".m4a")
        || lower.ends_with(".opus")
    {
        "Audio"
    } else if lower.ends_with(".mp4")
        || lower.ends_with(".mov")
        || lower.ends_with(".avi")
        || lower.ends_with(".webm")
    {
        "Video"
    } else {
        "File"
    }
}

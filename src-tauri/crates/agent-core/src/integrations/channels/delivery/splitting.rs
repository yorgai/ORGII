//! Chunking outbound messages so they fit a per-platform character limit.
//!
//! Splitter design:
//! - Honors a custom length function (`utf16_len` for Telegram, codepoints for the rest)
//! - Prefers newline boundaries, falls back to spaces, finally to a hard cut
//! - Closes orphaned ``` code fences and reopens them in the next chunk with the
//!   original language tag — so each chunk is valid markdown on its own
//! - Avoids splitting inside an inline `` `code` `` span
//! - Appends `(i/N)` indicators when the response spans multiple chunks

const CHUNK_INDICATOR_RESERVE: usize = 10; // room for " (XX/XX)"
const FENCE_CLOSE: &str = "\n```";

/// Count UTF-16 code units in `s`.
///
/// Telegram's 4 096-character limit is measured in UTF-16 code units, not
/// Unicode code points. Characters outside the BMP (emoji, CJK Extension B,
/// musical symbols …) are surrogate pairs and consume **two** units each.
pub fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// Split `content` into chunks that fit within `max_len` (measured by `len_fn`).
///
/// Preserves code-block boundaries: if a split would fall inside a triple-backtick
/// fence, the fence is closed at the end of the current chunk and reopened
/// (with the original language tag) at the start of the next.
///
/// When `len_fn` is `None`, Unicode code-point length (`str::chars().count()`)
/// is used. Pass `Some(utf16_len)` for platforms that measure in UTF-16 units.
pub fn split_message(
    content: &str,
    max_len: usize,
    len_fn: Option<fn(&str) -> usize>,
) -> Vec<String> {
    let measure: fn(&str) -> usize = len_fn.unwrap_or(|s: &str| s.chars().count());

    if measure(content) <= max_len {
        return vec![content.to_string()];
    }

    let mut chunks: Vec<String> = Vec::new();
    let mut remaining = content;
    // When the previous chunk ended mid-code-block, carries the language tag
    // so we can reopen the fence at the next chunk's start.
    let mut carry_lang: Option<String> = None;

    while !remaining.is_empty() {
        let prefix = match &carry_lang {
            Some(lang) => format!("```{}\n", lang),
            None => String::new(),
        };

        let headroom = max_len
            .saturating_sub(CHUNK_INDICATOR_RESERVE)
            .saturating_sub(measure(&prefix))
            .saturating_sub(measure(FENCE_CLOSE))
            .max(max_len / 2);

        if measure(&prefix) + measure(remaining) <= max_len.saturating_sub(CHUNK_INDICATOR_RESERVE)
        {
            chunks.push(format!("{}{}", prefix, remaining));
            break;
        }

        let cp_limit = custom_unit_to_cp(remaining, headroom, measure);

        let region = char_slice(remaining, cp_limit);
        let mut split_at = region.rfind('\n').unwrap_or(0);
        if split_at < cp_limit / 2 {
            split_at = region.rfind(' ').unwrap_or(split_at);
        }
        if split_at < 1 {
            split_at = cp_limit;
        }

        // Avoid splitting inside an inline code span (`...`).
        let candidate = char_slice(remaining, split_at);
        let backtick_count = candidate.chars().filter(|&c| c == '`').count();
        if backtick_count % 2 == 1 {
            if let Some(bt_pos) = candidate.rfind('`') {
                let safe = candidate[..bt_pos]
                    .rfind([' ', '\n'])
                    .filter(|&p| p > cp_limit / 4)
                    .unwrap_or(bt_pos);
                split_at = safe;
            }
        }

        let split_at = split_at.max(1); // prevent zero-progress infinite loop
        let chunk_body = char_slice(remaining, split_at);
        remaining = remaining[chunk_body.len()..].trim_start();

        let full_chunk = format!("{}{}", prefix, chunk_body);

        // Walk chunk_body to track whether we end inside an open code fence.
        let mut in_code = carry_lang.is_some();
        let mut lang = carry_lang.clone().unwrap_or_default();
        for line in chunk_body.lines() {
            let stripped = line.trim();
            if stripped.starts_with("```") {
                if in_code {
                    in_code = false;
                    lang = String::new();
                } else {
                    in_code = true;
                    lang = stripped
                        .strip_prefix("```")
                        .unwrap_or("")
                        .split_whitespace()
                        .next()
                        .unwrap_or("")
                        .to_string();
                }
            }
        }

        carry_lang = if in_code { Some(lang) } else { None };

        // Close an orphaned fence so the chunk is valid markdown on its own.
        let final_chunk = if carry_lang.is_some() {
            format!("{}{}", full_chunk, FENCE_CLOSE)
        } else {
            full_chunk
        };

        chunks.push(final_chunk);
    }

    // Append "(i/N)" indicators when the response spans multiple messages.
    if chunks.len() > 1 {
        let total = chunks.len();
        chunks = chunks
            .into_iter()
            .enumerate()
            .map(|(i, chunk)| format!("{} ({}/{})", chunk, i + 1, total))
            .collect();
    }

    chunks
}

/// Map a custom-unit budget to the largest codepoint offset `n` such that
/// `measure(&s[..n])` ≤ `budget`. Falls back to binary search.
pub(super) fn custom_unit_to_cp(s: &str, budget: usize, measure: fn(&str) -> usize) -> usize {
    let cp_count = s.chars().count();
    if measure(s) <= budget {
        return cp_count;
    }
    let mut lo = 0usize;
    let mut hi = cp_count;
    while lo < hi {
        let mid = (lo + hi).div_ceil(2);
        let prefix = char_slice(s, mid);
        if measure(prefix) <= budget {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    lo
}

/// Return a `&str` slice of the first `n` Unicode code-points of `s`.
pub(super) fn char_slice(s: &str, n: usize) -> &str {
    match s.char_indices().nth(n) {
        Some((byte_pos, _)) => &s[..byte_pos],
        None => s,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_utf16_len_ascii() {
        assert_eq!(utf16_len("hello"), 5);
    }

    #[test]
    fn test_utf16_len_emoji() {
        assert_eq!(utf16_len("😀"), 2);
        assert_eq!(utf16_len("hello 😀"), 8);
    }

    #[test]
    fn test_split_short_message() {
        let chunks = split_message("hello", 100, None);
        assert_eq!(chunks, vec!["hello"]);
    }

    #[test]
    fn test_split_long_message_no_code_block() {
        let content = "word ".repeat(40);
        let chunks = split_message(&content, 50, None);
        assert!(chunks.len() > 1, "should split into multiple chunks");
        for chunk in &chunks {
            assert!(
                chunk.chars().count() <= 60,
                "chunk too long: {} chars",
                chunk.chars().count()
            );
        }
        assert!(chunks[0].contains("(1/"), "first chunk missing indicator");
    }

    #[test]
    fn test_split_preserves_code_block() {
        let content = "Before\n```rust\nfn hello() {\n    println!(\"hi\");\n    println!(\"hi\");\n    println!(\"hi\");\n}\n```\nAfter";
        let chunks = split_message(content, 50, None);
        for chunk in &chunks {
            if chunk.starts_with("```") {
                let first_nl = chunk.find('\n').unwrap_or(chunk.len());
                assert!(first_nl > 3, "reopened fence must have a lang line");
            }
        }
    }

    #[test]
    fn test_split_with_utf16_len_fn() {
        let content = "😀".repeat(10);
        let chunks = split_message(&content, 10, Some(utf16_len));
        assert!(chunks.len() > 1, "should split by UTF-16 length");
    }

    #[test]
    fn test_split_adds_indicators() {
        let content = "a".repeat(200);
        let chunks = split_message(&content, 50, None);
        assert!(chunks.len() >= 4, "expected ≥4 chunks");
        for (i, chunk) in chunks.iter().enumerate() {
            assert!(
                chunk.contains(&format!("({}/", i + 1)),
                "chunk {} missing indicator",
                i + 1
            );
        }
    }
}

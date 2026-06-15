//! UTF-8 safe string truncation — the crate-wide canonical helpers.
//!
//! Naive `&s[..n]` panics when `n` lands in the middle of a multi-byte
//! character. These helpers round the cut point down to the nearest UTF-8
//! char boundary so truncation never panics on emoji, CJK, accents, etc.
//!
//! Two flavors:
//! - [`safe_truncate_utf8`] caps by **byte** length (use for size budgets:
//!   HTTP error bodies, prompt KB caps, DB columns).
//! - [`safe_truncate_chars`] caps by **char** count (use for length limits
//!   that count characters, e.g. Anthropic tool-name/description limits).
//!
//! Prefer these over hand-rolling an `is_char_boundary` loop. Call sites that
//! need a suffix/marker should truncate with one of these, then append.

/// Truncate `s` so it is at most `max_bytes` bytes long, snapping the cut
/// point back to the nearest UTF-8 char boundary. Never panics on multi-byte
/// characters.
pub fn safe_truncate_utf8(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while !s.is_char_boundary(end) && end > 0 {
        end -= 1;
    }
    &s[..end]
}

/// Truncate `s` so it contains at most `max_chars` Unicode scalar values
/// (chars), at a UTF-8 char boundary. Never panics. Returns the full string
/// when it already has `max_chars` or fewer chars.
pub fn safe_truncate_chars(s: &str, max_chars: usize) -> &str {
    match s.char_indices().nth(max_chars) {
        Some((byte_idx, _)) => &s[..byte_idx],
        None => s,
    }
}

/// Like [`safe_truncate_chars`], but returns an owned `String`. Borrows any
/// `AsRef<str>` input (including `String` fields and wire-protocol text buffers).
pub fn safe_truncate_chars_to_string(
    s: &(impl AsRef<str> + ?Sized),
    max_chars: usize,
) -> String {
    safe_truncate_chars(s.as_ref(), max_chars).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_within_limit() {
        assert_eq!(safe_truncate_utf8("hello", 10), "hello");
    }

    #[test]
    fn ascii_truncated() {
        assert_eq!(safe_truncate_utf8("hello world", 5), "hello");
    }

    #[test]
    fn multibyte_boundary_never_splits() {
        let s = "héllo";
        let prefix = safe_truncate_utf8(s, 2);
        assert!(prefix.len() <= 2);
        assert!(prefix.is_char_boundary(prefix.len()));
    }

    #[test]
    fn multibyte_emoji_cut_mid_char_snaps_back() {
        // "a😀" — '😀' is 4 bytes (1..=4). Cutting at byte 2/3/4 must not panic
        // and must round down to byte 1 (just "a").
        let s = "a😀";
        for cut in 1..s.len() {
            let prefix = safe_truncate_utf8(s, cut);
            assert!(prefix.is_char_boundary(prefix.len()));
        }
        assert_eq!(safe_truncate_utf8(s, 2), "a");
    }

    #[test]
    fn cjk_boundary() {
        // Each CJK char here is 3 bytes.
        let s = "你好世界";
        let prefix = safe_truncate_utf8(s, 4);
        assert_eq!(prefix, "你");
        assert!(prefix.is_char_boundary(prefix.len()));
    }

    #[test]
    fn empty_string() {
        assert_eq!(safe_truncate_utf8("", 10), "");
    }

    #[test]
    fn chars_within_limit() {
        assert_eq!(safe_truncate_chars("héllo", 10), "héllo");
    }

    #[test]
    fn chars_exact_limit_unchanged() {
        assert_eq!(safe_truncate_chars("héllo", 5), "héllo");
    }

    #[test]
    fn chars_truncated_counts_chars_not_bytes() {
        // "héllo" has 5 chars but 6 bytes (é is 2 bytes). Truncating to 2
        // chars yields "hé" (3 bytes), proving char-not-byte counting.
        let out = safe_truncate_chars("héllo", 2);
        assert_eq!(out, "hé");
        assert_eq!(out.chars().count(), 2);
    }

    #[test]
    fn chars_multibyte_emoji() {
        assert_eq!(safe_truncate_chars("😀😀😀", 1), "😀");
    }

    #[test]
    fn chars_empty_string() {
        assert_eq!(safe_truncate_chars("", 5), "");
    }
}

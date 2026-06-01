//! UTF-8 safe string truncation used by every provider client when echoing
//! HTTP error bodies back to the agent. Naive `&s[..n]` panics on multi-byte
//! characters; this helper rounds `n` down to the nearest char boundary.

/// Truncate a string at a UTF-8 char boundary (never panics on multi-byte).
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
    fn multibyte_boundary() {
        let s = "héllo";
        let prefix = safe_truncate_utf8(s, 2);
        assert!(prefix.len() <= 2);
        assert!(prefix.is_char_boundary(prefix.len()));
    }

    #[test]
    fn empty_string() {
        assert_eq!(safe_truncate_utf8("", 10), "");
    }
}

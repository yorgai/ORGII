//! Aggressive markdown stripper used by the retry path's plain-text fallback.
//!
//! ## Why "aggressive"?
//!
//! A previous version only trimmed the START of each line, leaving inline
//! markers like `**bold**`, `` `code` ``, `[link](url)`, and dropped-fence
//! remnants intact. When the plain-text body was then sent back into the
//! Telegram pipeline, `content_looks_like_markdown()` would re-flag it as
//! Markdown and the whole retry cycle could fail again — leaving the user
//! with only the "(Response formatting failed, plain text:)" prefix and no
//! actual content.
//!
//! This version is aggressive on purpose: ALL Markdown-bearing characters
//! are either removed or replaced. The resulting text must be safe to send
//! with NO `parse_mode` AND pass `content_looks_like_markdown` as `false`.

pub(super) fn strip_markdown(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut in_fence = false;
    for raw_line in text.lines() {
        let trimmed = raw_line.trim_start();

        // Skip entire fenced code blocks — they rarely survive stripping
        // and their content is usually not useful as prose fallback.
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }

        // Drop block prefixes (`#`, `>`, `-`, `*`, `+`, numbered lists).
        let mut body = trimmed;
        body = body.trim_start_matches('#').trim_start();
        body = body.trim_start_matches('>').trim_start();
        if let Some(rest) = body.strip_prefix("- ") {
            body = rest;
        } else if let Some(rest) = body.strip_prefix("* ") {
            body = rest;
        } else if let Some(rest) = body.strip_prefix("+ ") {
            body = rest;
        } else if let Some(rest) = strip_numbered_list_prefix(body) {
            body = rest;
        }

        let cleaned = strip_inline_markdown(body);
        result.push_str(&cleaned);
        result.push('\n');
    }
    result.trim().to_string()
}

/// Remove a leading numbered-list prefix (`"1. "`, `"12. "`, …) from `s`.
fn strip_numbered_list_prefix(s: &str) -> Option<&str> {
    let dot = s.find('.')?;
    let digits = &s[..dot];
    if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let after = &s[dot + 1..];
    after.strip_prefix(' ')
}

/// Strip inline Markdown constructs (`**bold**`, `*italic*`, `_em_`,
/// `` `code` ``, `[text](url)`, `![alt](src)`) from a single line.
///
/// Best-effort textual pass — NOT a full Markdown parser. Goal: produce
/// output where `content_looks_like_markdown()` returns `false`.
fn strip_inline_markdown(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            // `[text](url)` and `![alt](src)` → keep only `text`/`alt`.
            '!' if chars.peek() == Some(&'[') => {
                chars.next();
                let text = consume_until(&mut chars, ']');
                if chars.peek() == Some(&'(') {
                    chars.next();
                    let _ = consume_until(&mut chars, ')');
                }
                out.push_str(&text);
            }
            '[' => {
                let text = consume_until(&mut chars, ']');
                if chars.peek() == Some(&'(') {
                    chars.next();
                    let _ = consume_until(&mut chars, ')');
                    out.push_str(&text);
                } else {
                    // Not a real link — keep the bracket contents verbatim.
                    out.push('[');
                    out.push_str(&text);
                    out.push(']');
                }
            }
            // Inline code: drop the backticks, keep the contents.
            '`' => {
                let content = consume_until(&mut chars, '`');
                out.push_str(&content);
            }
            // Emphasis markers — just drop. `**bold**` → `bold`,
            // `_em_` → `em`, leftover single `*`/`_` drop too.
            '*' | '_' => {}
            _ => out.push(ch),
        }
    }
    out
}

fn consume_until(chars: &mut std::iter::Peekable<std::str::Chars<'_>>, end: char) -> String {
    let mut buf = String::new();
    for ch in chars.by_ref() {
        if ch == end {
            return buf;
        }
        buf.push(ch);
    }
    buf
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_markdown() {
        let md = "# Header\n**bold** text\n```\ncode\n```\n> quote";
        let plain = strip_markdown(md);
        assert!(!plain.contains('#'), "headers should be stripped");
        assert!(!plain.contains("```"), "fences should be stripped");
    }

    #[test]
    fn test_strip_markdown_inline_removed() {
        let md = "**bold**, *italic*, _em_, `code`, [text](https://example.com)";
        let plain = strip_markdown(md);
        assert!(!plain.contains("**"), "bold markers leaked: {:?}", plain);
        assert!(
            !plain.contains('`'),
            "inline code ticks leaked: {:?}",
            plain
        );
        assert!(
            !plain.contains("](") && !plain.contains("http"),
            "link syntax or URL leaked: {:?}",
            plain
        );
        assert!(plain.contains("bold"), "bold text lost: {:?}", plain);
        assert!(plain.contains("italic"), "italic text lost: {:?}", plain);
        assert!(plain.contains("text"), "link text lost: {:?}", plain);
    }

    #[test]
    fn test_strip_markdown_real_world_help_reply() {
        let md = "## 💻 编码与开发\n- 读写、编辑代码文件\n- **搜索** `grep`\n\n---\n\n当前环境信息：\n- macOS (aarch64)\n- [Home](https://example.com)";
        let plain = strip_markdown(md);
        assert!(!plain.is_empty(), "fallback must not be empty");
        assert!(!plain.contains("**"), "bold leaked");
        assert!(!plain.contains('`'), "inline code leaked");
        assert!(
            !plain.contains("](") && !plain.contains("http"),
            "link leaked"
        );
        assert!(plain.matches("```").count() == 0, "fenced code leaked");
        assert!(
            plain.matches('`').count() < 2,
            "paired inline-code ticks leaked"
        );
        assert!(
            !(plain.contains("](") && plain.contains('[')),
            "link-like token pair leaked"
        );
        assert!(
            plain.matches('*').count() < 2,
            "paired bold/italic stars leaked"
        );
        assert!(
            plain.matches('_').count() < 2,
            "paired italic underscores leaked"
        );
    }

    #[test]
    fn test_strip_numbered_list_prefix() {
        let md = "1. first\n12. twelfth\nnot a list";
        let plain = strip_markdown(md);
        assert!(!plain.contains("1."), "list prefix leaked: {:?}", plain);
        assert!(plain.contains("first"));
        assert!(plain.contains("twelfth"));
        assert!(plain.contains("not a list"));
    }
}

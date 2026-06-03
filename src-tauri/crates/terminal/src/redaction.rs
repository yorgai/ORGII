use regex::Regex;
use std::sync::OnceLock;

const REDACTION_PLACEHOLDER: &str = "secret_*******";

fn redaction_patterns() -> &'static [Regex] {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        [
            r#"(?i)(\b[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASS|PRIVATE[_-]?KEY|SESSION[_-]?TOKEN|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN)[A-Z0-9_]*\b\s*[:=]\s*)[^\s'\"]+"#,
            r#"(?i)(\bBearer\s+)[A-Za-z0-9._~+/=-]{12,}"#,
            r#"\bgh[pousr]_[A-Za-z0-9_]{20,}\b"#,
            r#"\bsk-[A-Za-z0-9_-]{20,}\b"#,
            r#"\bAKIA[0-9A-Z]{16}\b"#,
            r#"\bASIA[0-9A-Z]{16}\b"#,
            r#"\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b"#,
            r#"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"#,
        ]
        .into_iter()
        .map(|pattern| Regex::new(pattern).expect("terminal redaction regex must compile"))
        .collect()
    })
}

pub fn redact_terminal_text(input: &str) -> String {
    let mut redacted = input.to_string();
    for pattern in redaction_patterns() {
        redacted = pattern
            .replace_all(&redacted, |captures: &regex::Captures<'_>| {
                if captures.len() > 1 {
                    format!("{}{}", &captures[1], REDACTION_PLACEHOLDER)
                } else {
                    REDACTION_PLACEHOLDER.to_string()
                }
            })
            .into_owned();
    }
    redacted
}

pub fn append_redacted_bounded(buffer: &mut String, chunk: &str, max_chars: usize) {
    let redacted = redact_terminal_text(chunk);
    buffer.push_str(&redacted);
    let char_count = buffer.chars().count();
    if char_count > max_chars {
        let keep_from = char_count - max_chars;
        *buffer = buffer.chars().skip(keep_from).collect();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_key_value_secrets() {
        let output = redact_terminal_text("OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz\n");
        assert!(output.contains("OPENAI_API_KEY=secret_*******"));
        assert!(!output.contains("abcdefghijklmnopqrstuvwxyz"));
    }

    #[test]
    fn redacts_bearer_tokens() {
        let output = redact_terminal_text("Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456");
        assert_eq!(output, "Authorization: Bearer secret_*******");
    }

    #[test]
    fn bounds_redacted_buffer() {
        let mut buffer = String::new();
        append_redacted_bounded(&mut buffer, "abcdef", 4);
        assert_eq!(buffer, "cdef");
    }
}

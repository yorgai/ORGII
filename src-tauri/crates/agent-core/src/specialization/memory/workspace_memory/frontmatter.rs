//! YAML frontmatter parsing for memory files.
//!
//! Memory files start with `---\n<key: value lines>\n---\n`. Anything
//! beyond `FRONTMATTER_MAX_LINES` is ignored — that cap is the only reason
//! `MemoryHeader` parsing is cheap enough to run on every scan.

use std::collections::HashMap;

use super::FRONTMATTER_MAX_LINES;

/// Parse YAML frontmatter from the beginning of a markdown file.
///
/// Frontmatter is delimited by `---` lines. Returns a map of key-value pairs
/// and the remaining content after the closing `---`.
pub fn parse_frontmatter(content: &str) -> (HashMap<String, String>, &str) {
    let lines: Vec<&str> = content.lines().collect();

    if lines.is_empty() || lines[0].trim() != "---" {
        return (HashMap::new(), content);
    }

    let mut end_idx = None;
    let limit = lines.len().min(FRONTMATTER_MAX_LINES);
    for (offset, line) in lines[1..limit].iter().enumerate() {
        if line.trim() == "---" {
            end_idx = Some(offset + 1);
            break;
        }
    }

    let end_idx = match end_idx {
        Some(idx) => idx,
        None => return (HashMap::new(), content),
    };

    let mut map = HashMap::new();
    for line in &lines[1..end_idx] {
        if let Some((key, value)) = line.split_once(':') {
            let key = key.trim().to_lowercase();
            let value = value.trim().to_string();
            if !key.is_empty() && !value.is_empty() {
                map.insert(key, value);
            }
        }
    }

    let body_start: usize = lines[..=end_idx]
        .iter()
        .map(|line| line.len() + 1) // +1 for newline
        .sum();

    let body = if body_start <= content.len() {
        &content[body_start..]
    } else {
        ""
    };

    (map, body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_frontmatter_valid() {
        let content = "---\nname: Test Memory\ndescription: A test\ntype: user\n---\nBody content";
        let (fm, body) = parse_frontmatter(content);
        assert_eq!(fm.get("name").unwrap(), "Test Memory");
        assert_eq!(fm.get("description").unwrap(), "A test");
        assert_eq!(fm.get("type").unwrap(), "user");
        assert!(body.starts_with("Body content"));
    }

    #[test]
    fn test_parse_frontmatter_missing() {
        let content = "Just regular markdown\nNo frontmatter here";
        let (fm, body) = parse_frontmatter(content);
        assert!(fm.is_empty());
        assert_eq!(body, content);
    }

    #[test]
    fn test_parse_frontmatter_empty_values() {
        let content = "---\nname:\ndescription: Has value\n---\nBody";
        let (fm, _) = parse_frontmatter(content);
        assert!(!fm.contains_key("name"));
        assert_eq!(fm.get("description").unwrap(), "Has value");
    }
}

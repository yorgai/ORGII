//! Language detection and line-number-prefix stripping utilities.

use std::collections::HashMap;
use std::sync::LazyLock;

static LANG_MAP: LazyLock<HashMap<&'static str, &'static str>> =
    LazyLock::new(|| {
        let mut m = HashMap::new();
        m.insert("ts", "typescript");
        m.insert("tsx", "typescript");
        m.insert("js", "javascript");
        m.insert("jsx", "javascript");
        m.insert("py", "python");
        m.insert("rs", "rust");
        m.insert("go", "go");
        m.insert("java", "java");
        m.insert("rb", "ruby");
        m.insert("php", "php");
        m.insert("css", "css");
        m.insert("scss", "scss");
        m.insert("html", "html");
        m.insert("json", "json");
        m.insert("yaml", "yaml");
        m.insert("yml", "yaml");
        m.insert("md", "markdown");
        m.insert("sh", "bash");
        m.insert("sql", "sql");
        m.insert("toml", "toml");
        m.insert("xml", "xml");
        m.insert("c", "c");
        m.insert("cpp", "cpp");
        m.insert("h", "c");
        m.insert("hpp", "cpp");
        m.insert("cs", "csharp");
        m.insert("swift", "swift");
        m.insert("kt", "kotlin");
        m
    });

pub fn detect_language(file_name: &str) -> &'static str {
    let ext = file_name.rsplit('.').next().unwrap_or("");
    LANG_MAP.get(ext).copied().unwrap_or("plaintext")
}

/// Separator characters written by `read_file_in_range` (and legacy variants)
/// between the right-aligned line number and the line content.
///
/// Current: `│` (U+2502 BOX DRAWINGS LIGHT VERTICAL), emitted by
/// `foundation/tool_infra/file.rs::format_text_result`.
/// Legacy: `→` (U+2192) for events created before the box-drawing switch.
const LINE_NUMBER_SEPARATORS: &[char] = &['│', '→'];

fn find_line_number_separator(line: &str) -> Option<(usize, char)> {
    LINE_NUMBER_SEPARATORS
        .iter()
        .filter_map(|sep| line.find(*sep).map(|idx| (idx, *sep)))
        .min_by_key(|(idx, _)| *idx)
}

/// Returns true if `line` looks like a numbered prefix line
/// (`<optional whitespace><digits><separator>...`).
fn looks_like_numbered_line(line: &str) -> bool {
    line.trim_start().starts_with(|c: char| c.is_ascii_digit())
        && find_line_number_separator(line).is_some()
}

/// Public version exposed to Tauri commands for direct invocation on large content.
///
/// Strips:
/// 1. The leading `[action: ...]` marker line that `read_file` prepends
///    (see `agent_core/core/tools/impls/coding/files.rs::classify_read_action`).
/// 2. Per-line `<digits><separator>` prefixes from each line of the body.
///
/// Both are written purely for the LLM's benefit; the UI must not show them.
pub fn strip_line_number_prefixes_pub(content: &str) -> String {
    strip_line_number_prefixes_with_start(content).0
}

/// Like [`strip_line_number_prefixes_pub`], but also returns the 1-indexed
/// line number parsed from the first numbered line (the read's start offset).
/// `None` when the content carried no line-number prefixes.
pub fn strip_line_number_prefixes_with_start(content: &str) -> (String, Option<usize>) {
    let lines: Vec<&str> = content.split('\n').collect();

    // Skip a single leading `[action: ...]` marker if present.
    let body_start = if lines
        .first()
        .map(|l| l.starts_with("[action:") && l.ends_with(']'))
        .unwrap_or(false)
    {
        1
    } else {
        0
    };

    let body = &lines[body_start..];

    // Only strip when the first non-empty body line looks like a numbered
    // prefix. This avoids mangling file contents that happen to contain
    // `│` or `→` for unrelated reasons (e.g. ASCII art, comments).
    let first_non_empty = body.iter().find(|l| !l.trim().is_empty());
    let Some(first_line) = first_non_empty else {
        // Nothing to strip beyond the action marker; preserve original
        // structure unless we explicitly removed the marker.
        return if body_start > 0 {
            (body.join("\n"), None)
        } else {
            (content.to_string(), None)
        };
    };

    if !looks_like_numbered_line(first_line) {
        return if body_start > 0 {
            (body.join("\n"), None)
        } else {
            (content.to_string(), None)
        };
    }

    let start_line = first_line.trim_start();
    let digits: String = start_line
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    let parsed_start = digits.parse::<usize>().ok();

    let stripped = body
        .iter()
        .map(|l| {
            if let Some((idx, sep)) = find_line_number_separator(l) {
                &l[idx + sep.len_utf8()..]
            } else {
                *l
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    (stripped, parsed_start)
}

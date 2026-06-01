//! Chat Event Search
//!
//! High-performance in-memory search across session events.
//! Replaces the TypeScript `useChatSearch` linear scan with a Rust implementation
//! that avoids IPC serialization of the full event list.

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::agent_sessions::event_pipeline::types::SessionEvent;

const MAX_STRING_LEN: usize = 10_000;
const SNIPPET_CONTEXT: usize = 40;
const MAX_SNIPPET_LEN: usize = 160;

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSearchOptions {
    pub query: String,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub use_regex: bool,
    #[serde(default)]
    pub whole_word: bool,
    #[serde(default = "default_max_results")]
    pub max_results: usize,
}

fn default_max_results() -> usize {
    100
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSearchResult {
    /// Uses chunk_id when available (matches ChatItem.chunk_id on the TS side),
    /// falls back to event.id for events without a chunk_id.
    pub event_id: String,
    pub chat_index: usize,
    pub score: usize,
    pub snippet: String,
}

// ============================================================================
// Searchable Text Extraction
// ============================================================================

fn extract_strings_from_value(
    value: &serde_json::Value,
    parts: &mut Vec<String>,
    max_depth: usize,
    current_depth: usize,
) {
    if current_depth >= max_depth {
        return;
    }
    match value {
        serde_json::Value::String(s) if s.len() < MAX_STRING_LEN => {
            parts.push(s.clone());
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                extract_strings_from_value(item, parts, max_depth, current_depth + 1);
            }
        }
        serde_json::Value::Object(obj) => {
            for val in obj.values() {
                extract_strings_from_value(val, parts, max_depth, current_depth + 1);
            }
        }
        _ => {}
    }
}

/// Build searchable text from a SessionEvent, mirroring the TS `getSearchableText`.
fn build_searchable_text(event: &SessionEvent) -> String {
    let mut parts = Vec::with_capacity(8);

    if !event.function_name.is_empty() {
        parts.push(event.function_name.clone());
    }
    if !event.action_type.is_empty() {
        parts.push(event.action_type.clone());
    }

    extract_strings_from_value(&event.args, &mut parts, 3, 0);
    extract_strings_from_value(&event.result, &mut parts, 4, 0);

    if !event.display_text.is_empty() {
        parts.push(event.display_text.clone());
    }

    parts.join(" ")
}

// ============================================================================
// Snippet Creation
// ============================================================================

/// Find the nearest char boundary at or before `index`.
fn floor_char(s: &str, index: usize) -> usize {
    if index >= s.len() {
        return s.len();
    }
    let mut pos = index;
    while pos > 0 && !s.is_char_boundary(pos) {
        pos -= 1;
    }
    pos
}

/// Find the nearest char boundary at or after `index`.
fn ceil_char(s: &str, index: usize) -> usize {
    if index >= s.len() {
        return s.len();
    }
    let mut pos = index;
    while pos < s.len() && !s.is_char_boundary(pos) {
        pos += 1;
    }
    pos
}

pub(crate) fn create_snippet(text: &str, query: &str, case_sensitive: bool) -> String {
    let match_index = if case_sensitive {
        text.find(query)
    } else {
        let lower_text = text.to_lowercase();
        let lower_query = query.to_lowercase();
        lower_text.find(&lower_query)
    };

    let match_index = match match_index {
        Some(idx) => idx,
        None => return String::new(),
    };

    let start = floor_char(text, match_index.saturating_sub(SNIPPET_CONTEXT));
    let end = ceil_char(
        text,
        (match_index + query.len() + SNIPPET_CONTEXT).min(text.len()),
    );

    let mut snippet = String::with_capacity(end - start + 8);
    if start > 0 {
        snippet.push_str("...");
    }
    snippet.push_str(&text[start..end]);
    if end < text.len() {
        snippet.push_str("...");
    }

    if snippet.len() > MAX_SNIPPET_LEN {
        let truncated = floor_char(&snippet, MAX_SNIPPET_LEN);
        snippet.truncate(truncated);
        snippet.push_str("...");
    }

    snippet
}

// ============================================================================
// Search Implementation
// ============================================================================

enum Matcher {
    Plain {
        needle: String,
        case_sensitive: bool,
    },
    Regex(Regex),
}

impl Matcher {
    fn find(&self, text: &str) -> Option<usize> {
        match self {
            Matcher::Plain {
                needle,
                case_sensitive,
            } => {
                if *case_sensitive {
                    text.find(needle.as_str())
                } else {
                    text.to_lowercase().find(needle.as_str())
                }
            }
            Matcher::Regex(re) => re.find(text).map(|m| m.start()),
        }
    }
}

fn build_matcher(options: &ChatSearchOptions) -> Option<Matcher> {
    let trimmed = options.query.trim();
    if trimmed.is_empty() {
        return None;
    }

    if options.use_regex || options.whole_word {
        let pattern = if options.whole_word {
            if options.use_regex {
                format!(r"\b{}\b", trimmed)
            } else {
                format!(r"\b{}\b", regex::escape(trimmed))
            }
        } else {
            trimmed.to_string()
        };

        let full_pattern = if options.case_sensitive {
            pattern
        } else {
            format!("(?i){}", pattern)
        };

        match Regex::new(&full_pattern) {
            Ok(re) => Some(Matcher::Regex(re)),
            Err(_) => None,
        }
    } else {
        let needle = if options.case_sensitive {
            trimmed.to_string()
        } else {
            trimmed.to_lowercase()
        };
        Some(Matcher::Plain {
            needle,
            case_sensitive: options.case_sensitive,
        })
    }
}

/// Search through chat-visible events and return matching results.
pub fn search_chat_events(
    chat_events: &[SessionEvent],
    options: &ChatSearchOptions,
) -> Vec<ChatSearchResult> {
    let matcher = match build_matcher(options) {
        Some(m) => m,
        None => return Vec::new(),
    };

    let trimmed = options.query.trim();
    let mut results = Vec::new();

    for (chat_index, event) in chat_events.iter().enumerate() {
        if results.len() >= options.max_results {
            break;
        }

        let searchable = build_searchable_text(event);
        if let Some(match_pos) = matcher.find(&searchable) {
            let snippet = create_snippet(&searchable, trimmed, options.case_sensitive);
            let resolved_id = event
                .chunk_id
                .as_ref()
                .filter(|cid| !cid.is_empty())
                .cloned()
                .unwrap_or_else(|| event.id.clone());
            results.push(ChatSearchResult {
                event_id: resolved_id,
                chat_index,
                score: match_pos,
                snippet,
            });
        }
    }

    results.sort_by_key(|r| r.score);
    results
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
#[path = "tests/search_tests.rs"]
mod tests;

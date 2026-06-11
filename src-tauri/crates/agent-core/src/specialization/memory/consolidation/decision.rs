//! mem0 decision schema, prompt construction, and response parsing.
//!
//! The LLM returns a single JSON object describing what to do with a
//! pending learning row: ADD a new active row, UPDATE an existing one,
//! DELETE a stale one, or do NOTHING. This module owns the prompt format,
//! the JSON schema, fuzzy ID correction (so a typo'd id from the LLM
//! still resolves), and downgrade-to-ADD safety nets when the LLM
//! references unknown ids.

use serde::Deserialize;
use tracing::warn;

use crate::specialization::memory::learnings::Learning;

/// Maximum Levenshtein distance for the fuzzy-ID correction step. If the
/// LLM hallucinates an ID that's more than this many edits from any
/// candidate ID, fall back to `ADD`.
const FUZZY_ID_MAX_DISTANCE: usize = 3;

/// mem0-compatible memory decision. Serialized verbatim into the LLM JSON
/// response; `"event"` is matched case-insensitively on parse.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub enum DecisionEvent {
    #[serde(alias = "add", alias = "ADD")]
    Add,
    #[serde(alias = "update", alias = "UPDATE")]
    Update,
    #[serde(alias = "delete", alias = "DELETE")]
    Delete,
    #[serde(alias = "none", alias = "NONE")]
    None,
}

/// One decision returned by the mem0 prompt.
#[derive(Debug, Clone, Deserialize)]
pub struct RawDecision {
    #[serde(default)]
    pub id: Option<String>,
    pub event: DecisionEvent,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub takeaway: Option<String>,
}

/// Decision after fuzzy-ID correction against the candidate set.
#[derive(Debug, Clone)]
pub struct ResolvedDecision {
    /// Resolved candidate id if the event references an existing row, or
    /// `None` for ADD.
    pub target_id: Option<String>,
    pub event: DecisionEvent,
    pub text: String,
    pub takeaway: Option<String>,
}

/// Build the mem0-style memory decision prompt. Emits JSON so the LLM
/// response is trivially parseable, with conservative rules ("prefer NONE
/// over false UPDATEs"). See plan §3.5.
pub(super) fn build_decision_prompt(new_fact: &Learning, candidates: &[Learning]) -> String {
    let mut buf = String::new();
    buf.push_str(
        "You are a memory manager. A NEW_FACT has been extracted from a coding session. \
You see up to five EXISTING_MEMORIES with IDs.\n\n\
Decide exactly one of:\n\
- ADD: genuinely new, no overlap. id=null, text=full context (rewrite NEW_FACT if useful), \
  takeaway=one-line actionable rule.\n\
- UPDATE: NEW_FACT refines or adds nuance to an existing memory. id=<existing id>, \
  text=merged version, takeaway=updated rule.\n\
- DELETE: NEW_FACT directly contradicts an existing memory. id=<existing id>, \
  text=new fact replacing it, takeaway=updated rule.\n\
- NONE: semantic duplicate of an existing memory. id=<existing id>, text=\"\", takeaway=\"\".\n\n\
Rules:\n\
- Be conservative. Prefer NONE over false UPDATEs. Prefer ADD over forced UPDATEs.\n\
- Only produce UPDATE or DELETE if the overlap is unambiguous.\n\
- The `id` for UPDATE/DELETE/NONE MUST exactly match one of the shown IDs.\n\
- Output a single JSON object, no markdown, no commentary.\n\n",
    );

    buf.push_str("NEW_FACT:\n");
    buf.push_str(&format!(
        "- category: {}\n- content: {}\n",
        new_fact.category.as_str(),
        new_fact.content
    ));
    if let Some(tk) = new_fact.takeaway.as_deref() {
        buf.push_str(&format!("- takeaway: {}\n", tk));
    }
    buf.push('\n');

    if candidates.is_empty() {
        buf.push_str("EXISTING_MEMORIES: (none)\n\n");
    } else {
        buf.push_str("EXISTING_MEMORIES:\n");
        for c in candidates {
            buf.push_str(&format!(
                "- id: {}\n  category: {}\n  content: {}\n",
                c.id,
                c.category.as_str(),
                c.content
            ));
            if let Some(tk) = c.takeaway.as_deref() {
                buf.push_str(&format!("  takeaway: {}\n", tk));
            }
        }
        buf.push('\n');
    }

    buf.push_str(
        "Respond with a single JSON object like:\n\
{\n  \"id\": null | \"<existing id>\",\n  \"event\": \"ADD\" | \"UPDATE\" | \"DELETE\" | \"NONE\",\n\
  \"text\": \"...\",\n  \"takeaway\": \"...\"\n}\n",
    );
    buf
}

/// Extract the first JSON object from an LLM response that may contain
/// markdown fences or prose. Tolerant on input, strict on output.
fn extract_json_object(text: &str) -> Option<&str> {
    let trimmed = text.trim();
    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(&trimmed[start..=end])
}

/// Levenshtein distance, capped at `max + 1` for cheap exits. Returns
/// `max + 1` if the true distance exceeds `max`.
fn levenshtein_capped(a: &str, b: &str, max: usize) -> usize {
    let (a_chars, b_chars): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    let (n, m) = (a_chars.len(), b_chars.len());
    if n.abs_diff(m) > max {
        return max + 1;
    }
    let mut prev: Vec<usize> = (0..=m).collect();
    let mut curr = vec![0usize; m + 1];
    for i in 1..=n {
        curr[0] = i;
        let mut row_min = curr[0];
        for j in 1..=m {
            let cost = if a_chars[i - 1] == b_chars[j - 1] {
                0
            } else {
                1
            };
            curr[j] = (prev[j] + 1).min(curr[j - 1] + 1).min(prev[j - 1] + cost);
            if curr[j] < row_min {
                row_min = curr[j];
            }
        }
        if row_min > max {
            return max + 1;
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    prev[m]
}

/// If the LLM references an ID that isn't in the candidate pool, try to
/// map it to the closest candidate within `FUZZY_ID_MAX_DISTANCE`. Returns
/// `Some(canonical_id)` on a successful correction, `None` if it's a
/// genuine hallucination (caller downgrades to `ADD`).
///
/// Ref: OpenSpace `_correct_skill_ids` pattern — plan §3.4.
fn fuzzy_correct_id(raw: &str, candidate_ids: &[&str]) -> Option<String> {
    if candidate_ids.contains(&raw) {
        return Some(raw.to_string());
    }
    let mut best: Option<(usize, &str)> = None;
    for &cid in candidate_ids {
        let d = levenshtein_capped(raw, cid, FUZZY_ID_MAX_DISTANCE);
        if d <= FUZZY_ID_MAX_DISTANCE && best.map(|(bd, _)| d < bd).unwrap_or(true) {
            best = Some((d, cid));
        }
    }
    best.map(|(_, cid)| cid.to_string())
}

/// Parse a raw LLM response and resolve IDs against the candidate set.
/// Downgrades hallucinated IDs (and UPDATE/DELETE/NONE events without any
/// id) to `ADD` so the fact is never silently lost.
pub(super) fn parse_decision(
    response: &str,
    candidates: &[Learning],
) -> Result<ResolvedDecision, String> {
    let payload = extract_json_object(response)
        .ok_or_else(|| format!("no JSON object in response: {}", response))?;
    let raw: RawDecision = serde_json::from_str(payload)
        .map_err(|e| format!("decision JSON parse failed: {}: {}", e, payload))?;

    let candidate_ids: Vec<&str> = candidates.iter().map(|c| c.id.as_str()).collect();
    let target_id = match raw.event {
        DecisionEvent::Add => None,
        DecisionEvent::Update | DecisionEvent::Delete | DecisionEvent::None => {
            let Some(raw_id) = raw.id.as_deref() else {
                warn!(
                    "[consolidation] {:?} event with no id — downgrading to ADD",
                    raw.event
                );
                return Ok(ResolvedDecision {
                    target_id: None,
                    event: DecisionEvent::Add,
                    text: raw.text,
                    takeaway: raw.takeaway,
                });
            };
            match fuzzy_correct_id(raw_id, &candidate_ids) {
                Some(fixed) => Some(fixed),
                None => {
                    warn!(
                        "[consolidation] {:?} event referenced unknown id='{}' — downgrading to ADD",
                        raw.event, raw_id
                    );
                    return Ok(ResolvedDecision {
                        target_id: None,
                        event: DecisionEvent::Add,
                        text: raw.text,
                        takeaway: raw.takeaway,
                    });
                }
            }
        }
    };

    Ok(ResolvedDecision {
        target_id,
        event: raw.event,
        text: raw.text,
        takeaway: raw.takeaway,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::specialization::memory::consolidation::tests_support::pending;

    #[test]
    fn fuzzy_correct_id_exact_hit() {
        let id = "aaa-bbb-ccc".to_string();
        assert_eq!(
            fuzzy_correct_id(&id, &["aaa-bbb-ccc", "xxx"]),
            Some(id.clone())
        );
    }

    #[test]
    fn fuzzy_correct_id_within_threshold() {
        let good = "abcd-efgh-ijkl";
        let typo = "abcd-efgh-ijkx"; // one edit
        assert_eq!(fuzzy_correct_id(typo, &[good]), Some(good.to_string()));
    }

    #[test]
    fn fuzzy_correct_id_too_far() {
        let good = "abcd-efgh-ijkl";
        // Five edits — well beyond the threshold of 3.
        let bad = "zzzzzzzzzz";
        assert_eq!(fuzzy_correct_id(bad, &[good]), None);
    }

    #[test]
    fn levenshtein_cap_exits_early() {
        // Triggers the `n.abs_diff(m) > max` early exit without any work.
        assert_eq!(levenshtein_capped("abc", "abcdefgh", 2), 3);
    }

    #[test]
    fn extract_json_object_strips_markdown_fence() {
        let raw = "```json\n{\"event\":\"ADD\",\"id\":null,\"text\":\"x\",\"takeaway\":\"y\"}\n```";
        let payload = extract_json_object(raw).unwrap();
        assert!(payload.starts_with('{'));
        assert!(payload.ends_with('}'));
    }

    #[test]
    fn parse_decision_add_with_null_id() {
        let response = "{\"event\":\"ADD\",\"id\":null,\"text\":\"new\",\"takeaway\":\"do x\"}";
        let candidates: Vec<Learning> = Vec::new();
        let d = parse_decision(response, &candidates).unwrap();
        assert!(matches!(d.event, DecisionEvent::Add));
        assert!(d.target_id.is_none());
    }

    #[test]
    fn parse_decision_update_downgrades_on_unknown_id() {
        let response =
            "{\"event\":\"UPDATE\",\"id\":\"no-such-id-qqqqq\",\"text\":\"t\",\"takeaway\":\"k\"}";
        let existing = pending("agent:t", "hello");
        let candidates = vec![Learning {
            id: "real-id-12345".into(),
            ..existing
        }];
        let d = parse_decision(response, &candidates).unwrap();
        assert!(matches!(d.event, DecisionEvent::Add));
        assert!(d.target_id.is_none());
    }

    #[test]
    fn parse_decision_fuzzy_corrects_near_miss() {
        let response =
            "{\"event\":\"NONE\",\"id\":\"abcd-efgh-ijkX\",\"text\":\"\",\"takeaway\":\"\"}";
        let candidates = vec![Learning {
            id: "abcd-efgh-ijkl".into(),
            ..pending("agent:t", "x")
        }];
        let d = parse_decision(response, &candidates).unwrap();
        assert!(matches!(d.event, DecisionEvent::None));
        assert_eq!(d.target_id.as_deref(), Some("abcd-efgh-ijkl"));
    }
}

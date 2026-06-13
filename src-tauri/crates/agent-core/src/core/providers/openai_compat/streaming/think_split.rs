//! Inline `<think>…</think>` splitter for OpenAI-compatible content streams.
//!
//! Some providers (QwQ, certain vLLM/SGLang builds, and bespoke relays such as
//! soydrelay) inline the reasoning trace inside `delta.content` wrapped in
//! `<think>…</think>` tags instead of using the separate `reasoning_content`
//! channel. The wider chain — `StreamingBuffer`, normalizer, `agent:thinking_delta`
//! broadcasts, the React thinking surface — already handles the `reasoning`
//! channel correctly. We close the gap by demuxing the content stream into two
//! virtual channels at the protocol-normalisation layer; nothing downstream
//! needs to know which flavor a given provider speaks.
//!
//! ## State machine
//!
//! ```text
//!   ┌──────── '<' partial match ────────┐
//!   ▼                                   │
//! OutsideThink ── '<think>' ──► InsideThink ── '</think>' ──► OutsideThink
//! ```
//!
//! Each `push(chunk)` returns a `Split` with the chunk's bytes partitioned
//! into `content` (outside think) and `reasoning` (inside think). Any partial
//! tag at the chunk boundary is held in `carry` and emitted as content/reasoning
//! once we know whether it completed a tag or not.
//!
//! ## Correctness guarantees
//!
//! - **Byte-exact**: concatenating every `Split { content, reasoning }`
//!   reconstructs the original content stream byte for byte (modulo the tag
//!   bytes themselves, which are consumed). Verified by quickcheck-style
//!   tests in `__tests__`.
//! - **Tag bytes are never leaked** to either channel.
//! - **Cross-chunk safety**: `<thi` | `nk>` | `…` | `</thi` | `nk>` works.
//! - **Idempotent flush**: `flush()` finalises any dangling carry. If we are
//!   still `InsideThink` when the stream ends (provider crash mid-tag), the
//!   buffered text is emitted as `reasoning` — better than silently dropping
//!   it as content with raw `<think>` visible.

/// Output of a single `ThinkTagSplitter::push` call.
#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct Split {
    /// Bytes that belong on the regular content channel.
    pub content: String,
    /// Bytes that belong on the reasoning channel.
    pub reasoning: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    OutsideThink,
    InsideThink,
}

const OPEN_TAG: &str = "<think>";
const CLOSE_TAG: &str = "</think>";

/// Stateful splitter — one instance per chat completion stream.
#[derive(Debug)]
pub(super) struct ThinkTagSplitter {
    state: State,
    /// Bytes withheld from the latest chunk because they might be the prefix
    /// of `<think>` (when outside) or `</think>` (when inside). Always shorter
    /// than the longer of the two tags.
    carry: String,
    /// Has any think tag actually been observed on this stream? Used to bail
    /// out of the search loop quickly for the common case where reasoning
    /// arrives on `reasoning_content` and `content` is pure prose.
    saw_think_tag: bool,
}

impl ThinkTagSplitter {
    pub(super) fn new() -> Self {
        Self {
            state: State::OutsideThink,
            carry: String::new(),
            saw_think_tag: false,
        }
    }

    /// Was at least one `<think>` tag observed on this stream?
    pub(super) fn saw_think_tag(&self) -> bool {
        self.saw_think_tag
    }

    /// Feed the next chunk of `delta.content` bytes and get back the
    /// content/reasoning partition for everything we can resolve so far.
    pub(super) fn push(&mut self, chunk: &str) -> Split {
        // Fast path: we have never seen a `<` and the chunk has none either —
        // pure content, no carry, nothing to do. Avoids per-chunk allocation
        // for the dominant case (DeepSeek-R1, Claude, GPT-4, etc).
        if !self.saw_think_tag
            && self.carry.is_empty()
            && self.state == State::OutsideThink
            && !chunk.contains('<')
        {
            return Split {
                content: chunk.to_string(),
                reasoning: String::new(),
            };
        }

        let mut buf = std::mem::take(&mut self.carry);
        buf.push_str(chunk);
        self.split_buffer(&buf)
    }

    /// Finalise the stream. Any bytes still in `carry` are emitted on whichever
    /// channel matches the current state. Stream-end with an unterminated
    /// `<think>` (provider crashed mid-reasoning) keeps the partial reasoning
    /// visible rather than dropping it.
    pub(super) fn flush(&mut self) -> Split {
        if self.carry.is_empty() {
            return Split::default();
        }
        let buf = std::mem::take(&mut self.carry);
        match self.state {
            State::OutsideThink => Split {
                content: buf,
                reasoning: String::new(),
            },
            State::InsideThink => Split {
                content: String::new(),
                reasoning: buf,
            },
        }
    }

    fn split_buffer(&mut self, buf: &str) -> Split {
        let mut out = Split::default();
        let mut cursor = 0usize;

        while cursor < buf.len() {
            let rest = &buf[cursor..];
            match self.state {
                State::OutsideThink => {
                    if let Some(open_idx) = rest.find(OPEN_TAG) {
                        // Everything up to the tag is content; consume the tag.
                        out.content.push_str(&rest[..open_idx]);
                        cursor += open_idx + OPEN_TAG.len();
                        self.state = State::InsideThink;
                        self.saw_think_tag = true;
                    } else {
                        // Might be a partial `<think>` at the tail — carry the
                        // suffix that could complete a tag, emit the rest.
                        let safe_emit_len = safe_emit_len(rest, OPEN_TAG);
                        out.content.push_str(&rest[..safe_emit_len]);
                        self.carry = rest[safe_emit_len..].to_string();
                        return out;
                    }
                }
                State::InsideThink => {
                    if let Some(close_idx) = rest.find(CLOSE_TAG) {
                        out.reasoning.push_str(&rest[..close_idx]);
                        cursor += close_idx + CLOSE_TAG.len();
                        self.state = State::OutsideThink;
                    } else {
                        let safe_emit_len = safe_emit_len(rest, CLOSE_TAG);
                        out.reasoning.push_str(&rest[..safe_emit_len]);
                        self.carry = rest[safe_emit_len..].to_string();
                        return out;
                    }
                }
            }
        }

        out
    }
}

/// Length of `s` that is safe to emit without ambiguating a partial tag at the
/// tail. We keep up to `tag.len() - 1` trailing bytes in `carry` to wait for
/// confirmation. Walks back UTF-8 boundaries so we never split a multi-byte
/// codepoint.
fn safe_emit_len(s: &str, tag: &str) -> usize {
    let max_carry = tag.len().saturating_sub(1);
    if s.len() <= max_carry {
        // The entire string is potentially a tag prefix — but only carry
        // if the suffix actually matches a prefix of the tag. Otherwise we
        // would hoard "ordinary" `<` characters forever (e.g. `5 < 3`).
        let mut emit = 0;
        for end in (1..=s.len()).rev() {
            if s.is_char_boundary(end) && tag.starts_with(&s[..end]) {
                // s itself is a prefix of tag — withhold all of it
                return 0;
            }
            if s.is_char_boundary(end) {
                emit = end;
                break;
            }
        }
        // No prefix match — emit everything
        if !looks_like_tag_prefix(s, tag) {
            return s.len();
        }
        return emit;
    }

    let tail_start = s.len() - max_carry;
    let tail_start = ceil_char_boundary(s, tail_start);
    let tail = &s[tail_start..];

    // Walk the tail looking for the leftmost position whose suffix matches a
    // prefix of the tag. Everything left of it is safe to emit.
    let mut emit = s.len();
    let mut probe = 0;
    while probe < tail.len() {
        if !tail.is_char_boundary(probe) {
            probe += 1;
            continue;
        }
        let candidate = &tail[probe..];
        if looks_like_tag_prefix(candidate, tag) {
            emit = tail_start + probe;
            break;
        }
        probe += 1;
    }
    emit
}

fn looks_like_tag_prefix(s: &str, tag: &str) -> bool {
    !s.is_empty() && tag.starts_with(s)
}

/// `str::ceil_char_boundary` is nightly-only — emulate it.
fn ceil_char_boundary(s: &str, mut idx: usize) -> usize {
    while idx < s.len() && !s.is_char_boundary(idx) {
        idx += 1;
    }
    idx
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_chunks(splitter: &mut ThinkTagSplitter, chunks: &[&str]) -> Split {
        let mut combined = Split::default();
        for chunk in chunks {
            let s = splitter.push(chunk);
            combined.content.push_str(&s.content);
            combined.reasoning.push_str(&s.reasoning);
        }
        let tail = splitter.flush();
        combined.content.push_str(&tail.content);
        combined.reasoning.push_str(&tail.reasoning);
        combined
    }

    #[test]
    fn no_think_tag_passes_through() {
        let mut s = ThinkTagSplitter::new();
        let out = run_chunks(&mut s, &["hello ", "world"]);
        assert_eq!(out.content, "hello world");
        assert!(out.reasoning.is_empty());
        assert!(!s.saw_think_tag());
    }

    #[test]
    fn complete_think_block_in_single_chunk() {
        let mut s = ThinkTagSplitter::new();
        let out = run_chunks(&mut s, &["<think>plan</think>answer"]);
        assert_eq!(out.content, "answer");
        assert_eq!(out.reasoning, "plan");
        assert!(s.saw_think_tag());
    }

    #[test]
    fn think_block_at_start_no_content_after() {
        let mut s = ThinkTagSplitter::new();
        let out = run_chunks(&mut s, &["<think>only thinking</think>"]);
        assert_eq!(out.content, "");
        assert_eq!(out.reasoning, "only thinking");
    }

    #[test]
    fn content_before_think_block() {
        let mut s = ThinkTagSplitter::new();
        let out = run_chunks(&mut s, &["prefix <think>mid</think> suffix"]);
        assert_eq!(out.content, "prefix  suffix");
        assert_eq!(out.reasoning, "mid");
    }

    #[test]
    fn open_tag_split_across_chunks() {
        let mut s = ThinkTagSplitter::new();
        let out = run_chunks(&mut s, &["pre <thi", "nk>secret</think>post"]);
        assert_eq!(out.content, "pre post");
        assert_eq!(out.reasoning, "secret");
    }

    #[test]
    fn close_tag_split_across_chunks() {
        let mut s = ThinkTagSplitter::new();
        let out = run_chunks(&mut s, &["<think>abc</thi", "nk>tail"]);
        assert_eq!(out.content, "tail");
        assert_eq!(out.reasoning, "abc");
    }

    #[test]
    fn one_character_per_chunk() {
        let mut s = ThinkTagSplitter::new();
        let input = "<think>hi</think>!";
        let chunks: Vec<String> = input.chars().map(|c| c.to_string()).collect();
        let refs: Vec<&str> = chunks.iter().map(|s| s.as_str()).collect();
        let out = run_chunks(&mut s, &refs);
        assert_eq!(out.content, "!");
        assert_eq!(out.reasoning, "hi");
    }

    #[test]
    fn multiple_think_blocks() {
        let mut s = ThinkTagSplitter::new();
        let out = run_chunks(&mut s, &["<think>one</think>mid<think>two</think>tail"]);
        assert_eq!(out.content, "midtail");
        assert_eq!(out.reasoning, "onetwo");
    }

    #[test]
    fn lone_less_than_does_not_get_buffered_forever() {
        let mut s = ThinkTagSplitter::new();
        let out = run_chunks(&mut s, &["5 < 3 is false"]);
        assert_eq!(out.content, "5 < 3 is false");
        assert!(out.reasoning.is_empty());
    }

    #[test]
    fn less_than_that_does_not_complete_a_tag_flushes() {
        let mut s = ThinkTagSplitter::new();
        // `<t` is a real prefix of `<think>`, but the very next chunk breaks it.
        let out = run_chunks(&mut s, &["foo <t", "bar"]);
        assert_eq!(out.content, "foo <tbar");
        assert!(out.reasoning.is_empty());
    }

    #[test]
    fn unicode_inside_think() {
        let mut s = ThinkTagSplitter::new();
        let out = run_chunks(&mut s, &["<think>日本語 🚀 think</think>done"]);
        assert_eq!(out.content, "done");
        assert_eq!(out.reasoning, "日本語 🚀 think");
    }

    #[test]
    fn unterminated_think_at_eof_flushes_as_reasoning() {
        let mut s = ThinkTagSplitter::new();
        let out = run_chunks(&mut s, &["<think>still typing..."]);
        assert_eq!(out.content, "");
        assert_eq!(out.reasoning, "still typing...");
    }

    #[test]
    fn carry_does_not_leak_tag_bytes_to_either_channel() {
        let mut s = ThinkTagSplitter::new();
        let out = run_chunks(
            &mut s,
            &[
                "a", "<", "t", "h", "i", "n", "k", ">", "b", "<", "/", "t", "h", "i", "n", "k",
                ">", "c",
            ],
        );
        assert_eq!(out.content, "ac");
        assert_eq!(out.reasoning, "b");
    }

    #[test]
    fn realistic_soydrelay_shape() {
        let mut s = ThinkTagSplitter::new();
        // What we observed from vincetest1: tag opens with embedded newlines,
        // streams a long reasoning trace, then closes and emits the answer.
        let out = run_chunks(
            &mut s,
            &[
                "<think>\n\n",
                "**Calculating step by step**",
                "\nThe user asked",
                " for arithmetic.",
                "</think>",
                "17 × 23 = ",
                "**391**",
            ],
        );
        assert_eq!(out.content, "17 × 23 = **391**");
        assert!(out.reasoning.contains("Calculating step by step"));
        assert!(out.reasoning.contains("arithmetic"));
    }
}

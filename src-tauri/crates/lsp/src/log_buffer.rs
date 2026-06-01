//! Per-`LspServer` ring buffer of recent stdio activity.
//!
//! When a language server fails (rust-analyzer OOM, pyright panic, gopls
//! permission error) the user previously only saw the static
//! `install_hint` string. The server's stderr was dumped into the host
//! log via `log::warn!` — useful for the developer running `RUST_LOG`,
//! invisible to the end user.
//!
//! `LogBuffer` keeps the last N lines of inbound / outbound / stderr
//! traffic in memory so the frontend can render them in the
//! `LanguageServersPage` preview drawer. We intentionally keep the
//! buffer small (`MAX_LOG_LINES = 500`) and lock-free on the read side
//! via a snapshot clone — the goal is "what did this server say in the
//! last few minutes?", not durable logging.

use std::collections::VecDeque;
use std::sync::Arc;

use parking_lot::Mutex;
use serde::Serialize;

/// Maximum number of lines retained per server. When the buffer is full
/// the oldest line is dropped on every push. 500 lines × ~200 bytes per
/// line ≈ 100 KiB worst case per server, which is acceptable for the
/// "last activity" use case.
pub const MAX_LOG_LINES: usize = 500;

/// Maximum bytes per line stored verbatim. Long JSON-RPC bodies (full
/// document texts on `didChange`, large `publishDiagnostics`) are
/// truncated with a `…(truncated, +Nb)` suffix so a single chatty line
/// can't blow the buffer's effective capacity.
pub const MAX_LINE_BYTES: usize = 2 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IoKind {
    /// Outbound write to the server's stdin (request, notification,
    /// `$/cancelRequest`).
    StdIn,
    /// Inbound JSON-RPC body received on the server's stdout.
    StdOut,
    /// Anything the server printed to stderr (install warnings, panics,
    /// debug prints).
    StdErr,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    /// Milliseconds since UNIX epoch. Frontend formats relative to
    /// `Date.now()` so wall-clock skew between Rust and the renderer
    /// doesn't matter.
    pub ts_ms: u64,
    pub kind: IoKind,
    pub line: String,
}

#[derive(Debug, Clone, Default)]
pub struct LogBuffer {
    inner: Arc<Mutex<VecDeque<LogLine>>>,
}

impl LogBuffer {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(VecDeque::with_capacity(MAX_LOG_LINES))),
        }
    }

    /// Push a single line. Oversized lines are truncated in place; the
    /// VecDeque is bounded to `MAX_LOG_LINES` by dropping the oldest
    /// entry once full.
    pub fn push(&self, kind: IoKind, line: impl Into<String>) {
        let mut text = line.into();
        let original_len = text.len();
        if original_len > MAX_LINE_BYTES {
            // `truncate` panics on a non-char-boundary index, which is
            // possible when we're handed JSON bodies containing
            // multi-byte UTF-8. Walk back to the previous boundary.
            let mut cut = MAX_LINE_BYTES;
            while cut > 0 && !text.is_char_boundary(cut) {
                cut -= 1;
            }
            text.truncate(cut);
            text.push_str(&format!("…(truncated, +{} bytes)", original_len - cut));
        }

        let entry = LogLine {
            ts_ms: now_ms(),
            kind,
            line: text,
        };

        let mut guard = self.inner.lock();
        if guard.len() >= MAX_LOG_LINES {
            guard.pop_front();
        }
        guard.push_back(entry);
    }

    /// Return a snapshot copy of the buffer. Used by
    /// `lsp_get_server_log` to hand a `Vec<LogLine>` to Tauri serde.
    pub fn snapshot(&self) -> Vec<LogLine> {
        let guard = self.inner.lock();
        guard.iter().cloned().collect()
    }
}

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buffer_caps_at_max_lines() {
        let buf = LogBuffer::new();
        for index in 0..(MAX_LOG_LINES + 50) {
            buf.push(IoKind::StdOut, format!("line {}", index));
        }
        let snap = buf.snapshot();
        assert_eq!(snap.len(), MAX_LOG_LINES);
        // Oldest entries dropped: the first remaining line should be
        // index 50 (we pushed 0..MAX+50).
        assert_eq!(snap[0].line, "line 50");
        assert_eq!(
            snap[snap.len() - 1].line,
            format!("line {}", MAX_LOG_LINES + 49)
        );
    }

    #[test]
    fn long_line_truncated_with_suffix() {
        let buf = LogBuffer::new();
        let big = "a".repeat(MAX_LINE_BYTES + 100);
        buf.push(IoKind::StdIn, big);
        let snap = buf.snapshot();
        assert_eq!(snap.len(), 1);
        assert!(snap[0].line.starts_with(&"a".repeat(MAX_LINE_BYTES)));
        assert!(snap[0].line.ends_with("bytes)"));
        assert!(snap[0].line.contains("(truncated, +100 bytes)"));
    }

    #[test]
    fn truncation_respects_utf8_boundaries() {
        // Build a string whose byte index `MAX_LINE_BYTES` lands in the
        // middle of a 3-byte UTF-8 char. Without the boundary walk
        // `String::truncate` would panic.
        let mut input = "a".repeat(MAX_LINE_BYTES - 1);
        input.push('é'); // 2 bytes, straddles the cap
        input.push_str("padding");
        let buf = LogBuffer::new();
        buf.push(IoKind::StdErr, input);
        let snap = buf.snapshot();
        assert_eq!(snap.len(), 1);
        assert!(snap[0].line.ends_with("bytes)"));
    }

    #[test]
    fn kind_serialize_snake_case() {
        let entry = LogLine {
            ts_ms: 0,
            kind: IoKind::StdErr,
            line: "boom".to_string(),
        };
        let json = serde_json::to_string(&entry).unwrap();
        // `IoKind::StdErr` should serialize as "std_err" so the
        // frontend filter logic uses lowercase tags.
        assert!(json.contains("\"std_err\""), "got: {}", json);
    }

    #[test]
    fn log_line_wire_shape_is_camel_case() {
        // Lock the wire shape that the frontend `LspLogLine`
        // TypeScript interface depends on. Field names must be
        // `tsMs`, `kind`, `line` — and `kind` must be snake_case
        // (`std_in` / `std_out` / `std_err`). Any change to either
        // of those breaks the LanguageServersPage log drawer.
        let entry = LogLine {
            ts_ms: 1_700_000_000_000,
            kind: IoKind::StdIn,
            line: "{\"jsonrpc\":\"2.0\"}".to_string(),
        };
        let value: serde_json::Value = serde_json::to_value(&entry).expect("serialize");
        assert_eq!(value["tsMs"], 1_700_000_000_000_i64);
        assert_eq!(value["kind"], "std_in");
        assert_eq!(value["line"], "{\"jsonrpc\":\"2.0\"}");
        // No stray fields — the frontend type is closed.
        let object = value.as_object().expect("object");
        assert_eq!(object.len(), 3, "unexpected fields: {:?}", object.keys());
    }
}

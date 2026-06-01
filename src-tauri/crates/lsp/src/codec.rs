//! Tokio codec for the LSP `Content-Length: N\r\n\r\n<body>` framing.
//!
//! Replaces the hand-rolled `read + extend + read_lsp_message_from_buffer`
//! loop in `server.rs`. Two reasons that loop was wrong enough to be
//! worth replacing wholesale (Phase 10 of the LSP plan):
//!
//! 1. **UTF-8 boundary bug.** The old reader called
//!    `std::str::from_utf8(buffer).ok()?` on every poll. If the OS
//!    returned a chunk that split a multi-byte character (very common
//!    for non-ASCII Hover docstrings, Go vet messages, jdt.ls error
//!    blobs, …) the entire scan returned `None` and we waited for
//!    more bytes, even though the *header* was complete and parseable
//!    in pure ASCII. Worst case: a bad alignment held a response
//!    until the *next* read happened to flush a clean boundary.
//! 2. **O(n) per byte.** `from_utf8` revalidates the whole buffer on
//!    every poll, then `find("\r\n\r\n")` scans it again, then
//!    `buffer.drain(..consumed)` shifts every remaining byte down.
//!    For chatty servers (rust-analyzer's progress stream, gopls's
//!    semantic-tokens flush) this dominates the listener task's CPU.
//!
//! The codec works on raw `&[u8]` for header detection and uses
//! `BytesMut::split_to` for body extraction, so neither problem
//! occurs. JSON decoding still happens outside the codec, in the
//! listener — the codec's responsibility ends at "give me a complete
//! body's worth of bytes."

use bytes::{Bytes, BytesMut};
use tokio_util::codec::Decoder;

/// Header separator that ends the LSP message header section.
const HEADER_SEP: &[u8] = b"\r\n\r\n";
/// Header field that gives the body length in bytes.
const CONTENT_LENGTH: &[u8] = b"Content-Length:";

/// Cap on a single LSP message size. The spec doesn't define one,
/// but a runaway `Content-Length: 1099511627776\r\n\r\n` would have
/// us pre-allocate a TB of `BytesMut`. 32 MiB is comfortably above
/// realistic payloads (huge `workspace/configuration` snapshots,
/// jdt.ls semantic-tokens responses) and bounds memory under attack.
const MAX_MESSAGE_BYTES: usize = 32 * 1024 * 1024;

/// Parsed Content-Length: header with the byte offset of the body.
#[derive(Debug, Clone, Copy)]
struct Header {
    /// Byte length of the message body (the JSON-RPC envelope).
    body_len: usize,
    /// Total byte length of the header section, *including* the
    /// trailing `\r\n\r\n`. The body starts at this offset.
    header_total_len: usize,
}

/// Decoder errors. The listener treats every variant as
/// "log-and-disconnect" — we have no recovery project for a server
/// that's emitting garbage on stdout, and silently re-syncing would
/// mask real LSP bugs (rust-analyzer panics, jdt.ls JVM crashes).
#[derive(Debug, thiserror::Error)]
pub enum LspCodecError {
    #[error("Content-Length header missing or invalid")]
    InvalidHeader,
    #[error("Content-Length {0} exceeds the {1}-byte cap")]
    BodyTooLarge(usize, usize),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// Streaming decoder for LSP messages. Stateless across calls —
/// `tokio_util` owns the `BytesMut` buffer and feeds us slices.
#[derive(Default, Debug, Clone, Copy)]
pub struct LspCodec;

impl LspCodec {
    pub fn new() -> Self {
        Self
    }
}

impl Decoder for LspCodec {
    type Item = Bytes;
    type Error = LspCodecError;

    fn decode(&mut self, src: &mut BytesMut) -> Result<Option<Self::Item>, Self::Error> {
        // Phase 1: header. Look for `\r\n\r\n` in raw bytes — the
        // header is always 7-bit ASCII per the LSP spec, so we don't
        // need UTF-8 validation here.
        let Some(header) = parse_header(src)? else {
            return Ok(None);
        };

        if header.body_len > MAX_MESSAGE_BYTES {
            return Err(LspCodecError::BodyTooLarge(
                header.body_len,
                MAX_MESSAGE_BYTES,
            ));
        }

        // Phase 2: body. Reserve capacity so we don't realloc when
        // the next poll fills in the rest.
        let total_len = header.header_total_len + header.body_len;
        if src.len() < total_len {
            src.reserve(total_len - src.len());
            return Ok(None);
        }

        // Drop the header bytes, then split off exactly `body_len`
        // bytes for this message. Anything past `total_len` is left
        // in `src` for the next call.
        let _header_bytes = src.split_to(header.header_total_len);
        let body = src.split_to(header.body_len).freeze();
        Ok(Some(body))
    }
}

/// Scan `src` for the LSP header section. Returns:
/// - `Ok(None)` if the header isn't complete yet;
/// - `Ok(Some(header))` once `\r\n\r\n` has been found and the
///   `Content-Length` field parsed;
/// - `Err(InvalidHeader)` if the header section is complete but
///   contains no parseable `Content-Length`. We surface this
///   instead of silently re-syncing so server-side framing bugs
///   are loud.
fn parse_header(src: &[u8]) -> Result<Option<Header>, LspCodecError> {
    let Some(sep_off) = find_subslice(src, HEADER_SEP) else {
        return Ok(None);
    };
    let header_bytes = &src[..sep_off];
    let header_total_len = sep_off + HEADER_SEP.len();

    // Walk header lines. Lines are CRLF-terminated within
    // `header_bytes`; any leftover trailing bytes (no CRLF, no
    // separator) means we haven't parsed the line yet, but
    // `find_subslice` above guarantees we've seen `\r\n\r\n`, so
    // every line up to the separator is well-formed.
    for line in header_bytes.split(|&b| b == b'\n') {
        // Trim a trailing \r left by the split.
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        if let Some(rest) = line.strip_prefix(CONTENT_LENGTH) {
            // The spec says ASCII digits only; we tolerate
            // surrounding whitespace (some servers emit
            // `Content-Length:   123`).
            let trimmed = trim_ascii(rest);
            let s = std::str::from_utf8(trimmed).map_err(|_| LspCodecError::InvalidHeader)?;
            let body_len: usize = s.parse().map_err(|_| LspCodecError::InvalidHeader)?;
            return Ok(Some(Header {
                body_len,
                header_total_len,
            }));
        }
    }

    Err(LspCodecError::InvalidHeader)
}

/// `&[u8]::trim_ascii` is unstable on stable Rust; this is a tiny
/// in-house equivalent. Trims ASCII whitespace from both ends.
fn trim_ascii(input: &[u8]) -> &[u8] {
    let start = input
        .iter()
        .position(|b| !b.is_ascii_whitespace())
        .unwrap_or(input.len());
    let end = input
        .iter()
        .rposition(|b| !b.is_ascii_whitespace())
        .map(|i| i + 1)
        .unwrap_or(start);
    &input[start..end]
}

/// Naive subslice search. We don't pull in `memchr` for this — the
/// header is always small (≤ a few dozen bytes for `Content-Length`
/// plus optional `Content-Type`) and `\r\n\r\n` is searched once
/// per message.
fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::BytesMut;

    fn frame(body: &str) -> Vec<u8> {
        format!("Content-Length: {}\r\n\r\n{}", body.len(), body).into_bytes()
    }

    #[test]
    fn decodes_one_complete_message() {
        let mut codec = LspCodec::new();
        let body = r#"{"jsonrpc":"2.0","id":1,"result":null}"#;
        let mut buf = BytesMut::from(&frame(body)[..]);
        let out = codec.decode(&mut buf).unwrap().unwrap();
        assert_eq!(&out[..], body.as_bytes());
        assert!(
            buf.is_empty(),
            "fully-consumed frame leaves an empty buffer"
        );
    }

    #[test]
    fn returns_none_when_header_incomplete() {
        let mut codec = LspCodec::new();
        // No `\r\n\r\n` yet.
        let mut buf = BytesMut::from(&b"Content-Length: 10\r\n"[..]);
        assert!(codec.decode(&mut buf).unwrap().is_none());
        // Buffer is preserved so the next read can complete the header.
        assert_eq!(&buf[..], b"Content-Length: 10\r\n");
    }

    #[test]
    fn returns_none_when_body_incomplete() {
        let mut codec = LspCodec::new();
        // Header says 100 bytes, but we only have 5 of them.
        let mut buf = BytesMut::from(&b"Content-Length: 100\r\n\r\n{\"jso"[..]);
        assert!(codec.decode(&mut buf).unwrap().is_none());
        // Buffer is preserved across the partial-body call.
        assert_eq!(&buf[..], b"Content-Length: 100\r\n\r\n{\"jso");
    }

    #[test]
    fn decodes_two_messages_in_one_buffer() {
        let mut codec = LspCodec::new();
        let mut concat = Vec::new();
        concat.extend(frame(r#"{"a":1}"#));
        concat.extend(frame(r#"{"b":2}"#));
        let mut buf = BytesMut::from(&concat[..]);

        let m1 = codec.decode(&mut buf).unwrap().unwrap();
        assert_eq!(&m1[..], br#"{"a":1}"#);
        let m2 = codec.decode(&mut buf).unwrap().unwrap();
        assert_eq!(&m2[..], br#"{"b":2}"#);
        assert!(codec.decode(&mut buf).unwrap().is_none());
    }

    #[test]
    fn handles_split_across_polls() {
        // The OS gives us the message in two reads. The codec must
        // correctly accumulate without re-validating UTF-8 of the
        // body half (regression: the old impl returned `None` on a
        // multi-byte split).
        let mut codec = LspCodec::new();
        let body = "{\"msg\":\"héllo\"}"; // multi-byte UTF-8 in body
        let bytes = frame(body);
        let split_at = bytes.len() - 3; // mid-multibyte split
        let (first, second) = bytes.split_at(split_at);

        let mut buf = BytesMut::from(first);
        assert!(codec.decode(&mut buf).unwrap().is_none());

        buf.extend_from_slice(second);
        let out = codec.decode(&mut buf).unwrap().unwrap();
        assert_eq!(&out[..], body.as_bytes());
    }

    #[test]
    fn tolerates_extra_whitespace_around_length() {
        let mut codec = LspCodec::new();
        let body = "{}";
        let raw = format!("Content-Length:    {}\r\n\r\n{}", body.len(), body);
        let mut buf = BytesMut::from(raw.as_bytes());
        let out = codec.decode(&mut buf).unwrap().unwrap();
        assert_eq!(&out[..], body.as_bytes());
    }

    #[test]
    fn ignores_optional_content_type_header() {
        // The spec allows `Content-Type: application/vscode-jsonrpc;
        // charset=utf-8` between `Content-Length` and the body
        // separator. We must not get confused by it.
        let mut codec = LspCodec::new();
        let body = r#"{"id":1}"#;
        let raw = format!(
            "Content-Length: {}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n{}",
            body.len(),
            body
        );
        let mut buf = BytesMut::from(raw.as_bytes());
        let out = codec.decode(&mut buf).unwrap().unwrap();
        assert_eq!(&out[..], body.as_bytes());
    }

    #[test]
    fn rejects_oversized_message() {
        let mut codec = LspCodec::new();
        let too_big = MAX_MESSAGE_BYTES + 1;
        let raw = format!("Content-Length: {}\r\n\r\n", too_big);
        let mut buf = BytesMut::from(raw.as_bytes());
        let err = codec.decode(&mut buf).unwrap_err();
        assert!(
            matches!(err, LspCodecError::BodyTooLarge(n, cap) if n == too_big && cap == MAX_MESSAGE_BYTES)
        );
    }

    #[test]
    fn rejects_header_with_no_content_length() {
        let mut codec = LspCodec::new();
        let mut buf = BytesMut::from(&b"Content-Type: text/plain\r\n\r\n"[..]);
        let err = codec.decode(&mut buf).unwrap_err();
        assert!(matches!(err, LspCodecError::InvalidHeader));
    }

    #[test]
    fn rejects_non_numeric_content_length() {
        let mut codec = LspCodec::new();
        let mut buf = BytesMut::from(&b"Content-Length: abc\r\n\r\n"[..]);
        let err = codec.decode(&mut buf).unwrap_err();
        assert!(matches!(err, LspCodecError::InvalidHeader));
    }
}

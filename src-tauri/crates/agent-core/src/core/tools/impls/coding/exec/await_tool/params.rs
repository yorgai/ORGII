//! Param parsing + small lookup helpers shared by all subcommands.

use serde_json::Value;

use super::super::registry;
use crate::tools::traits::ToolError;

pub(super) const DEFAULT_BLOCK_MS: u64 = 30_000;
pub(super) const DEFAULT_TAIL_LINES: usize = 50;
pub(super) const POLL_INTERVAL_MS: u64 = 250;
/// Maximum number of handles accepted in a single `wait_for` / `monitor` call.
/// Guards against pathological batches saturating the poll loop.
pub(super) const MAX_HANDLES_PER_CALL: usize = 16;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum WaitMode {
    /// Return as soon as any handle terminates (or pattern matches, single-handle).
    Any,
    /// Return only when every handle has terminated.
    All,
}

/// Parse the `handles` parameter into a `Vec<String>`.
///
/// Canonical shape is `handles: string[]`. We also accept a bare `handles:
/// "xxx"` string (auto-wrapped to `["xxx"]`) because LLMs occasionally slip on
/// the array syntax — better to succeed than to fail with a schema-nit error.
/// Singular `handle: "xxx"` is rejected to keep one canonical name.
pub(super) fn parse_handles(params: &Value) -> Result<Vec<String>, ToolError> {
    if params.get("handle").is_some() {
        return Err(ToolError::InvalidParams(
            "Use `handles: [\"...\"]` (array). The legacy `handle` (singular) field is no longer accepted."
                .into(),
        ));
    }

    let raw = params
        .get("handles")
        .ok_or_else(|| ToolError::InvalidParams("`handles` array is required".into()))?;

    let parsed: Vec<String> = if let Some(arr) = raw.as_array() {
        arr.iter()
            .map(|v| {
                v.as_str()
                    .ok_or_else(|| {
                        ToolError::InvalidParams("`handles` entries must be strings".into())
                    })
                    .map(String::from)
            })
            .collect::<Result<_, _>>()?
    } else if let Some(s) = raw.as_str() {
        vec![s.to_string()]
    } else {
        return Err(ToolError::InvalidParams(
            "`handles` must be an array of strings".into(),
        ));
    };

    if parsed.is_empty() {
        return Err(ToolError::InvalidParams(
            "`handles` must contain at least one handle".into(),
        ));
    }
    if parsed.len() > MAX_HANDLES_PER_CALL {
        return Err(ToolError::InvalidParams(format!(
            "Too many handles ({}); max is {} per call",
            parsed.len(),
            MAX_HANDLES_PER_CALL
        )));
    }

    // De-duplicate while preserving the caller's order — makes the header /
    // meta output deterministic when an LLM accidentally passes the same
    // handle twice.
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(parsed.len());
    for h in parsed {
        if seen.insert(h.clone()) {
            out.push(h);
        }
    }
    Ok(out)
}

pub(super) fn parse_wait_mode(params: &Value) -> Result<WaitMode, ToolError> {
    match params.get("wait_mode").and_then(|v| v.as_str()) {
        None | Some("any") => Ok(WaitMode::Any),
        Some("all") => Ok(WaitMode::All),
        Some(other) => Err(ToolError::InvalidParams(format!(
            "Unknown wait_mode \"{}\". Valid values: any, all",
            other
        ))),
    }
}

pub(super) fn parse_tail_lines(params: &Value) -> usize {
    params
        .get("tail_lines")
        .and_then(|v| v.as_u64())
        .map(|v| v as usize)
        .unwrap_or(DEFAULT_TAIL_LINES)
}

pub(super) fn lookup_job(
    handle: &str,
) -> Result<(registry::JobStatus, registry::JobKind), ToolError> {
    registry::get_status(handle).ok_or_else(|| {
        ToolError::ExecutionFailed(format!(
            "No background job with handle \"{}\". It may have already completed and been cleaned up.",
            handle
        ))
    })
}

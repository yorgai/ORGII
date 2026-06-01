//! Node Hashing — structural hash for AST node ranges.
//!
//! Computes a SHA-256 hash over the whitespace-normalized source text of a line
//! range. Used as a secondary signal for provenance matching (primary matching
//! is range-based via git diff hunks).

use sha2::{Digest, Sha256};

/// Hash the source text in `[start_line, end_line]` (1-based, inclusive).
///
/// The content is normalized by collapsing runs of whitespace into a single
/// space and trimming each line, so that reformatting does not change the hash.
/// Returns a hex-encoded SHA-256 digest.
pub fn compute_node_hash(content: &str, start_line: u32, end_line: u32) -> String {
    let mut hasher = Sha256::new();
    for (idx, line) in content.lines().enumerate() {
        let line_num = (idx as u32) + 1;
        if line_num < start_line {
            continue;
        }
        if line_num > end_line {
            break;
        }
        let normalized: String = line.split_whitespace().collect::<Vec<_>>().join(" ");
        hasher.update(normalized.as_bytes());
        hasher.update(b"\n");
    }
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
#[path = "tests/hashing_tests.rs"]
mod tests;

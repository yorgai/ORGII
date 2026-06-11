//! Shared types referenced across consolidation submodules.

/// `consolidate()` trigger source, recorded on the run row for diagnostics.
#[derive(Debug, Clone, Copy)]
pub enum ConsolidationTrigger {
    Idle,
    Lazy,
    Forced,
    Manual,
}

impl ConsolidationTrigger {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Lazy => "lazy",
            Self::Forced => "forced",
            Self::Manual => "manual",
        }
    }
}

/// Candidate recall mode for a consolidation pass.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CandidateMode {
    /// Semantic recall via `search_similar` (cosine).
    Embedding,
    /// Salience-ranked manifest fallback (no embedding available).
    Manifest,
}

impl CandidateMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Embedding => "embedding",
            Self::Manifest => "manifest",
        }
    }
}

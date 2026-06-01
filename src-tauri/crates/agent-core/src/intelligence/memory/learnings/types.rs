//! Type definitions for the L3 learning store: `Learning` row and the four
//! string-backed enums (`LearningCategory`, `EvolutionType`, `LearningStatus`,
//! `LearningSource`). All enums use `serde(rename_all = "snake_case")` and
//! provide `as_str()` / `parse_str()` for SQLite TEXT round-trip.

use serde::{Deserialize, Serialize};

/// A single learning insight.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Learning {
    pub id: String,
    pub agent_scope: String,
    /// Full context — a paragraph describing the insight and its origin.
    pub content: String,
    /// Compressed one-line actionable rule (yoyo-evolve schema). `None` for
    /// legacy rows that never had a takeaway; consolidation may populate.
    pub takeaway: Option<String>,
    pub category: LearningCategory,
    pub importance: f64,
    pub confidence: f64,
    /// Embedding vector (serialized as little-endian f32 bytes in DB).
    #[serde(skip)]
    pub embedding: Vec<f32>,
    /// Embedding model identifier (e.g. "azure:text-embedding-3-large").
    /// Used to filter compatible embeddings during similarity search.
    pub embedding_model: Option<String>,

    // Lifecycle
    /// Write path appends `Pending`; consolidation promotes to `Active`,
    /// merges into `Merged` (soft tombstone), retires via `Deprecated`, or
    /// marks failed consolidation attempts as `Abandoned` so they never retry.
    pub status: LearningStatus,
    /// `sha256("{category}:{normalized_content}")[0..16]` — write-time exact
    /// dedup key (memU algorithm). `None` only for rows that failed backfill.
    pub content_hash: Option<String>,
    /// Times this exact content was re-encountered via hash hit. Starts at 1.
    pub reinforcement_count: u32,
    /// Which trigger created this learning.
    pub source: LearningSource,
    /// Originating session's billing account, used for per-account
    /// consolidation batches. `None` for bridged / system learnings.
    pub account_id: Option<String>,

    // Evolution DAG
    pub evolution_type: EvolutionType,
    pub parent_id: Option<String>,

    // Tracking
    pub last_recalled_at: Option<String>,

    // Metadata
    pub source_session_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum LearningCategory {
    /// "I should do X when Y" — behavioral pattern
    Pattern,
    /// "X didn't work because Y" — failure correction
    Correction,
    /// "User prefers X over Y" — preference insight
    Preference,
    /// "In context X, approach Y works best" — strategic insight
    Strategy,
}

impl LearningCategory {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Pattern => "pattern",
            Self::Correction => "correction",
            Self::Preference => "preference",
            Self::Strategy => "strategy",
        }
    }

    /// Parse a wire/DB string into a `LearningCategory`.
    ///
    /// Returns `None` on unknown values. Callers must decide between:
    /// - DB row reader: surface `FromSqlConversionFailure` so corrupt
    ///   rows do not silently misclassify as `Pattern`.
    /// - LLM-output parsers: fall back to `Pattern` with a `warn!` so
    ///   hallucinated category strings stay traceable.
    /// - Wire-input filters / commands: reject typo'd strings with
    ///   `Err` so the user gets feedback.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "pattern" => Some(Self::Pattern),
            "correction" => Some(Self::Correction),
            "preference" => Some(Self::Preference),
            "strategy" => Some(Self::Strategy),
            _ => None,
        }
    }
}

/// Simplified evolution type — only tracks Original vs Refined vs Deprecated.
/// `Reinforced` and `Merged` variants were removed: reinforcement is
/// now a `reinforcement_count` bump on the same row (no new version), and merge
/// semantics live in `LearningStatus::Merged`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvolutionType {
    /// Initial creation
    Original,
    /// Refined — content updated based on new evidence (parent_id set to prior version)
    Refined,
    /// No longer applicable (also reflected in `status = Deprecated`)
    Deprecated,
}

impl EvolutionType {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Original => "original",
            Self::Refined => "refined",
            Self::Deprecated => "deprecated",
        }
    }

    /// Parse a DB string into an `EvolutionType`.
    ///
    /// Returns `None` on unknown values; the row reader surfaces this
    /// as `FromSqlConversionFailure` so a corrupt row never silently
    /// downgrades a refined/deprecated learning back to "original".
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "original" => Some(Self::Original),
            "refined" => Some(Self::Refined),
            "deprecated" => Some(Self::Deprecated),
            _ => None,
        }
    }
}

/// Lifecycle state introduced with the lifecycle schema.
///
/// - `Pending`: raw insight from write path, awaiting consolidation
/// - `Active`: promoted by consolidation (or directly by ADD decision)
/// - `Merged`: archived by a consolidated version — soft tombstone, still
///   reachable via `parent_id` chain for audit
/// - `Deprecated`: contradicted / outdated — also soft tombstone
/// - `Abandoned`: consolidation attempted this pending row and failed; it is
///   retained for audit but permanently removed from future consolidation.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LearningStatus {
    Pending,
    Active,
    Merged,
    Deprecated,
    Abandoned,
}

impl LearningStatus {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Pending => "pending",
            Self::Active => "active",
            Self::Merged => "merged",
            Self::Deprecated => "deprecated",
            Self::Abandoned => "abandoned",
        }
    }

    /// Parse a wire/DB string into a `LearningStatus`.
    ///
    /// Returns `None` on unknown values. Critical: the prior catch-all
    /// silently downgraded a corrupt status row to `Pending`, which
    /// re-queued the row for consolidation on every tick (a hot loop
    /// that could drown the consolidation queue). Callers must now
    /// surface `FromSqlConversionFailure` on the read side and reject
    /// typo'd transitions on the write side.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(Self::Pending),
            "active" => Some(Self::Active),
            "merged" => Some(Self::Merged),
            "deprecated" => Some(Self::Deprecated),
            "abandoned" => Some(Self::Abandoned),
            _ => None,
        }
    }
}

/// Semantic category of the write trigger (not module path — renaming Rust
/// modules shouldn't break backfill). See §1.3 of the L3 rebuild plan.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LearningSource {
    /// `reflection.rs` post-session extractor (dominant write path)
    Reflection,
    /// Background pattern miners (SDE orchestrator bridge, future miners)
    PatternExtraction,
    /// Runtime observers (tool-failure watcher, etc.)
    ActiveObservation,
}

impl LearningSource {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Reflection => "reflection",
            Self::PatternExtraction => "pattern_extraction",
            Self::ActiveObservation => "active_observation",
        }
    }

    /// Parse a wire/DB string into a `LearningSource`.
    ///
    /// Returns `None` on unknown values. Callers either surface this
    /// as a `FromSqlConversionFailure` on DB rows (so corrupt rows do
    /// not silently mis-attribute the write trigger) or reject typo'd
    /// wire payloads with `Err`.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "reflection" => Some(Self::Reflection),
            "pattern_extraction" => Some(Self::PatternExtraction),
            "active_observation" => Some(Self::ActiveObservation),
            _ => None,
        }
    }
}

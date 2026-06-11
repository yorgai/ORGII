//! L3 learnings schema initialization and the write-time content-hash helper.
//!
//! Both live here because they are setup-time / pure-function concerns that
//! every other module in `learnings/` depends on (CRUD, lifecycle, query,
//! dedup) — keeping them together and dependency-free makes the write-path
//! contract easy to read.

use rusqlite::{Connection, Result as SqliteResult};

use super::types::LearningCategory;

/// Compute the write-time dedup key for a learning. memU algorithm:
///   1. Lowercase + collapse all whitespace to a single space
///   2. Prefix with `{category}:` so different categories don't collide
///   3. SHA-256, keep first 16 hex chars
///
/// Reference: memU `compute_content_hash()` —
/// memU/src/memu/database/models.py L15-32
pub fn compute_content_hash(content: &str, category: LearningCategory) -> String {
    use sha2::{Digest, Sha256};
    let normalized: String = content.split_whitespace().collect::<Vec<_>>().join(" ");
    let normalized = normalized.to_lowercase();
    let payload = format!("{}:{}", category.as_str(), normalized);
    let digest = Sha256::digest(payload.as_bytes());
    // First 16 hex chars = first 8 bytes = 64 bits of entropy — matches memU.
    let mut out = String::with_capacity(16);
    for byte in &digest[..8] {
        out.push_str(&format!("{:02x}", byte));
    }
    out
}

/// Column list used by every SELECT — keep in sync with `row_to_learning`'s
/// indexed getters.
pub(super) const SELECT_COLS: &str = "id, agent_scope, content, takeaway, category, importance, confidence, embedding, embedding_model, \
     status, content_hash, reinforcement_count, source, account_id, \
     evolution_type, parent_id, \
     last_recalled_at, source_session_id, created_at, updated_at";

/// Initialize the learnings table in sessions.db.
/// Called from SCHEMA_INIT in cache.rs.
pub fn init_learnings_table(conn: &Connection) -> SqliteResult<()> {
    // Fresh installs get the current schema directly. Older installs hit the
    // lazy ALTER TABLE / DROP COLUMN fallbacks below.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS learnings (
            id                    TEXT PRIMARY KEY,
            agent_scope           TEXT NOT NULL DEFAULT '_global',
            content               TEXT NOT NULL,
            takeaway              TEXT,
            category              TEXT NOT NULL DEFAULT 'pattern',
            importance            REAL NOT NULL DEFAULT 0.5,
            confidence            REAL NOT NULL DEFAULT 0.5,
            embedding             BLOB,
            embedding_model       TEXT,

            -- Lifecycle
            status                TEXT NOT NULL DEFAULT 'pending',
            content_hash          TEXT,
            reinforcement_count   INTEGER NOT NULL DEFAULT 1,
            source                TEXT NOT NULL DEFAULT 'reflection',
            account_id            TEXT,

            -- Evolution DAG
            evolution_type        TEXT NOT NULL DEFAULT 'original',
            parent_id             TEXT,

            -- Tracking
            last_recalled_at      TEXT,

            -- Metadata
            source_session_id     TEXT,
            created_at            TEXT NOT NULL,
            updated_at            TEXT NOT NULL,

            FOREIGN KEY (parent_id) REFERENCES learnings(id)
        );

        CREATE INDEX IF NOT EXISTS idx_learnings_scope
            ON learnings(agent_scope);
        CREATE INDEX IF NOT EXISTS idx_learnings_category
            ON learnings(agent_scope, category);
        DROP INDEX IF EXISTS idx_learnings_active;
        CREATE INDEX idx_learnings_active
            ON learnings(agent_scope, status)
            WHERE status NOT IN ('deprecated', 'abandoned');
        CREATE INDEX IF NOT EXISTS idx_learnings_parent
            ON learnings(parent_id);
        ",
    )?;

    // Migrations for existing DBs — each ALTER TABLE is idempotent (.ok() swallows
    // "duplicate column" errors from SQLite, which is the only acceptable swallow here).
    conn.execute(
        "ALTER TABLE learnings ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'",
        [],
    )
    .ok();
    conn.execute("ALTER TABLE learnings ADD COLUMN content_hash TEXT", [])
        .ok();
    conn.execute(
        "ALTER TABLE learnings ADD COLUMN reinforcement_count INTEGER NOT NULL DEFAULT 1",
        [],
    )
    .ok();
    conn.execute(
        "ALTER TABLE learnings ADD COLUMN source TEXT NOT NULL DEFAULT 'reflection'",
        [],
    )
    .ok();
    conn.execute("ALTER TABLE learnings ADD COLUMN account_id TEXT", [])
        .ok();

    // Columns added after the initial lifecycle schema — DBs created before these
    // additions will be missing these columns, causing SELECT failures.
    conn.execute("ALTER TABLE learnings ADD COLUMN takeaway TEXT", [])
        .ok();
    conn.execute("ALTER TABLE learnings ADD COLUMN embedding_model TEXT", [])
        .ok();
    conn.execute(
        "ALTER TABLE learnings ADD COLUMN evolution_type TEXT NOT NULL DEFAULT 'original'",
        [],
    )
    .ok();
    conn.execute("ALTER TABLE learnings ADD COLUMN parent_id TEXT", [])
        .ok();
    conn.execute(
        "ALTER TABLE learnings ADD COLUMN source_session_id TEXT",
        [],
    )
    .ok();

    // Lifecycle indexes (status/hash/account for single-table lifecycle queries).
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_learnings_hash ON learnings(content_hash)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_learnings_status ON learnings(status)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_learnings_account ON learnings(account_id, status)",
        [],
    )?;

    // Consolidation bookkeeping for the consolidation engine — one row per run.
    // Used by (a) the "lazy" trigger (last run was > 24h ago?) and (b) the
    // Consolidation Status card.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS consolidation_runs (
            id              TEXT PRIMARY KEY,
            agent_scope     TEXT NOT NULL,
            account_id      TEXT,
            trigger         TEXT NOT NULL,   -- 'idle' | 'lazy' | 'forced' | 'manual'
            mode            TEXT NOT NULL,   -- 'embedding' | 'manifest'
            pending_input   INTEGER NOT NULL DEFAULT 0,
            added           INTEGER NOT NULL DEFAULT 0,
            updated         INTEGER NOT NULL DEFAULT 0,
            deleted         INTEGER NOT NULL DEFAULT 0,
            none_count      INTEGER NOT NULL DEFAULT 0,
            abandoned       INTEGER NOT NULL DEFAULT 0,
            reinforced      INTEGER NOT NULL DEFAULT 0,
            error           TEXT,
            started_at      TEXT NOT NULL,
            finished_at     TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_consolidation_runs_scope
            ON consolidation_runs(agent_scope, finished_at DESC);
        ",
    )?;
    conn.execute(
        "ALTER TABLE consolidation_runs ADD COLUMN abandoned INTEGER NOT NULL DEFAULT 0",
        [],
    )
    .ok();

    super::super::reflection::blacklist::init_reflection_blacklist_table(conn)?;

    Ok(())
}

//! Lineage Schema — DDL for node_provenance and commit_lineage tables.

use rusqlite::{Connection, Result as SqliteResult};

pub fn init_lineage_tables(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS node_provenance (
            id INTEGER PRIMARY KEY,
            session_id TEXT NOT NULL,
            file TEXT NOT NULL,
            function_name TEXT,
            node_type TEXT,
            node_hash TEXT,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_np_session ON node_provenance(session_id);
        CREATE INDEX IF NOT EXISTS idx_np_file ON node_provenance(file);
        CREATE INDEX IF NOT EXISTS idx_np_hash ON node_provenance(node_hash);

        CREATE TABLE IF NOT EXISTS commit_lineage (
            id INTEGER PRIMARY KEY,
            provenance_id INTEGER NOT NULL,
            commit_id TEXT NOT NULL,
            file TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_cl_prov_commit
            ON commit_lineage(provenance_id, commit_id);
        CREATE INDEX IF NOT EXISTS idx_cl_commit ON commit_lineage(commit_id);",
    )?;
    Ok(())
}

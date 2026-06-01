# Database Infrastructure

Shared SQLite connection plumbing — pool, PRAGMAs, DB-file path resolution,
and a registration-based schema-init dispatcher. Leaf workspace crate
(`crates/database/`); depends only on `app_paths`.

## Modules

### `db/` — Database Connection Pool

Shared SQLite database at `~/.orgii/sessions.db` used by 17+ modules across the codebase.

**Usage:**

```rust
use database::db::get_connection;

let conn = get_connection()?;
conn.execute("INSERT INTO ...", params![...])?;
```

**Features:**

- SQLite with WAL mode for concurrent reads
- Automatic schema initialization on first connection (once per process)
- Per-connection PRAGMA optimization (cache size, temp store, sync mode)

**Consumers:**

| Module                      | Purpose                                    |
| --------------------------- | ------------------------------------------ |
| `session::cache`            | Session events, metadata, OS Agent tables  |
| `cli_session`               | CLI agent sessions (`code_sessions` table) |
| `agent_core::knowledge`     | Knowledge graph persistence                |
| `agent_core::session`       | Unified session persistence                |
| `agent_core::variants::os`  | OS Agent context                           |
| `agent_core::variants::sde` | SDE Agent context and persistence          |
| `dev_record`                | Development activity records               |
| `lineage`                   | AI session → commit tracking               |
| `git::repos`                | Repository tracking                        |
| `inbox`                     | Message persistence                        |

**Schema Initialization:**

The actual `CREATE TABLE` DDL is owned by the `app` crate (each domain
module — `agent_sessions`, `inbox`, `dev_record`, `agent_core::*` —
contributes its own `init_*_tables`). At startup, `app::run()` calls
`database::register_sessions_init` / `database::register_projects_init`
with a function pointer that walks every domain initializer in the order
below. The dispatcher fires once per physical DB path per process:

1. `session::cache::init_session_tables` — events, sessions, osagent\_\*, token_usage, repos
2. `cli_session::init_cli_agent_tables` — code_sessions, code_session_chunks
3. `inbox::init_inbox_tables` — inbox messages
4. `agent_core::knowledge::schema::init_kg_tables` — knowledge graph
5. `dev_record::schema::init_tables` — dev activity records
6. `lineage::schema::init_lineage_tables` — provenance, commit associations
7. `agent_core::session::persistence::init` — unified session columns


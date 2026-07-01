//! Database connection management for PostgreSQL and MySQL.
//!
//! Provides Tauri commands that the frontend TypeScript providers
//! (PostgresProvider, MySQLProvider) call via `invoke()`. Each engine
//! is gated behind a Cargo feature (`postgres`, `mysql`); both are
//! default-on so the production binary ships unchanged. A build with
//! `--no-default-features --features postgres` (or `mysql`) compiles
//! only the requested engine, dropping the other's driver crates.
//!
//! Uses sqlx connection pools behind the scenes.

use std::collections::HashMap;
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};
#[cfg(any(feature = "postgres", feature = "mysql"))]
use sqlx::{Column, Row, TypeInfo};
use tokio::sync::Mutex;

static POOLS: LazyLock<Mutex<HashMap<String, PoolEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

const MAX_POOLS: usize = 20;

#[allow(dead_code)] // Variant set is feature-gated; both off is a no-op build.
enum PoolEntry {
    #[cfg(feature = "postgres")]
    Postgres(sqlx::PgPool),
    #[cfg(feature = "mysql")]
    Mysql(sqlx::MySqlPool),
}

// ============================================
// Tauri-serializable result types
// ============================================

#[derive(Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: usize,
}

#[derive(Serialize, Deserialize)]
pub struct ExecuteResult {
    pub rows_affected: u64,
}

#[derive(Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub table_type: String,
    pub row_count: Option<i64>,
}

#[derive(Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub primary_key: bool,
    pub default_value: Option<String>,
    pub auto_increment: bool,
}

// ============================================
// Helpers
// ============================================

#[cfg(feature = "postgres")]
fn pg_row_to_json(row: &sqlx::postgres::PgRow) -> Vec<serde_json::Value> {
    let columns = row.columns();
    columns
        .iter()
        .map(|col| {
            let type_name = col.type_info().name();
            match type_name {
                "BOOL" => row
                    .try_get::<bool, _>(col.ordinal())
                    .map(serde_json::Value::Bool)
                    .unwrap_or(serde_json::Value::Null),
                "INT2" | "INT4" => row
                    .try_get::<i32, _>(col.ordinal())
                    .map(|v| serde_json::Value::Number(v.into()))
                    .unwrap_or(serde_json::Value::Null),
                "INT8" => row
                    .try_get::<i64, _>(col.ordinal())
                    .map(|v| serde_json::Value::Number(v.into()))
                    .unwrap_or(serde_json::Value::Null),
                "FLOAT4" | "FLOAT8" | "NUMERIC" => row
                    .try_get::<f64, _>(col.ordinal())
                    .ok()
                    .and_then(serde_json::Number::from_f64)
                    .map(serde_json::Value::Number)
                    .unwrap_or(serde_json::Value::Null),
                "JSONB" | "JSON" => row
                    .try_get::<serde_json::Value, _>(col.ordinal())
                    .unwrap_or(serde_json::Value::Null),
                _ => row
                    .try_get::<String, _>(col.ordinal())
                    .map(serde_json::Value::String)
                    .unwrap_or(serde_json::Value::Null),
            }
        })
        .collect()
}

#[cfg(feature = "mysql")]
fn mysql_row_to_json(row: &sqlx::mysql::MySqlRow) -> Vec<serde_json::Value> {
    let columns = row.columns();
    columns
        .iter()
        .map(|col| {
            let type_name = col.type_info().name();
            match type_name {
                "BOOLEAN" | "TINYINT(1)" => row
                    .try_get::<bool, _>(col.ordinal())
                    .map(serde_json::Value::Bool)
                    .unwrap_or(serde_json::Value::Null),
                "TINYINT" | "SMALLINT" | "INT" | "MEDIUMINT" => row
                    .try_get::<i32, _>(col.ordinal())
                    .map(|v| serde_json::Value::Number(v.into()))
                    .unwrap_or(serde_json::Value::Null),
                "BIGINT" => row
                    .try_get::<i64, _>(col.ordinal())
                    .map(|v| serde_json::Value::Number(v.into()))
                    .unwrap_or(serde_json::Value::Null),
                "FLOAT" | "DOUBLE" | "DECIMAL" => row
                    .try_get::<f64, _>(col.ordinal())
                    .ok()
                    .and_then(serde_json::Number::from_f64)
                    .map(serde_json::Value::Number)
                    .unwrap_or(serde_json::Value::Null),
                "JSON" => row
                    .try_get::<String, _>(col.ordinal())
                    .ok()
                    .and_then(|value| serde_json::from_str(&value).ok())
                    .unwrap_or(serde_json::Value::Null),
                _ => row
                    .try_get::<String, _>(col.ordinal())
                    .map(serde_json::Value::String)
                    .unwrap_or(serde_json::Value::Null),
            }
        })
        .collect()
}

// ============================================
// Tauri Commands
// ============================================

#[tauri::command]
pub async fn db_sql_connect(
    connection_id: String,
    db_type: String,
    connection_string: String,
) -> Result<(), String> {
    let mut pools = POOLS.lock().await;

    if pools.contains_key(&connection_id) {
        return Ok(());
    }

    // FIFO eviction
    if pools.len() >= MAX_POOLS {
        let first_key = pools.keys().next().cloned();
        if let Some(key) = first_key {
            pools.remove(&key);
        }
    }

    let entry = match db_type.as_str() {
        #[cfg(feature = "postgres")]
        "postgres" => {
            let pool = sqlx::PgPool::connect(&connection_string)
                .await
                .map_err(|err| format!("PostgreSQL connection failed: {err}"))?;
            sqlx::query("SELECT 1")
                .execute(&pool)
                .await
                .map_err(|err| format!("PostgreSQL ping failed: {err}"))?;
            PoolEntry::Postgres(pool)
        }
        #[cfg(feature = "mysql")]
        "mysql" => {
            let pool = sqlx::MySqlPool::connect(&connection_string)
                .await
                .map_err(|err| format!("MySQL connection failed: {err}"))?;
            sqlx::query("SELECT 1")
                .execute(&pool)
                .await
                .map_err(|err| format!("MySQL ping failed: {err}"))?;
            PoolEntry::Mysql(pool)
        }
        other => return Err(format!("Unsupported db_type: {other}")),
    };

    pools.insert(connection_id, entry);
    Ok(())
}

#[tauri::command]
pub async fn db_sql_disconnect(connection_id: String) -> Result<(), String> {
    let mut pools = POOLS.lock().await;
    if let Some(entry) = pools.remove(&connection_id) {
        match entry {
            #[cfg(feature = "postgres")]
            PoolEntry::Postgres(pool) => pool.close().await,
            #[cfg(feature = "mysql")]
            PoolEntry::Mysql(pool) => pool.close().await,
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn db_sql_query(connection_id: String, sql: String) -> Result<QueryResult, String> {
    let pools = POOLS.lock().await;
    let entry = pools
        .get(&connection_id)
        .ok_or_else(|| format!("No connection found for: {connection_id}"))?;

    match entry {
        #[cfg(feature = "postgres")]
        PoolEntry::Postgres(pool) => {
            let rows: Vec<sqlx::postgres::PgRow> = sqlx::query(&sql)
                .fetch_all(pool)
                .await
                .map_err(|err| format!("Query failed: {err}"))?;

            let columns: Vec<String> = if rows.is_empty() {
                vec![]
            } else {
                rows[0]
                    .columns()
                    .iter()
                    .map(|c| c.name().to_string())
                    .collect()
            };
            let row_count = rows.len();
            let json_rows: Vec<Vec<serde_json::Value>> = rows.iter().map(pg_row_to_json).collect();
            Ok(QueryResult {
                columns,
                rows: json_rows,
                row_count,
            })
        }
        #[cfg(feature = "mysql")]
        PoolEntry::Mysql(pool) => {
            let rows: Vec<sqlx::mysql::MySqlRow> = sqlx::query(&sql)
                .fetch_all(pool)
                .await
                .map_err(|err| format!("Query failed: {err}"))?;

            let columns: Vec<String> = if rows.is_empty() {
                vec![]
            } else {
                rows[0]
                    .columns()
                    .iter()
                    .map(|c| c.name().to_string())
                    .collect()
            };
            let row_count = rows.len();
            let json_rows: Vec<Vec<serde_json::Value>> =
                rows.iter().map(mysql_row_to_json).collect();
            Ok(QueryResult {
                columns,
                rows: json_rows,
                row_count,
            })
        }
    }
}

#[tauri::command]
pub async fn db_sql_execute(connection_id: String, sql: String) -> Result<ExecuteResult, String> {
    let pools = POOLS.lock().await;
    let entry = pools
        .get(&connection_id)
        .ok_or_else(|| format!("No connection found for: {connection_id}"))?;

    let rows_affected = match entry {
        #[cfg(feature = "postgres")]
        PoolEntry::Postgres(pool) => sqlx::query(&sql)
            .execute(pool)
            .await
            .map_err(|err| format!("Execute failed: {err}"))?
            .rows_affected(),
        #[cfg(feature = "mysql")]
        PoolEntry::Mysql(pool) => sqlx::query(&sql)
            .execute(pool)
            .await
            .map_err(|err| format!("Execute failed: {err}"))?
            .rows_affected(),
    };

    Ok(ExecuteResult { rows_affected })
}

#[tauri::command]
pub async fn db_sql_get_tables(connection_id: String) -> Result<Vec<TableInfo>, String> {
    let pools = POOLS.lock().await;
    let entry = pools
        .get(&connection_id)
        .ok_or_else(|| format!("No connection found for: {connection_id}"))?;

    match entry {
        #[cfg(feature = "postgres")]
        PoolEntry::Postgres(pool) => {
            let rows: Vec<(String, String)> = sqlx::query_as(
                "SELECT table_name, table_type \
                 FROM information_schema.tables \
                 WHERE table_schema = 'public' \
                   AND table_type IN ('BASE TABLE', 'VIEW') \
                 ORDER BY table_name",
            )
            .fetch_all(pool)
            .await
            .map_err(|err| format!("Failed to list tables: {err}"))?;

            Ok(rows
                .into_iter()
                .map(|(name, table_type)| TableInfo {
                    name,
                    table_type,
                    row_count: None,
                })
                .collect())
        }
        #[cfg(feature = "mysql")]
        PoolEntry::Mysql(pool) => {
            let rows: Vec<(String, String)> = sqlx::query_as(
                "SELECT TABLE_NAME, TABLE_TYPE \
                 FROM information_schema.TABLES \
                 WHERE TABLE_SCHEMA = DATABASE() \
                   AND TABLE_TYPE IN ('BASE TABLE', 'VIEW') \
                 ORDER BY TABLE_NAME",
            )
            .fetch_all(pool)
            .await
            .map_err(|err| format!("Failed to list tables: {err}"))?;

            Ok(rows
                .into_iter()
                .map(|(name, table_type)| TableInfo {
                    name,
                    table_type,
                    row_count: None,
                })
                .collect())
        }
    }
}

#[tauri::command]
pub async fn db_sql_get_table_schema(
    connection_id: String,
    table_name: String,
) -> Result<Vec<ColumnInfo>, String> {
    let pools = POOLS.lock().await;
    let entry = pools
        .get(&connection_id)
        .ok_or_else(|| format!("No connection found for: {connection_id}"))?;

    match entry {
        #[cfg(feature = "postgres")]
        PoolEntry::Postgres(pool) => {
            let rows: Vec<sqlx::postgres::PgRow> = sqlx::query(
                "SELECT \
                   c.column_name, \
                   COALESCE(c.udt_name, c.data_type) as data_type, \
                   c.is_nullable, \
                   c.column_default, \
                   CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_pk \
                 FROM information_schema.columns c \
                 LEFT JOIN ( \
                   SELECT ku.column_name \
                   FROM information_schema.table_constraints tc \
                   JOIN information_schema.key_column_usage ku \
                     ON tc.constraint_name = ku.constraint_name \
                     AND tc.table_schema = ku.table_schema \
                   WHERE tc.constraint_type = 'PRIMARY KEY' \
                     AND tc.table_schema = 'public' \
                     AND tc.table_name = $1 \
                 ) pk ON c.column_name = pk.column_name \
                 WHERE c.table_schema = 'public' \
                   AND c.table_name = $1 \
                 ORDER BY c.ordinal_position",
            )
            .bind(&table_name)
            .fetch_all(pool)
            .await
            .map_err(|err| format!("Failed to get schema: {err}"))?;

            Ok(rows
                .iter()
                .map(|row| {
                    let col_default: Option<String> = row.try_get("column_default").unwrap_or(None);
                    let is_auto = col_default
                        .as_ref()
                        .map(|d| d.contains("nextval"))
                        .unwrap_or(false);
                    ColumnInfo {
                        name: row.get("column_name"),
                        data_type: row
                            .try_get::<String, _>("data_type")
                            .unwrap_or_default()
                            .to_uppercase(),
                        nullable: row.try_get::<String, _>("is_nullable").unwrap_or_default()
                            == "YES",
                        primary_key: row.try_get::<bool, _>("is_pk").unwrap_or(false),
                        default_value: col_default,
                        auto_increment: is_auto,
                    }
                })
                .collect())
        }
        #[cfg(feature = "mysql")]
        PoolEntry::Mysql(pool) => {
            let rows: Vec<sqlx::mysql::MySqlRow> = sqlx::query(
                "SELECT \
                   COLUMN_NAME, \
                   COLUMN_TYPE, \
                   IS_NULLABLE, \
                   COLUMN_DEFAULT, \
                   COLUMN_KEY, \
                   EXTRA \
                 FROM information_schema.COLUMNS \
                 WHERE TABLE_SCHEMA = DATABASE() \
                   AND TABLE_NAME = ? \
                 ORDER BY ORDINAL_POSITION",
            )
            .bind(&table_name)
            .fetch_all(pool)
            .await
            .map_err(|err| format!("Failed to get schema: {err}"))?;

            Ok(rows
                .iter()
                .map(|row| ColumnInfo {
                    name: row.try_get("COLUMN_NAME").unwrap_or_default(),
                    data_type: row
                        .try_get::<String, _>("COLUMN_TYPE")
                        .unwrap_or_default()
                        .to_uppercase(),
                    nullable: row.try_get::<String, _>("IS_NULLABLE").unwrap_or_default() == "YES",
                    primary_key: row.try_get::<String, _>("COLUMN_KEY").unwrap_or_default()
                        == "PRI",
                    default_value: row.try_get("COLUMN_DEFAULT").unwrap_or(None),
                    auto_increment: row
                        .try_get::<String, _>("EXTRA")
                        .unwrap_or_default()
                        .contains("auto_increment"),
                })
                .collect())
        }
    }
}

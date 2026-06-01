//! Synchronous DB Browser operations.
//!
//! All functions take a `&rusqlite::Connection` (borrowed from the pool).
//! `is_valid_sqlite_file` is the only function that does not use SQLite — it
//! reads the raw file header and returns `Result<bool, String>`. All other
//! functions return `rusqlite::Result<T>`.

use std::time::Instant;

use rusqlite::{params_from_iter, Connection, Result as SqliteResult};

use super::types::{
    ColumnInfo, ColumnValueMap, ExecuteResult, QueryOptions, QueryResult, TableInfo,
};

// ============================================
// Row serialization helpers
// ============================================

fn rusqlite_value_to_json(val: rusqlite::types::Value) -> serde_json::Value {
    match val {
        rusqlite::types::Value::Null => serde_json::Value::Null,
        rusqlite::types::Value::Integer(int) => serde_json::json!(int),
        rusqlite::types::Value::Real(flt) => serde_json::json!(flt),
        rusqlite::types::Value::Text(text) => serde_json::Value::String(text),
        rusqlite::types::Value::Blob(bytes) => {
            // Encode blobs as hex strings so they survive the JSON round-trip
            serde_json::Value::String(format!("0x{}", hex::encode(&bytes)))
        }
    }
}

fn collect_rows(
    stmt: &mut rusqlite::Statement,
    col_count: usize,
) -> SqliteResult<Vec<Vec<serde_json::Value>>> {
    let mut rows = Vec::new();
    let mut row_iter = stmt.query([])?;
    while let Some(row) = row_iter.next()? {
        let mut cells = Vec::with_capacity(col_count);
        for idx in 0..col_count {
            let val: rusqlite::types::Value = row.get(idx)?;
            cells.push(rusqlite_value_to_json(val));
        }
        rows.push(cells);
    }
    Ok(rows)
}

// ============================================
// Schema introspection
// ============================================

pub fn get_tables(conn: &Connection) -> SqliteResult<Vec<TableInfo>> {
    let mut stmt = conn.prepare(
        "SELECT name, type, sql FROM sqlite_master
         WHERE type IN ('table', 'view')
           AND name NOT LIKE 'sqlite_%'
         ORDER BY name",
    )?;

    let col_count = stmt.column_count();
    let rows = collect_rows(&mut stmt, col_count)?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let name = row[0].as_str().unwrap_or("").to_string();
            let kind = row[1].as_str().unwrap_or("table").to_string();
            let sql = row[2].as_str().map(|s| s.to_string());
            TableInfo {
                name,
                kind,
                row_count: None,
                sql,
            }
        })
        .collect())
}

pub fn get_table_schema(conn: &Connection, table_name: &str) -> SqliteResult<Vec<ColumnInfo>> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info(\"{}\")", table_name))?;
    let col_count = stmt.column_count();
    let rows = collect_rows(&mut stmt, col_count)?;

    // Check if any INTEGER PRIMARY KEY column has AUTOINCREMENT
    let create_sql: Option<String> = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
            [table_name],
            |row| row.get(0),
        )
        .unwrap_or(None);

    let sql_upper = create_sql.as_deref().unwrap_or("").to_uppercase();

    let cols: Vec<ColumnInfo> = rows
        .into_iter()
        .map(|row| {
            // PRAGMA table_info columns:
            // 0=cid, 1=name, 2=type, 3=notnull, 4=dflt_value, 5=pk
            let name = row[1].as_str().unwrap_or("").to_string();
            let col_type = row[2].as_str().unwrap_or("").to_string();
            let notnull = row[3].as_i64().unwrap_or(0) != 0;
            let default_value = match &row[4] {
                serde_json::Value::Null => None,
                other => Some(other.to_string()),
            };
            let pk = row[5].as_i64().unwrap_or(0) != 0;

            // Detect AUTOINCREMENT by scanning the CREATE TABLE SQL
            let auto_increment = pk
                && col_type.to_uppercase().contains("INTEGER")
                && sql_upper.contains("AUTOINCREMENT");

            ColumnInfo {
                name,
                col_type,
                nullable: !notnull,
                primary_key: pk,
                default_value,
                auto_increment,
            }
        })
        .collect();

    Ok(cols)
}

// ============================================
// Query
// ============================================

pub fn query(conn: &Connection, sql: &str) -> SqliteResult<QueryResult> {
    let start = Instant::now();
    let mut stmt = conn.prepare(sql)?;
    let col_count = stmt.column_count();
    let columns: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let values = collect_rows(&mut stmt, col_count)?;
    let row_count = values.len() as i64;
    let duration = start.elapsed().as_secs_f64() * 1000.0;

    Ok(QueryResult {
        columns,
        values,
        row_count,
        total_count: None,
        duration,
    })
}

pub fn get_table_data(
    conn: &Connection,
    table_name: &str,
    options: Option<&QueryOptions>,
) -> SqliteResult<QueryResult> {
    let page = options.and_then(|o| o.page).unwrap_or(1).max(1);
    let page_size = options.and_then(|o| o.page_size).unwrap_or(100).max(1);
    let offset = (page - 1) * page_size;
    let order_by = options.and_then(|o| o.order_by.as_deref());
    let order_dir = options
        .and_then(|o| o.order_direction.as_deref())
        .unwrap_or("asc");

    let mut sql = format!("SELECT * FROM \"{}\"", table_name);
    if let Some(col) = order_by {
        let dir = if order_dir.to_lowercase() == "desc" {
            "DESC"
        } else {
            "ASC"
        };
        sql += &format!(" ORDER BY \"{}\" {}", col, dir);
    }
    sql += &format!(" LIMIT {} OFFSET {}", page_size, offset);

    let start = Instant::now();
    let mut stmt = conn.prepare(&sql)?;
    let col_count = stmt.column_count();
    let columns: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let values = collect_rows(&mut stmt, col_count)?;
    let row_count = values.len() as i64;
    let duration = start.elapsed().as_secs_f64() * 1000.0;

    // Total count for pagination
    let total_count: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM \"{}\"", table_name),
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    Ok(QueryResult {
        columns,
        values,
        row_count,
        total_count: Some(total_count),
        duration,
    })
}

// ============================================
// Execute (write statements)
// ============================================

pub fn execute(conn: &Connection, sql: &str) -> SqliteResult<ExecuteResult> {
    let start = Instant::now();
    match conn.execute_batch(sql) {
        Ok(_) => {
            let rows_affected = conn.changes() as i64;
            let duration = start.elapsed().as_secs_f64() * 1000.0;
            Ok(ExecuteResult {
                success: true,
                rows_affected,
                duration,
                last_insert_id: Some(conn.last_insert_rowid()),
                error: None,
            })
        }
        Err(err) => {
            let duration = start.elapsed().as_secs_f64() * 1000.0;
            Ok(ExecuteResult {
                success: false,
                rows_affected: 0,
                duration,
                last_insert_id: None,
                error: Some(err.to_string()),
            })
        }
    }
}

// ============================================
// CRUD helpers
// ============================================

fn json_value_to_sql_param(val: &serde_json::Value) -> rusqlite::types::Value {
    match val {
        serde_json::Value::Null => rusqlite::types::Value::Null,
        serde_json::Value::Bool(b) => rusqlite::types::Value::Integer(if *b { 1 } else { 0 }),
        serde_json::Value::Number(n) => {
            if let Some(int) = n.as_i64() {
                rusqlite::types::Value::Integer(int)
            } else if let Some(flt) = n.as_f64() {
                rusqlite::types::Value::Real(flt)
            } else {
                rusqlite::types::Value::Null
            }
        }
        serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
        other => rusqlite::types::Value::Text(other.to_string()),
    }
}

pub fn insert(
    conn: &Connection,
    table_name: &str,
    data: &ColumnValueMap,
) -> SqliteResult<ExecuteResult> {
    let columns: Vec<&String> = data.keys().collect();
    let values: Vec<rusqlite::types::Value> = columns
        .iter()
        .map(|k| json_value_to_sql_param(&data[*k]))
        .collect();

    let placeholders = columns.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let col_list = columns
        .iter()
        .map(|c| format!("\"{}\"", c))
        .collect::<Vec<_>>()
        .join(", ");

    let sql = format!(
        "INSERT INTO \"{}\" ({}) VALUES ({})",
        table_name, col_list, placeholders
    );

    let start = Instant::now();
    match conn.execute(&sql, params_from_iter(values)) {
        Ok(_) => {
            let duration = start.elapsed().as_secs_f64() * 1000.0;
            Ok(ExecuteResult {
                success: true,
                rows_affected: conn.changes() as i64,
                duration,
                last_insert_id: Some(conn.last_insert_rowid()),
                error: None,
            })
        }
        Err(err) => {
            let duration = start.elapsed().as_secs_f64() * 1000.0;
            Ok(ExecuteResult {
                success: false,
                rows_affected: 0,
                duration,
                last_insert_id: None,
                error: Some(err.to_string()),
            })
        }
    }
}

pub fn update(
    conn: &Connection,
    table_name: &str,
    data: &ColumnValueMap,
    where_clause: &ColumnValueMap,
) -> SqliteResult<ExecuteResult> {
    let set_cols: Vec<&String> = data.keys().collect();
    let where_cols: Vec<&String> = where_clause.keys().collect();

    let set_clauses: Vec<String> = set_cols.iter().map(|c| format!("\"{}\" = ?", c)).collect();
    let where_clauses: Vec<String> = where_cols
        .iter()
        .map(|c| format!("\"{}\" = ?", c))
        .collect();

    let mut values: Vec<rusqlite::types::Value> = set_cols
        .iter()
        .map(|k| json_value_to_sql_param(&data[*k]))
        .collect();
    values.extend(
        where_cols
            .iter()
            .map(|k| json_value_to_sql_param(&where_clause[*k])),
    );

    let sql = format!(
        "UPDATE \"{}\" SET {} WHERE {}",
        table_name,
        set_clauses.join(", "),
        where_clauses.join(" AND ")
    );

    let start = Instant::now();
    match conn.execute(&sql, params_from_iter(values)) {
        Ok(_) => {
            let duration = start.elapsed().as_secs_f64() * 1000.0;
            Ok(ExecuteResult {
                success: true,
                rows_affected: conn.changes() as i64,
                duration,
                last_insert_id: None,
                error: None,
            })
        }
        Err(err) => {
            let duration = start.elapsed().as_secs_f64() * 1000.0;
            Ok(ExecuteResult {
                success: false,
                rows_affected: 0,
                duration,
                last_insert_id: None,
                error: Some(err.to_string()),
            })
        }
    }
}

pub fn delete(
    conn: &Connection,
    table_name: &str,
    where_clause: &ColumnValueMap,
) -> SqliteResult<ExecuteResult> {
    let where_cols: Vec<&String> = where_clause.keys().collect();
    let clauses: Vec<String> = where_cols
        .iter()
        .map(|c| format!("\"{}\" = ?", c))
        .collect();
    let values: Vec<rusqlite::types::Value> = where_cols
        .iter()
        .map(|k| json_value_to_sql_param(&where_clause[*k]))
        .collect();

    let sql = format!(
        "DELETE FROM \"{}\" WHERE {}",
        table_name,
        clauses.join(" AND ")
    );

    let start = Instant::now();
    match conn.execute(&sql, params_from_iter(values)) {
        Ok(_) => {
            let duration = start.elapsed().as_secs_f64() * 1000.0;
            Ok(ExecuteResult {
                success: true,
                rows_affected: conn.changes() as i64,
                duration,
                last_insert_id: None,
                error: None,
            })
        }
        Err(err) => {
            let duration = start.elapsed().as_secs_f64() * 1000.0;
            Ok(ExecuteResult {
                success: false,
                rows_affected: 0,
                duration,
                last_insert_id: None,
                error: Some(err.to_string()),
            })
        }
    }
}

// ============================================
// File validation
// ============================================

pub fn is_valid_sqlite_file(path: &str) -> Result<bool, String> {
    use std::io::Read;
    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return Ok(false),
    };
    let mut header = [0u8; 16];
    if file.read_exact(&mut header).is_err() {
        return Ok(false);
    }
    Ok(&header[..15] == b"SQLite format 3")
}

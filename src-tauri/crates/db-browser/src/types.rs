//! DB Browser types — mirrors the frontend `DatabaseCore` types exactly so
//! serde round-trips without any JS-side transformation.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String, // "table" | "view"
    pub row_count: Option<i64>,
    pub sql: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    #[serde(rename = "type")]
    pub col_type: String,
    pub nullable: bool,
    pub primary_key: bool,
    pub default_value: Option<String>,
    pub auto_increment: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<String>,
    /// Rows as JSON arrays: each cell is a serde_json::Value
    pub values: Vec<Vec<serde_json::Value>>,
    pub row_count: i64,
    pub total_count: Option<i64>,
    pub duration: f64, // milliseconds
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteResult {
    pub success: bool,
    pub rows_affected: i64,
    pub duration: f64,
    pub last_insert_id: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryOptions {
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    pub order_by: Option<String>,
    pub order_direction: Option<String>, // "asc" | "desc"
}

/// Column name → JSON value map used for row data and WHERE conditions.
pub type ColumnValueMap = HashMap<String, serde_json::Value>;

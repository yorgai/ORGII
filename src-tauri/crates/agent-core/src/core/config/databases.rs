//! Database connection configuration for agent-accessible databases.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Supported database provider types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseProviderType {
    #[default]
    Sqlite,
    Supabase,
    Turso,
    Neon,
    Postgres,
    Mysql,
}

impl std::fmt::Display for DatabaseProviderType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sqlite => write!(f, "sqlite"),
            Self::Supabase => write!(f, "supabase"),
            Self::Turso => write!(f, "turso"),
            Self::Neon => write!(f, "neon"),
            Self::Postgres => write!(f, "postgres"),
            Self::Mysql => write!(f, "mysql"),
        }
    }
}

/// A single database connection config (non-secret fields only).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseConnectionEntry {
    /// Whether this connection is available to agents.
    #[serde(default)]
    pub enabled: bool,

    /// Human-readable name.
    #[serde(default)]
    pub name: String,

    /// Provider type.
    #[serde(rename = "type")]
    pub db_type: DatabaseProviderType,

    /// Connection URL or file path (non-secret).
    #[serde(default)]
    pub url: String,

    /// Whether the connection requires read-only access from agents.
    #[serde(default)]
    pub read_only: bool,
}

/// Container for all database connections, keyed by connection ID.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabasesConfig {
    /// Map of connection ID → connection config.
    #[serde(default)]
    pub connections: HashMap<String, DatabaseConnectionEntry>,
}

impl DatabasesConfig {
    /// Get all enabled connections.
    pub fn enabled_connections(&self) -> Vec<(&str, &DatabaseConnectionEntry)> {
        self.connections
            .iter()
            .filter(|(_, entry)| entry.enabled)
            .map(|(id, entry)| (id.as_str(), entry))
            .collect()
    }

    /// Check if a connection exists and is enabled.
    pub fn is_connection_enabled(&self, connection_id: &str) -> bool {
        self.connections
            .get(connection_id)
            .map(|entry| entry.enabled)
            .unwrap_or(false)
    }
}

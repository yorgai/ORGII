//! IPC wire types for the `orgii-embedder` subprocess.
//!
//! Shared between the in-process subprocess client (`SubprocessEmbedder`)
//! and the embedder binary itself so the wire format has exactly one
//! definition.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Request {
    Init { id: u64, model_dir: String },
    Embed { id: u64, texts: Vec<String> },
    Ping { id: u64 },
    Shutdown { id: u64 },
}

/// `id` fields are required for JSON deserialization but unread on the
/// client side (the protocol is synchronous request/response, not pipelined).
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
#[allow(dead_code)]
pub enum Response {
    Ready {
        id: u64,
        dimensions: usize,
        mode: String,
    },
    Result {
        id: u64,
        embeddings: Vec<Vec<f32>>,
    },
    Pong {
        id: u64,
    },
    Error {
        id: u64,
        message: String,
    },
    Bye {
        id: u64,
    },
}

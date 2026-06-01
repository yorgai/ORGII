//! Fast Hash Computation
//!
//! Provides SHA-256 and Blake3 hash computation.
//! Blake3 is significantly faster than SHA-256 for large files.

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::command;
use tokio::io::AsyncReadExt;

// ============================================
// Types
// ============================================

#[derive(Debug, Clone, Serialize)]
pub struct HashResult {
    /// Hash value in hex format
    pub hash: String,
    /// Algorithm used
    pub algorithm: String,
    /// Input size in bytes
    pub input_size: usize,
    /// Processing time in milliseconds
    pub processing_time_ms: f64,
}

// ============================================
// Tauri Commands
// ============================================

/// Compute SHA-256 hash of a string
#[command]
pub fn compute_sha256(data: String) -> HashResult {
    let start = std::time::Instant::now();
    let input_size = data.len();

    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    let result = hasher.finalize();
    let hash = hex::encode(result);

    let processing_time_ms = start.elapsed().as_secs_f64() * 1000.0;

    HashResult {
        hash,
        algorithm: "SHA-256".to_string(),
        input_size,
        processing_time_ms,
    }
}

/// Compute SHA-256 hash of bytes
#[command]
pub fn compute_sha256_bytes(data: Vec<u8>) -> HashResult {
    let start = std::time::Instant::now();
    let input_size = data.len();

    let mut hasher = Sha256::new();
    hasher.update(&data);
    let result = hasher.finalize();
    let hash = hex::encode(result);

    let processing_time_ms = start.elapsed().as_secs_f64() * 1000.0;

    HashResult {
        hash,
        algorithm: "SHA-256".to_string(),
        input_size,
        processing_time_ms,
    }
}

/// Compute Blake3 hash of a string
///
/// Blake3 is much faster than SHA-256, especially for large inputs.
#[command]
pub fn compute_blake3(data: String) -> HashResult {
    let start = std::time::Instant::now();
    let input_size = data.len();

    let hash = blake3::hash(data.as_bytes());
    let hash_hex = hash.to_hex().to_string();

    let processing_time_ms = start.elapsed().as_secs_f64() * 1000.0;

    HashResult {
        hash: hash_hex,
        algorithm: "Blake3".to_string(),
        input_size,
        processing_time_ms,
    }
}

/// Compute Blake3 hash of bytes
#[command]
pub fn compute_blake3_bytes(data: Vec<u8>) -> HashResult {
    let start = std::time::Instant::now();
    let input_size = data.len();

    let hash = blake3::hash(&data);
    let hash_hex = hash.to_hex().to_string();

    let processing_time_ms = start.elapsed().as_secs_f64() * 1000.0;

    HashResult {
        hash: hash_hex,
        algorithm: "Blake3".to_string(),
        input_size,
        processing_time_ms,
    }
}

/// Compute hash of a file using streaming (memory efficient)
///
/// Uses Blake3 by default for performance.
#[command]
pub async fn compute_file_hash(
    path: String,
    algorithm: Option<String>,
) -> Result<HashResult, String> {
    let start = std::time::Instant::now();

    let mut file = tokio::fs::File::open(&path)
        .await
        .map_err(|e| format!("Failed to open file: {}", e))?;

    let metadata = file
        .metadata()
        .await
        .map_err(|e| format!("Failed to get file metadata: {}", e))?;

    let input_size = metadata.len() as usize;
    let algo = algorithm
        .unwrap_or_else(|| "blake3".to_string())
        .to_lowercase();

    // Use streaming to avoid loading entire file into memory
    let hash = match algo.as_str() {
        "sha256" | "sha-256" => {
            let mut hasher = Sha256::new();
            let mut buffer = [0u8; 64 * 1024]; // 64KB buffer

            loop {
                let bytes_read = file
                    .read(&mut buffer)
                    .await
                    .map_err(|e| format!("Failed to read file: {}", e))?;

                if bytes_read == 0 {
                    break;
                }

                hasher.update(&buffer[..bytes_read]);
            }

            hex::encode(hasher.finalize())
        }
        _ => {
            let mut hasher = blake3::Hasher::new();
            let mut buffer = [0u8; 64 * 1024]; // 64KB buffer

            loop {
                let bytes_read = file
                    .read(&mut buffer)
                    .await
                    .map_err(|e| format!("Failed to read file: {}", e))?;

                if bytes_read == 0 {
                    break;
                }

                hasher.update(&buffer[..bytes_read]);
            }

            hasher.finalize().to_hex().to_string()
        }
    };

    let processing_time_ms = start.elapsed().as_secs_f64() * 1000.0;

    Ok(HashResult {
        hash,
        algorithm: if algo == "sha256" || algo == "sha-256" {
            "SHA-256".to_string()
        } else {
            "Blake3".to_string()
        },
        input_size,
        processing_time_ms,
    })
}

/// Batch hash multiple strings using Blake3
///
/// More efficient than hashing one by one.
#[command]
pub fn compute_blake3_batch(data: Vec<String>) -> Vec<String> {
    data.iter()
        .map(|s| blake3::hash(s.as_bytes()).to_hex().to_string())
        .collect()
}

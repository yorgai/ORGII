//! Binary File Detection
//!
//! SIMD-accelerated binary file detection using `memchr` and magic bytes via `infer`.
//! Performance: 10-20x faster than JavaScript character iteration.
//!
//! Detection order:
//! 1. Magic bytes (infer crate) — most reliable for known file types
//! 2. Extension check — fast fallback
//! 3. Content analysis (null bytes, non-printable ratio) — heuristic fallback

use memchr::memchr;
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;
use tauri::command;

// ============================================
// Constants
// ============================================

/// Binary file extensions (comprehensive list)
const BINARY_EXTENSIONS: &[&str] = &[
    // Images
    "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "svg", "tiff", "tif", "psd", "ai", "eps",
    "raw", "cr2", "nef", "orf", "sr2", // Videos
    "mp4", "avi", "mov", "wmv", "flv", "mkv", "webm", "m4v", "mpg", "mpeg", "3gp",
    // Audio
    "mp3", "wav", "flac", "aac", "ogg", "wma", "m4a", "opus", "aiff", // Archives
    "zip", "tar", "gz", "bz2", "7z", "rar", "xz", "tgz", "jar", "war", "ear",
    // Executables & Libraries
    "exe", "dll", "so", "dylib", "bin", "app", "deb", "rpm", "msi", "dmg", "pkg", "apk", "ipa",
    // Documents (binary formats)
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", // Fonts
    "ttf", "otf", "woff", "woff2", "eot", // Database
    "db", "sqlite", "sqlite3", "mdb", // Other binary formats
    "pyc", "pyo", "class", "o", "obj", "a", "lib", "wasm", "node",
];

/// Known text files without extensions
const KNOWN_TEXT_FILES: &[&str] = &[
    "Makefile",
    "Dockerfile",
    "Jenkinsfile",
    "Vagrantfile",
    "Gemfile",
    "Rakefile",
    "Procfile",
    "README",
    "LICENSE",
    "CHANGELOG",
    "CONTRIBUTING",
    "AUTHORS",
    "NOTICE",
    ".gitignore",
    ".dockerignore",
    ".npmignore",
    ".editorconfig",
    ".prettierrc",
    ".eslintrc",
    ".babelrc",
];

static BINARY_EXT_SET: std::sync::LazyLock<HashSet<&'static str>> =
    std::sync::LazyLock::new(|| BINARY_EXTENSIONS.iter().copied().collect());

static TEXT_FILE_SET: std::sync::LazyLock<HashSet<&'static str>> =
    std::sync::LazyLock::new(|| KNOWN_TEXT_FILES.iter().copied().collect());

// ============================================
// Types
// ============================================

#[derive(Debug, Clone, Serialize)]
pub struct BinaryCheckResult {
    /// Whether the file is binary
    pub is_binary: bool,
    /// Reason for the detection
    pub reason: String,
    /// Processing time in microseconds
    pub processing_time_us: f64,
}

// ============================================
// Detection Functions
// ============================================

/// Check if file is binary based on extension
#[inline]
pub(crate) fn is_binary_by_extension(path: &str) -> Option<bool> {
    let path = Path::new(path);

    // Get filename
    let filename = path.file_name()?.to_str()?;

    // Check known text files
    if TEXT_FILE_SET.contains(filename) {
        return Some(false);
    }

    // Get extension
    if let Some(ext) = path.extension() {
        let ext_lower = ext.to_str()?.to_lowercase();
        if BINARY_EXT_SET.contains(ext_lower.as_str()) {
            return Some(true);
        }
    } else {
        // No extension - check for binary patterns in path
        let path_str = path.to_str()?;

        // Common binary executable patterns
        if path_str.contains("-aarch64")
            || path_str.contains("-x86_64")
            || path_str.contains("-arm64")
            || path_str.contains("-darwin")
            || path_str.contains("-linux")
            || path_str.contains("-windows")
            || path_str.to_lowercase().contains("helper")
            || path_str.to_lowercase().contains("daemon")
            || path_str.contains("/bin/")
        {
            return Some(true);
        }
    }

    None // Unknown, need content check
}

/// Check if content is binary using SIMD-accelerated byte scanning
///
/// Detection criteria:
/// 1. Presence of null bytes (0x00) - strong indicator
/// 2. High proportion of non-printable characters (>30%)
#[inline]
pub(crate) fn is_binary_content(content: &[u8], sample_size: usize) -> bool {
    let sample = &content[..content.len().min(sample_size)];

    // Fast null byte check using SIMD (memchr)
    if memchr(0, sample).is_some() {
        return true;
    }

    // Count non-printable characters
    let non_printable_count: usize = sample
        .iter()
        .filter(|&&byte| {
            // Allow common whitespace
            if byte == 9 || byte == 10 || byte == 13 || byte == 32 {
                return false;
            }
            // Non-printable: < 32 or (127 < byte < 160)
            byte < 32 || (byte > 126 && byte < 160)
        })
        .count();

    // If more than 30% are non-printable, consider binary
    let ratio = non_printable_count as f64 / sample.len() as f64;
    ratio > 0.3
}

// ============================================
// Tauri Commands
// ============================================

/// Check if a file is binary by path (extension check only)
///
/// Fast check that doesn't read file contents.
/// Returns `None` if extension is unknown and content check is needed.
#[command]
pub fn check_binary_by_path(path: String) -> Option<bool> {
    is_binary_by_extension(&path)
}

/// Check if content bytes are binary
///
/// Uses SIMD-accelerated scanning for null bytes and
/// statistical analysis for non-printable character ratio.
#[command]
pub fn check_binary_content(content: Vec<u8>, sample_size: Option<usize>) -> BinaryCheckResult {
    let start = std::time::Instant::now();
    let sample_size = sample_size.unwrap_or(8000);

    let is_binary = is_binary_content(&content, sample_size);
    let processing_time_us = start.elapsed().as_secs_f64() * 1_000_000.0;

    let reason = if is_binary {
        if memchr(0, &content[..content.len().min(sample_size)]).is_some() {
            "Contains null bytes".to_string()
        } else {
            "High proportion of non-printable characters".to_string()
        }
    } else {
        "Text content detected".to_string()
    };

    BinaryCheckResult {
        is_binary,
        reason,
        processing_time_us,
    }
}

/// Full binary file check: extension + content
///
/// Reads file and performs comprehensive check.
#[command]
pub async fn check_file_is_binary(
    path: String,
    sample_size: Option<usize>,
) -> Result<BinaryCheckResult, String> {
    let start = std::time::Instant::now();

    // First try extension check
    if let Some(is_binary) = is_binary_by_extension(&path) {
        return Ok(BinaryCheckResult {
            is_binary,
            reason: if is_binary {
                "Binary file extension".to_string()
            } else {
                "Known text file".to_string()
            },
            processing_time_us: start.elapsed().as_secs_f64() * 1_000_000.0,
        });
    }

    // Read file content for deeper check
    let content = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let sample_size = sample_size.unwrap_or(8000);
    let is_binary = is_binary_content(&content, sample_size);
    let processing_time_us = start.elapsed().as_secs_f64() * 1_000_000.0;

    let reason = if is_binary {
        if memchr(0, &content[..content.len().min(sample_size)]).is_some() {
            "Contains null bytes".to_string()
        } else {
            "High proportion of non-printable characters".to_string()
        }
    } else {
        "Text content detected".to_string()
    };

    Ok(BinaryCheckResult {
        is_binary,
        reason,
        processing_time_us,
    })
}

// ============================================
// Enhanced Detection with Magic Bytes (infer)
// ============================================

/// Binary file types detected by magic bytes.
/// These are file types that are definitively binary.
fn is_binary_by_magic_bytes(content: &[u8]) -> Option<(bool, String)> {
    // Need at least a few bytes for magic detection
    if content.len() < 12 {
        return None;
    }

    // Use infer crate to detect file type from magic bytes
    if let Some(kind) = infer::get(content) {
        let mime = kind.mime_type();
        let ext = kind.extension();

        // Binary types: images, videos, audio, archives, executables, fonts
        let is_binary = mime.starts_with("image/")
            || mime.starts_with("video/")
            || mime.starts_with("audio/")
            || mime.starts_with("application/zip")
            || mime.starts_with("application/x-tar")
            || mime.starts_with("application/gzip")
            || mime.starts_with("application/x-bzip2")
            || mime.starts_with("application/x-7z-compressed")
            || mime.starts_with("application/x-rar-compressed")
            || mime.starts_with("application/x-xz")
            || mime.starts_with("application/pdf")
            || mime.starts_with("application/x-executable")
            || mime.starts_with("application/x-mach-binary")
            || mime.starts_with("application/x-sharedlib")
            || mime.starts_with("application/vnd.ms-")
            || mime.starts_with("application/vnd.openxmlformats")
            || mime.starts_with("font/")
            || mime == "application/wasm"
            || mime == "application/java-archive"
            || mime == "application/x-sqlite3";

        if is_binary {
            return Some((true, format!("Magic bytes: {} ({})", ext, mime)));
        }

        // Explicitly known text types (detected by magic but are text)
        let is_text = mime.starts_with("text/")
            || mime == "application/json"
            || mime == "application/xml"
            || mime == "application/javascript"
            || mime == "application/x-sh";

        if is_text {
            return Some((false, format!("Magic bytes: {} ({})", ext, mime)));
        }
    }

    None // Unknown or ambiguous type
}

/// Enhanced binary content check using magic bytes first.
///
/// Detection order:
/// 1. Magic bytes (infer crate) — most reliable
/// 2. SIMD null byte scan (memchr) — fast binary indicator
/// 3. Non-printable character ratio — heuristic fallback
#[command]
pub fn check_binary_content_enhanced(
    content: Vec<u8>,
    sample_size: Option<usize>,
) -> BinaryCheckResult {
    let start = std::time::Instant::now();
    let sample_size = sample_size.unwrap_or(8000);
    let sample = &content[..content.len().min(sample_size)];

    // Step 1: Try magic bytes detection
    if let Some((is_binary, reason)) = is_binary_by_magic_bytes(sample) {
        return BinaryCheckResult {
            is_binary,
            reason,
            processing_time_us: start.elapsed().as_secs_f64() * 1_000_000.0,
        };
    }

    // Step 2: Fall back to existing SIMD + ratio detection
    let is_binary = is_binary_content(&content, sample_size);
    let processing_time_us = start.elapsed().as_secs_f64() * 1_000_000.0;

    let reason = if is_binary {
        if memchr(0, sample).is_some() {
            "Contains null bytes".to_string()
        } else {
            "High proportion of non-printable characters".to_string()
        }
    } else {
        "Text content detected".to_string()
    };

    BinaryCheckResult {
        is_binary,
        reason,
        processing_time_us,
    }
}

/// Enhanced full file check: magic bytes + extension + content
///
/// Uses magic bytes for most reliable detection, then falls back to
/// extension and content analysis.
#[command]
pub async fn check_file_is_binary_enhanced(
    path: String,
    sample_size: Option<usize>,
) -> Result<BinaryCheckResult, String> {
    let start = std::time::Instant::now();
    let sample_size = sample_size.unwrap_or(8000);

    // Read file content (at least enough for magic bytes + sample)
    let content = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let sample = &content[..content.len().min(sample_size)];

    // Step 1: Try magic bytes detection (most reliable)
    if let Some((is_binary, reason)) = is_binary_by_magic_bytes(sample) {
        return Ok(BinaryCheckResult {
            is_binary,
            reason,
            processing_time_us: start.elapsed().as_secs_f64() * 1_000_000.0,
        });
    }

    // Step 2: Extension check
    if let Some(is_binary) = is_binary_by_extension(&path) {
        return Ok(BinaryCheckResult {
            is_binary,
            reason: if is_binary {
                "Binary file extension".to_string()
            } else {
                "Known text file".to_string()
            },
            processing_time_us: start.elapsed().as_secs_f64() * 1_000_000.0,
        });
    }

    // Step 3: Content analysis (null bytes + ratio)
    let is_binary = is_binary_content(&content, sample_size);
    let processing_time_us = start.elapsed().as_secs_f64() * 1_000_000.0;

    let reason = if is_binary {
        if memchr(0, sample).is_some() {
            "Contains null bytes".to_string()
        } else {
            "High proportion of non-printable characters".to_string()
        }
    } else {
        "Text content detected".to_string()
    };

    Ok(BinaryCheckResult {
        is_binary,
        reason,
        processing_time_us,
    })
}

#[cfg(test)]
#[path = "tests/binary_detection_tests.rs"]
mod tests;

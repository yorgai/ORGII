//! Persist chat `data:` URL images under the session images directory with SHA-256 deduplication
//! so repeated identical attachments reuse one on-disk file.

#[cfg(test)]
#[path = "tests/images_tests.rs"]
mod tests;

use base64::Engine;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

/// Decoded components of a `data:` URL.
pub(crate) struct DataUrl<'a> {
    pub(crate) media_type: &'a str,
    pub(crate) payload: &'a str,
}

pub(crate) fn parse_data_url(data_url: &str) -> Option<DataUrl<'_>> {
    let rest = data_url.strip_prefix("data:")?;
    let (header, payload) = rest.split_once(";base64,")?;
    if header.is_empty() || payload.is_empty() {
        return None;
    }
    Some(DataUrl {
        media_type: header,
        payload,
    })
}

pub(crate) fn media_type_to_ext(media_type: &str) -> &str {
    match media_type {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "bin",
    }
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Persist base64 data URL images to disk with content-hash deduplication.
///
/// Returns a `Vec` of absolute file paths (one per successfully persisted image).
/// Images that are already on disk (same content hash) are not re-written.
pub fn persist_images(data_urls: &[String]) -> Vec<String> {
    tracing::info!("[persist_images] called with {} image(s)", data_urls.len());
    for (i, url) in data_urls.iter().enumerate() {
        let preview = url.get(..80).unwrap_or(url);
        tracing::info!("[persist_images] image[{}] prefix: {}", i, preview);
    }

    let dir = app_paths::session_images_dir();
    if let Err(err) = fs::create_dir_all(&dir) {
        tracing::error!("[persist_images] failed to create dir {:?}: {}", dir, err);
        return Vec::new();
    }

    let result: Vec<String> = data_urls
        .iter()
        .enumerate()
        .filter_map(|(i, data_url)| {
            let parsed = match parse_data_url(data_url) {
                Some(p) => p,
                None => {
                    tracing::warn!(
                        "[persist_images] image[{}] is not a data: URL (prefix: {}), skipping",
                        i,
                        data_url.get(..40).unwrap_or(data_url)
                    );
                    return None;
                }
            };
            let bytes = match base64::engine::general_purpose::STANDARD.decode(parsed.payload) {
                Ok(b) => b,
                Err(err) => {
                    tracing::warn!(
                        "[persist_images] image[{}] base64 decode failed: {}",
                        i,
                        err
                    );
                    return None;
                }
            };
            let hash = sha256_hex(&bytes);
            let ext = media_type_to_ext(parsed.media_type);
            let filename = format!("{}.{}", &hash[..16], ext);
            let path = dir.join(&filename);
            if !path.exists() {
                if let Err(err) = fs::write(&path, &bytes) {
                    tracing::warn!("[persist_images] image[{}] write failed: {}", i, err);
                    return None;
                }
            }
            let path_str = path.to_string_lossy().to_string();
            tracing::info!("[persist_images] image[{}] persisted to: {}", i, path_str);
            Some(path_str)
        })
        .collect();

    tracing::info!("[persist_images] result: {} path(s)", result.len());
    result
}

/// Read an image file from disk and reconstruct a base64 data URL.
///
/// Returns `None` if the file doesn't exist or can't be read.
pub fn load_image_as_data_url(path: &str) -> Option<String> {
    let file_path = PathBuf::from(path);
    let bytes = fs::read(&file_path).ok()?;
    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin");
    let media_type = match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:{};base64,{}", media_type, encoded))
}

/// Delete all image files referenced by a list of file paths.
///
/// This is best-effort cleanup — paths that don't exist (already
/// removed) are silently ignored, but any other failure is logged
/// at `debug` so a real permission/FS issue is at least diagnosable
/// when the user reports stale image files lingering on disk.
pub fn delete_image_files(paths: &[String]) {
    for path in paths {
        if let Err(err) = fs::remove_file(path) {
            if err.kind() != std::io::ErrorKind::NotFound {
                tracing::debug!(
                    path = %path,
                    error = %err,
                    "delete_image_files: failed to remove image; leaving on disk"
                );
            }
        }
    }
}

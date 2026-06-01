//! Screenshot Storage
//!
//! Extracted from `browser::screenshot_store` to resolve circular dependencies.
//! Screenshot store with in-memory FIFO cache + disk persistence.

use std::collections::VecDeque;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;

/// FIFO cap on the in-memory entry deque. Promoted from `pub(crate)`
/// to `pub` because `app`'s integration tests assert eviction behavior
/// at this exact boundary.
pub const MAX_ENTRIES: usize = 20;
pub const MAX_MEMORY_BYTES: usize = 32 * 1024 * 1024;

/// A single stored screenshot.
pub struct ScreenshotEntry {
    pub id: String,
    pub url: String,
    pub jpeg_bytes: Vec<u8>,
    pub timestamp_ms: u64,
}

/// Thread-safe, bounded screenshot store with disk persistence.
/// This was moved from `browser::screenshot_store` to resolve circular dependencies.
pub struct ScreenshotStore {
    entries: Mutex<VecDeque<ScreenshotEntry>>,
    disk_dir: PathBuf,
}

impl Default for ScreenshotStore {
    fn default() -> Self {
        Self::new()
    }
}

impl ScreenshotStore {
    /// Create a store that persists to the default `~/.orgii/screenshots/`.
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(VecDeque::with_capacity(MAX_ENTRIES)),
            disk_dir: app_paths::screenshots_dir(),
        }
    }

    /// Create a store with a custom disk directory. Used by `app`'s
    /// integration tests to redirect persistence at a `tempfile::TempDir`
    /// instead of `~/.orgii/screenshots`. Was `#[cfg(test)]` before the
    /// workspace split; the gate fired on this crate's own tests only,
    /// so the parent crate's tests couldn't see it. Always-available now.
    pub fn with_dir(dir: PathBuf) -> Self {
        Self {
            entries: Mutex::new(VecDeque::with_capacity(MAX_ENTRIES)),
            disk_dir: dir,
        }
    }

    fn disk_path(&self, id: &str) -> PathBuf {
        self.disk_dir.join(format!("{}.jpg", id))
    }

    fn prune_memory_entries(entries: &mut VecDeque<ScreenshotEntry>) {
        let mut total_bytes = entries
            .iter()
            .map(|entry| entry.jpeg_bytes.len())
            .sum::<usize>();
        while entries.len() > MAX_ENTRIES || total_bytes > MAX_MEMORY_BYTES {
            let Some(removed) = entries.pop_front() else {
                break;
            };
            total_bytes = total_bytes.saturating_sub(removed.jpeg_bytes.len());
        }
    }

    /// Store a screenshot and return its ID.
    ///
    /// `jpeg_bytes` should already be JPEG-encoded.
    /// Writes to both memory (FIFO-evicted) and disk (permanent).
    pub fn store(&self, jpeg_bytes: Vec<u8>, url: &str) -> String {
        let id = uuid::Uuid::new_v4().to_string()[..8].to_string();
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        if fs::create_dir_all(&self.disk_dir).is_ok() {
            let _ = fs::write(self.disk_path(&id), &jpeg_bytes);
        }

        let entry = ScreenshotEntry {
            id: id.clone(),
            url: url.to_string(),
            jpeg_bytes,
            timestamp_ms,
        };

        let mut entries = self.entries.lock().unwrap();
        entries.push_back(entry);
        Self::prune_memory_entries(&mut entries);

        id
    }

    /// Store raw image bytes with a specific MIME type and return its ID.
    ///
    /// Unlike `store()` which assumes JPEG, this preserves the original format
    /// in the data URI via the `mime` field on the entry.
    pub fn store_with_mime(&self, bytes: Vec<u8>, mime: &str, label: &str) -> String {
        let id = uuid::Uuid::new_v4().to_string()[..8].to_string();
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        if fs::create_dir_all(&self.disk_dir).is_ok() {
            let _ = fs::write(self.disk_path(&id), &bytes);
            let _ = fs::write(self.disk_dir.join(format!("{}.mime", id)), mime.as_bytes());
        }

        let entry = ScreenshotEntry {
            id: id.clone(),
            url: label.to_string(),
            jpeg_bytes: bytes,
            timestamp_ms,
        };

        let mut entries = self.entries.lock().unwrap();
        entries.push_back(entry);
        Self::prune_memory_entries(&mut entries);

        id
    }

    /// Retrieve a screenshot as a data URI, reading MIME type from `.mime` sidecar if available.
    pub fn get_as_typed_data_uri(&self, id: &str) -> Option<String> {
        self.get(id).map(|(bytes, _, _)| {
            let mime = fs::read_to_string(self.disk_dir.join(format!("{}.mime", id)))
                .unwrap_or_else(|_| "image/jpeg".to_string());
            let b64 = BASE64.encode(&bytes);
            format!("data:{};base64,{}", mime, b64)
        })
    }

    /// Retrieve a screenshot entry by ID.
    /// Falls back to disk if not in memory.
    pub fn get(&self, id: &str) -> Option<(Vec<u8>, String, u64)> {
        {
            let entries = self.entries.lock().unwrap();
            if let Some(entry) = entries.iter().find(|entry| entry.id == id) {
                return Some((
                    entry.jpeg_bytes.clone(),
                    entry.url.clone(),
                    entry.timestamp_ms,
                ));
            }
        }

        let bytes = fs::read(self.disk_path(id)).ok()?;
        Some((bytes, String::new(), 0))
    }

    /// Retrieve a screenshot as a base64-encoded data URI string.
    pub fn get_as_data_uri(&self, id: &str) -> Option<String> {
        self.get(id).map(|(bytes, _, _)| {
            let b64 = BASE64.encode(&bytes);
            format!("data:image/jpeg;base64,{}", b64)
        })
    }
}

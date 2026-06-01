//! Per-LspTool document version bookkeeping.
//!
//! `textDocument/didChange` notifications must carry monotonically
//! increasing `version` numbers per (language, uri) pair — rust-analyzer,
//! pyright, and most other servers will reject (or worse, silently
//! desynchronise) on a non-increasing version. The tracker assigns the
//! next version on demand and resets the counter when a server is
//! (re)started, since LSP servers reset their own document version
//! counter on `didOpen`.

use std::collections::HashMap;

use tokio::sync::Mutex;

#[derive(Default)]
pub(super) struct DocumentVersionTracker {
    // Outer key: LSP language id. Inner key: file URI. Value: last version
    // we sent for that (language, uri) pair.
    versions: Mutex<HashMap<String, HashMap<String, i32>>>,
}

impl DocumentVersionTracker {
    pub(super) fn new() -> Self {
        Self::default()
    }

    /// Returns the next version to use for a `did_open` / `did_change` on
    /// `(language, uri)`. The first call for a fresh pair returns `1`,
    /// matching LSP convention that `did_open` opens at version 1.
    pub(super) async fn next(&self, language: &str, uri: &str) -> i32 {
        let mut versions = self.versions.lock().await;
        let language_versions = versions.entry(language.to_string()).or_default();
        let next_version = language_versions.get(uri).copied().unwrap_or(0) + 1;
        language_versions.insert(uri.to_string(), next_version);
        next_version
    }

    /// Drop all version state for `language`. Called after the manager
    /// (re)starts the server for that language — the server will be back
    /// at version 0 for every URI, and our next call must therefore hand
    /// out version 1.
    pub(super) async fn reset(&self, language: &str) {
        let mut versions = self.versions.lock().await;
        versions.remove(language);
    }
}

#[cfg(test)]
mod tests {
    use super::DocumentVersionTracker;

    #[tokio::test]
    async fn first_version_is_one() {
        let tracker = DocumentVersionTracker::new();
        assert_eq!(tracker.next("rust", "file:///foo.rs").await, 1);
    }

    #[tokio::test]
    async fn versions_are_strictly_monotonic() {
        let tracker = DocumentVersionTracker::new();
        let uri = "file:///foo.rs";
        let mut last = 0;
        for _ in 0..50 {
            let version = tracker.next("rust", uri).await;
            assert!(
                version > last,
                "version must strictly increase: got {} after {}",
                version,
                last
            );
            last = version;
        }
    }

    #[tokio::test]
    async fn versions_are_independent_per_uri() {
        let tracker = DocumentVersionTracker::new();
        let foo = "file:///foo.rs";
        let bar = "file:///bar.rs";

        assert_eq!(tracker.next("rust", foo).await, 1);
        assert_eq!(tracker.next("rust", foo).await, 2);
        // bar starts fresh, not from foo's counter.
        assert_eq!(tracker.next("rust", bar).await, 1);
        assert_eq!(tracker.next("rust", foo).await, 3);
    }

    #[tokio::test]
    async fn versions_are_independent_per_language() {
        let tracker = DocumentVersionTracker::new();
        let uri = "file:///foo.rs";

        assert_eq!(tracker.next("rust", uri).await, 1);
        assert_eq!(tracker.next("rust", uri).await, 2);
        // Different language id with the same URI must not share the
        // counter — different servers, different sessions.
        assert_eq!(tracker.next("typescript", uri).await, 1);
        assert_eq!(tracker.next("rust", uri).await, 3);
    }

    #[tokio::test]
    async fn reset_drops_all_uris_for_language() {
        let tracker = DocumentVersionTracker::new();
        tracker.next("rust", "file:///foo.rs").await;
        tracker.next("rust", "file:///bar.rs").await;
        tracker.next("rust", "file:///foo.rs").await; // foo is at 2

        tracker.reset("rust").await;

        // Both URIs reset to 1 after reset — server restarted, version
        // counter on the server side is back at 0.
        assert_eq!(tracker.next("rust", "file:///foo.rs").await, 1);
        assert_eq!(tracker.next("rust", "file:///bar.rs").await, 1);
    }

    #[tokio::test]
    async fn reset_only_drops_target_language() {
        let tracker = DocumentVersionTracker::new();
        tracker.next("rust", "file:///foo.rs").await;
        tracker.next("typescript", "file:///bar.ts").await;
        tracker.next("typescript", "file:///bar.ts").await; // ts at 2

        tracker.reset("rust").await;

        // typescript untouched.
        assert_eq!(tracker.next("typescript", "file:///bar.ts").await, 3);
        // rust reset.
        assert_eq!(tracker.next("rust", "file:///foo.rs").await, 1);
    }

    #[tokio::test]
    async fn reset_on_unknown_language_is_noop() {
        let tracker = DocumentVersionTracker::new();
        tracker.next("rust", "file:///foo.rs").await;
        tracker.reset("never-seen").await;
        // rust counter intact.
        assert_eq!(tracker.next("rust", "file:///foo.rs").await, 2);
    }
}

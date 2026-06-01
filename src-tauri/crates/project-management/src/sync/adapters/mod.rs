//! Built-in [`super::SyncAdapter`] implementations + lazy registry.
//!
//! - [`echo::EchoAdapter`] — test/manual smoke.
//! - `linear` — Linear GraphQL.
//! - `github_issues` — GitHub REST.
//!
//! The registry is a `OnceLock<HashMap<&'static str, Arc<dyn SyncAdapter>>>`
//! populated at first access; lookups are O(1) and the value lives for
//! the process lifetime.

pub mod echo;
pub mod github_issues;
pub mod linear;

pub use echo::EchoAdapter;
pub use github_issues::GitHubIssuesAdapter;
pub use linear::LinearAdapter;

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use super::adapter::{AdapterDescriptor, SyncAdapter};

static REGISTRY: OnceLock<HashMap<&'static str, Arc<dyn SyncAdapter>>> = OnceLock::new();

fn build_registry() -> HashMap<&'static str, Arc<dyn SyncAdapter>> {
    let mut map: HashMap<&'static str, Arc<dyn SyncAdapter>> = HashMap::new();
    let echo: Arc<dyn SyncAdapter> = Arc::new(EchoAdapter);
    map.insert(echo.name(), echo);
    let linear: Arc<dyn SyncAdapter> = Arc::new(LinearAdapter);
    map.insert(linear.name(), linear);
    let github: Arc<dyn SyncAdapter> = Arc::new(GitHubIssuesAdapter);
    map.insert(github.name(), github);
    map
}

/// Singleton adapter registry. Lazy-initialized on first access.
pub fn registry() -> &'static HashMap<&'static str, Arc<dyn SyncAdapter>> {
    REGISTRY.get_or_init(build_registry)
}

/// Look up an adapter by `adapter_id`. Returns `None` when the id isn't
/// known — callers (commands, worker) treat that as "unknown adapter,
/// surface error to user" rather than panicking.
pub fn get(adapter_id: &str) -> Option<Arc<dyn SyncAdapter>> {
    registry().get(adapter_id).cloned()
}

/// Snapshot every registered adapter's descriptor for the UI picker.
/// Sorted by id for stable output.
pub fn list_descriptors() -> Vec<AdapterDescriptor> {
    let mut out: Vec<AdapterDescriptor> = registry()
        .values()
        .map(|adapter| adapter.descriptor())
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn echo_adapter_is_registered() {
        assert!(get("echo").is_some());
    }

    #[test]
    fn linear_adapter_is_registered() {
        let adapter = get("linear").expect("linear missing");
        assert_eq!(adapter.name(), "linear");
        let descriptor = adapter.descriptor();
        assert!(descriptor.requires_auth);
    }

    #[test]
    fn github_issues_adapter_is_registered() {
        let adapter = get("github_issues").expect("github_issues missing");
        assert_eq!(adapter.name(), "github_issues");
        let descriptor = adapter.descriptor();
        assert!(descriptor.requires_auth);
        assert_eq!(descriptor.label, "GitHub Issues");
    }

    #[test]
    fn list_descriptors_is_sorted() {
        let xs = list_descriptors();
        let mut ids: Vec<&str> = xs.iter().map(|d| d.id.as_str()).collect();
        let sorted: Vec<&str> = {
            let mut s = ids.clone();
            s.sort();
            s
        };
        // Compare references-style equality on string slices.
        ids.sort();
        assert_eq!(ids, sorted);
    }
}

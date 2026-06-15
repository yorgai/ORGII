//! LRU cache for recent search results.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::num::NonZeroUsize;
use std::sync::RwLock;

use lru::LruCache;
use tracing::info;

use super::types::CodeSearchResult;

/// Cache key for search results.
#[derive(Clone, Eq, PartialEq, Hash)]
pub(super) struct SearchCacheKey {
    query: String,
    repo_path: String,
    case_sensitive: bool,
    use_regex: bool,
    max_results: usize,
}

impl SearchCacheKey {
    pub(super) fn new(query: &str, repo_path: &str, filters: &super::types::SearchFilters) -> Self {
        Self {
            query: query.to_string(),
            repo_path: repo_path.to_string(),
            case_sensitive: filters.case_sensitive.unwrap_or(false),
            use_regex: filters.use_regex.unwrap_or(false),
            max_results: filters.max_results.unwrap_or(10000),
        }
    }

    pub(super) fn hash_key(&self) -> u64 {
        let mut hasher = DefaultHasher::new();
        self.hash(&mut hasher);
        hasher.finish()
    }
}

/// Cached search result.
#[derive(Clone)]
pub(super) struct CachedSearchResult {
    pub(super) results: Vec<CodeSearchResult>,
    pub(super) total_matches: usize,
    pub(super) total_files: usize,
    pub(super) limit_hit: bool,
    pub(super) cached_at: std::time::Instant,
}

/// LRU cache for recent search results (max 20 entries).
static SEARCH_CACHE: std::sync::LazyLock<RwLock<LruCache<u64, CachedSearchResult>>> =
    std::sync::LazyLock::new(|| RwLock::new(LruCache::new(NonZeroUsize::new(20).unwrap())));

/// Check if a search result is cached and still valid (5 minute TTL).
pub(super) fn get_cached_result(key: &SearchCacheKey) -> Option<CachedSearchResult> {
    let hash = key.hash_key();
    let cache = SEARCH_CACHE.read().unwrap();
    if let Some(cached) = cache.peek(&hash) {
        if cached.cached_at.elapsed().as_secs() < 300 {
            return Some(cached.clone());
        }
    }
    None
}

/// Store a search result in the cache.
pub(super) fn cache_result(
    key: &SearchCacheKey,
    results: Vec<CodeSearchResult>,
    total_matches: usize,
    total_files: usize,
    limit_hit: bool,
) {
    let hash = key.hash_key();
    let cached = CachedSearchResult {
        results,
        total_matches,
        total_files,
        limit_hit,
        cached_at: std::time::Instant::now(),
    };
    SEARCH_CACHE.write().unwrap().put(hash, cached);
}

/// Clear the search cache (called when files change).
#[tauri::command]
pub fn clear_search_cache() {
    SEARCH_CACHE.write().unwrap().clear();
    info!("search::cache: cache cleared");
}

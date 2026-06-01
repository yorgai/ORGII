use std::collections::HashMap;
use std::hash::Hash;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug)]
struct SwrEntry<Value> {
    value: Option<Value>,
    updated_at: Option<Instant>,
    refreshing: bool,
}

impl<Value> Default for SwrEntry<Value> {
    fn default() -> Self {
        Self {
            value: None,
            updated_at: None,
            refreshing: false,
        }
    }
}

#[derive(Debug)]
pub struct SwrCache<Key, Value> {
    entries: Mutex<HashMap<Key, SwrEntry<Value>>>,
    changed: Condvar,
}

impl<Key, Value> Default for SwrCache<Key, Value> {
    fn default() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            changed: Condvar::new(),
        }
    }
}

impl<Key, Value> SwrCache<Key, Value>
where
    Key: Clone + Eq + Hash + Send + 'static,
    Value: Clone + Send + 'static,
{
    pub fn get_or_refresh<F>(
        self: &Arc<Self>,
        key: Key,
        ttl: Duration,
        refresh: F,
    ) -> Result<Value, String>
    where
        F: Fn() -> Result<Value, String> + Send + 'static,
    {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "SWR cache lock poisoned".to_string())?;

        loop {
            let entry = entries.entry(key.clone()).or_default();
            if let (Some(value), Some(updated_at)) = (&entry.value, entry.updated_at) {
                if updated_at.elapsed() <= ttl {
                    return Ok(value.clone());
                }

                let stale_value = value.clone();
                if !entry.refreshing {
                    entry.refreshing = true;
                    self.spawn_refresh(key.clone(), refresh);
                }
                return Ok(stale_value);
            }

            if !entry.refreshing {
                entry.refreshing = true;
                break;
            }

            entries = self
                .changed
                .wait(entries)
                .map_err(|_| "SWR cache lock poisoned".to_string())?;
        }

        drop(entries);
        let refreshed = refresh();
        self.finish_refresh(key, refreshed.clone());
        refreshed
    }

    fn spawn_refresh<F>(self: &Arc<Self>, key: Key, refresh: F)
    where
        F: Fn() -> Result<Value, String> + Send + 'static,
    {
        let cache = Arc::clone(self);
        std::thread::spawn(move || {
            let refreshed = refresh();
            cache.finish_refresh(key, refreshed);
        });
    }

    /// Evict a cached entry so the next `get_or_refresh` call does a
    /// synchronous refresh instead of returning a stale value.
    pub fn invalidate(&self, key: &Key) {
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };
        entries.remove(key);
        self.changed.notify_all();
    }

    /// Evict all cached entries.
    pub fn clear(&self) {
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };
        entries.clear();
        self.changed.notify_all();
    }

    fn finish_refresh(&self, key: Key, refreshed: Result<Value, String>) {
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };
        let entry = entries.entry(key).or_default();
        if let Ok(value) = refreshed {
            entry.value = Some(value);
            entry.updated_at = Some(Instant::now());
        }
        entry.refreshing = false;
        self.changed.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn returns_stale_while_refreshing_in_background() {
        let cache: Arc<SwrCache<String, String>> = Arc::default();
        let calls = Arc::new(AtomicUsize::new(0));
        let key = "k".to_string();

        let first_calls = Arc::clone(&calls);
        let first = cache
            .get_or_refresh(key.clone(), Duration::from_millis(1), move || {
                first_calls.fetch_add(1, Ordering::SeqCst);
                Ok("first".to_string())
            })
            .unwrap();
        assert_eq!(first, "first");

        std::thread::sleep(Duration::from_millis(2));
        let second_calls = Arc::clone(&calls);
        let second = cache
            .get_or_refresh(key, Duration::from_millis(1), move || {
                second_calls.fetch_add(1, Ordering::SeqCst);
                Ok("second".to_string())
            })
            .unwrap();
        assert_eq!(second, "first");

        for _ in 0..20 {
            if calls.load(Ordering::SeqCst) >= 2 {
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        panic!("background refresh did not run");
    }
}

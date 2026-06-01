use crate::screenshot_store::ScreenshotStore;
use shared_state::screenshot_state::MAX_ENTRIES;

fn temp_store() -> (ScreenshotStore, tempfile::TempDir) {
    let dir = tempfile::tempdir().expect("create temp dir");
    let store = ScreenshotStore::with_dir(dir.path().to_path_buf());
    (store, dir)
}

#[test]
fn new_store_is_empty() {
    let (store, _dir) = temp_store();
    assert!(store.get("anything").is_none());
}

#[test]
fn store_returns_8_char_id() {
    let (store, _dir) = temp_store();
    let id = store.store(vec![0xFF, 0xD8], "https://example.com");
    assert_eq!(id.len(), 8);
    assert!(!id.is_empty());
}

#[test]
fn get_returns_correct_data() {
    let (store, _dir) = temp_store();
    let bytes = vec![0xFF, 0xD8, 0xFF, 0xE0];
    let url = "https://example.com/page";

    let id = store.store(bytes.clone(), url);
    let (returned_bytes, returned_url, timestamp) = store.get(&id).expect("entry should exist");

    assert_eq!(returned_bytes, bytes);
    assert_eq!(returned_url, url);
    assert!(
        timestamp > 0,
        "timestamp should be a positive epoch ms value"
    );
}

#[test]
fn get_as_data_uri_returns_base64_format() {
    let (store, _dir) = temp_store();
    let bytes = vec![0xFF, 0xD8, 0xFF, 0xE0];
    let id = store.store(bytes, "https://example.com");

    let data_uri = store.get_as_data_uri(&id).expect("entry should exist");
    assert!(
        data_uri.starts_with("data:image/jpeg;base64,"),
        "data URI should start with the JPEG base64 prefix, got: {}",
        &data_uri[..40.min(data_uri.len())]
    );

    let b64_part = data_uri.strip_prefix("data:image/jpeg;base64,").unwrap();
    assert!(!b64_part.is_empty(), "base64 payload should not be empty");
}

#[test]
fn evicted_entries_survive_on_disk() {
    let (store, _dir) = temp_store();
    let mut ids = Vec::new();

    for idx in 0..=MAX_ENTRIES {
        let id = store.store(vec![idx as u8], &format!("https://example.com/{}", idx));
        ids.push(id);
    }

    // First entry is evicted from memory but still readable from disk
    let (bytes, _url, _ts) = store
        .get(&ids[0])
        .expect("evicted entry should be recovered from disk");
    assert_eq!(bytes, vec![0u8]);

    for id in &ids[1..] {
        assert!(store.get(id).is_some(), "entry {} should still exist", id);
    }
}

#[test]
fn disk_persistence_survives_new_store() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let id;
    let bytes = vec![0xFF, 0xD8, 0xFF, 0xE0];

    {
        let store = ScreenshotStore::with_dir(dir.path().to_path_buf());
        id = store.store(bytes.clone(), "https://example.com");
    }

    // New store instance reads from the same disk dir
    let store2 = ScreenshotStore::with_dir(dir.path().to_path_buf());
    let (returned_bytes, _, _) = store2
        .get(&id)
        .expect("should load from disk after memory is gone");
    assert_eq!(returned_bytes, bytes);
}

#[test]
fn get_with_invalid_id_returns_none() {
    let (store, _dir) = temp_store();
    store.store(vec![1, 2, 3], "https://example.com");

    assert!(store.get("nonexist").is_none());
    assert!(store.get("").is_none());
    assert!(store.get_as_data_uri("nonexist").is_none());
}

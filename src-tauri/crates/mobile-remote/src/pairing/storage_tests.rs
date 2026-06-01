use super::*;
use tempfile::TempDir;

fn record(device_id: &str) -> PairedDeviceRecord {
    PairedDeviceRecord {
        device_id: device_id.into(),
        desktop_id: "desktop-test".into(),
        label: format!("Phone {device_id}"),
        tier: PermissionTier::Full,
        is_primary: false,
        paired_at_ms: 1_700_000_000_000,
        last_seen_ms: None,
        device_pubkey_fingerprint: "deadbeef".into(),
    }
}

#[test]
fn missing_file_is_empty_list() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("paired_devices.json");
    let loaded = load_at(&path).expect("load");
    assert!(loaded.is_empty());
}

#[test]
fn save_then_load_round_trips() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("paired_devices.json");

    let records = vec![record("dev-1"), record("dev-2")];
    save_at(&path, &records).expect("save");

    let loaded = load_at(&path).expect("load");
    assert_eq!(loaded, records);
}

#[test]
fn add_appends_new_device() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("paired_devices.json");

    add_at(&path, record("dev-1")).expect("add 1");
    add_at(&path, record("dev-2")).expect("add 2");

    let loaded = load_at(&path).expect("load");
    assert_eq!(loaded.len(), 2);
}

#[test]
fn add_upserts_existing_device() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("paired_devices.json");

    add_at(&path, record("dev-1")).expect("add");
    let mut updated = record("dev-1");
    updated.label = "renamed".into();
    add_at(&path, updated.clone()).expect("upsert");

    let loaded = load_at(&path).expect("load");
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].label, "renamed");
}

#[test]
fn remove_deletes_existing() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("paired_devices.json");

    add_at(&path, record("dev-1")).expect("add 1");
    add_at(&path, record("dev-2")).expect("add 2");

    let removed = remove_at(&path, "dev-1").expect("remove");
    assert!(removed);

    let loaded = load_at(&path).expect("load");
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].device_id, "dev-2");
}

#[test]
fn remove_missing_is_noop() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("paired_devices.json");

    add_at(&path, record("dev-1")).expect("add");
    let removed = remove_at(&path, "dev-other").expect("remove");
    assert!(!removed);

    let loaded = load_at(&path).expect("load");
    assert_eq!(loaded.len(), 1);
}

#[test]
fn save_overwrites_via_atomic_rename() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("paired_devices.json");

    save_at(&path, &[record("dev-1")]).expect("save 1");
    save_at(&path, &[record("dev-2")]).expect("save 2");

    let loaded = load_at(&path).expect("load");
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].device_id, "dev-2");
    // Tempfile must not linger.
    let tmp = path.with_extension("json.tmp");
    assert!(!tmp.exists(), "tmp file should be renamed away");
}

#[test]
fn empty_file_loads_as_empty() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("paired_devices.json");
    std::fs::write(&path, "").expect("write empty");
    let loaded = load_at(&path).expect("load");
    assert!(loaded.is_empty());
}

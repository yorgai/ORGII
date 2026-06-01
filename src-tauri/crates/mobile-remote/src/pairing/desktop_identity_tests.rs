use super::*;
use tempfile::TempDir;

#[test]
fn read_or_create_round_trips() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("desktop_id.txt");

    let first = read_or_create_at(&path).expect("first call");
    let second = read_or_create_at(&path).expect("second call");

    assert_eq!(
        first, second,
        "second call must read back the same UUID it wrote on first"
    );
    assert!(
        first.as_str().starts_with("desktop-"),
        "expected desktop- prefix, got {}",
        first
    );
}

#[test]
fn read_or_create_creates_parent_dir() {
    let dir = TempDir::new().expect("tempdir");
    let nested = dir
        .path()
        .join("nested")
        .join("more")
        .join("desktop_id.txt");
    assert!(!nested.exists());
    let id = read_or_create_at(&nested).expect("create");
    assert!(nested.exists(), "file should now exist");
    assert_eq!(
        std::fs::read_to_string(&nested).expect("read").trim(),
        id.as_str()
    );
}

#[test]
fn empty_file_is_replaced() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("desktop_id.txt");
    std::fs::write(&path, "").expect("write empty");
    let id = read_or_create_at(&path).expect("read empty");
    assert!(!id.as_str().is_empty(), "empty file should be regenerated");
    assert!(id.as_str().starts_with("desktop-"));
}

#[test]
fn placeholder_fingerprint_is_deterministic() {
    let id = DesktopId::new("desktop-abc");
    let one = placeholder_fingerprint(&id);
    let two = placeholder_fingerprint(&id);
    assert_eq!(one, two);
    assert_eq!(one.len(), 64, "SHA-256 hex = 64 chars");
}

#[test]
fn placeholder_fingerprint_varies_with_desktop_id() {
    let a = placeholder_fingerprint(&DesktopId::new("desktop-a"));
    let b = placeholder_fingerprint(&DesktopId::new("desktop-b"));
    assert_ne!(a, b);
}

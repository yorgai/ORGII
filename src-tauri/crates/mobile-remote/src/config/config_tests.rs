use super::*;
use std::sync::Mutex;

// The static `RELAY_URL` is process-global, so tests that mutate it must
// not run concurrently. A serializing mutex keeps `cargo test` correct
// even with `--test-threads >= 2`.
static SERIALIZE: Mutex<()> = Mutex::new(());

#[test]
fn default_is_bundled_url() {
    let _guard = SERIALIZE.lock().unwrap_or_else(|err| err.into_inner());
    reset_for_test();
    let cfg = get_relay_url();
    assert_eq!(cfg.url, DEFAULT_RELAY_URL);
    assert!(cfg.is_default);
}

#[test]
fn set_overrides_and_marks_non_default() {
    let _guard = SERIALIZE.lock().unwrap_or_else(|err| err.into_inner());
    reset_for_test();
    let cfg = set_relay_url("https://example.test".into());
    assert_eq!(cfg.url, "https://example.test");
    assert!(!cfg.is_default);

    let cfg = get_relay_url();
    assert_eq!(cfg.url, "https://example.test");
    assert!(!cfg.is_default);
}

#[test]
fn empty_resets_to_default() {
    let _guard = SERIALIZE.lock().unwrap_or_else(|err| err.into_inner());
    reset_for_test();
    set_relay_url("https://example.test".into());
    let cfg = set_relay_url("".into());
    assert_eq!(cfg.url, DEFAULT_RELAY_URL);
    assert!(cfg.is_default);
}

#[test]
fn setting_default_url_explicitly_marks_default() {
    let _guard = SERIALIZE.lock().unwrap_or_else(|err| err.into_inner());
    reset_for_test();
    let cfg = set_relay_url(DEFAULT_RELAY_URL.into());
    assert!(cfg.is_default);
}

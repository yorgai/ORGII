use super::*;

#[test]
fn default_listen_addr_is_loopback_7878() {
    let cfg = AppConfig::default();
    assert_eq!(cfg.listen_addr.to_string(), "127.0.0.1:7878");
    assert!(
        cfg.listen_addr.ip().is_loopback(),
        "default bind must be loopback until pairing/auth is wired",
    );
}

#[test]
fn default_storage_path_is_relative() {
    let cfg = AppConfig::default();
    assert_eq!(cfg.storage_path, PathBuf::from("orgii-relay.db"));
    assert!(
        cfg.storage_path.is_relative(),
        "default storage path must be relative so cargo run works",
    );
}

#[test]
fn default_log_level_is_info() {
    let cfg = AppConfig::default();
    assert_eq!(cfg.log_level, "info");
}

#[test]
fn config_is_clonable() {
    let cfg = AppConfig::default();
    let cloned = cfg.clone();
    assert_eq!(cfg.listen_addr, cloned.listen_addr);
    assert_eq!(cfg.storage_path, cloned.storage_path);
    assert_eq!(cfg.log_level, cloned.log_level);
}

use crate::process_metrics::*;

#[test]
fn test_get_process_metrics() {
    let metrics = get_process_metrics();

    // Should have valid PID
    assert!(metrics.pid > 0);

    // Memory should be positive
    assert!(metrics.memory_rss_mb > 0.0);

    // Name should not be empty
    assert!(!metrics.name.is_empty());
}

#[test]
fn test_get_memory_usage() {
    let metrics = get_memory_usage();
    assert!(metrics.rss_mb > 0.0);
}

#[test]
fn test_get_system_memory() {
    let metrics = get_system_memory();
    assert!(metrics.total_mb >= 0.0);
    assert!(metrics.available_mb >= 0.0);
    assert!(metrics.used_mb >= 0.0);
}

#[test]
fn test_get_memory_breakdown() {
    let breakdown = get_memory_breakdown();
    assert!(breakdown.backend_rss_mb > 0.0);
    assert!(breakdown.tracked_backend_mb >= 0.0);
    assert!(breakdown.file_cache_mb >= 0.0);
}

#[cfg(target_os = "macos")]
#[test]
fn test_macos_webkit_xpc_first_group_window() {
    let first_webkit_start_time = 1_000;

    assert!(is_macos_webkit_xpc_in_first_group(
        first_webkit_start_time,
        first_webkit_start_time
    ));
    assert!(is_macos_webkit_xpc_in_first_group(
        first_webkit_start_time,
        first_webkit_start_time + MACOS_WEBKIT_XPC_GROUP_WINDOW_SECS
    ));
    assert!(!is_macos_webkit_xpc_in_first_group(
        first_webkit_start_time,
        first_webkit_start_time - 1
    ));
    assert!(!is_macos_webkit_xpc_in_first_group(
        first_webkit_start_time,
        first_webkit_start_time + MACOS_WEBKIT_XPC_GROUP_WINDOW_SECS + 1
    ));
    assert!(!is_macos_webkit_xpc_in_first_group(
        0,
        first_webkit_start_time
    ));
}

//! Frontend log persistence.
//!
//! Receives log messages from the frontend via Tauri IPC and writes them
//! to `~/.orgii/logs/frontend.log` with daily rotation, using a non-blocking
//! writer so the IPC call returns immediately.

use std::io::Write;
use std::sync::{LazyLock, Mutex};
use tracing_appender::non_blocking::NonBlocking;

static FRONTEND_LOG: LazyLock<Mutex<NonBlocking>> = LazyLock::new(|| {
    let log_dir = app_paths::logs_dir();
    std::fs::create_dir_all(&log_dir).ok();
    let file_appender = tracing_appender::rolling::daily(log_dir, "frontend.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    std::mem::forget(guard);
    Mutex::new(non_blocking)
});

#[tauri::command]
pub fn write_frontend_log(level: String, namespace: String, message: String) {
    let timestamp = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.3f");
    let line = format!(
        "{} [{}] [{}] {}\n",
        timestamp,
        level.to_uppercase(),
        namespace,
        message
    );

    if let Ok(mut writer) = FRONTEND_LOG.lock() {
        let _ = writer.write_all(line.as_bytes());
    }
}

#[tauri::command]
pub fn get_logs_directory() -> String {
    app_paths::logs_dir().to_string_lossy().to_string()
}

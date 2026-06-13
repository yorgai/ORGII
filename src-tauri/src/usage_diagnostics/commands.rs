use super::service::DiagnosticsService;
use super::types::{
    DiagnosticsFlushStatus, DiagnosticsQueueRecord, DiagnosticsServiceConfig,
    DiagnosticsUsageSnapshot,
};

#[tauri::command]
pub async fn diagnostics_start(config: DiagnosticsServiceConfig) -> Result<(), String> {
    DiagnosticsService::global().start(config).await
}

#[tauri::command]
pub async fn diagnostics_configure(config: DiagnosticsServiceConfig) -> Result<(), String> {
    DiagnosticsService::global().configure(config).await;
    Ok(())
}

#[tauri::command]
pub async fn diagnostics_flush_now() -> Result<DiagnosticsFlushStatus, String> {
    DiagnosticsService::global().flush_now().await
}

#[tauri::command]
pub async fn diagnostics_record_usage_snapshot(
    snapshot: DiagnosticsUsageSnapshot,
) -> Result<DiagnosticsQueueRecord, String> {
    DiagnosticsService::global()
        .record_usage_snapshot(snapshot)
        .await
}

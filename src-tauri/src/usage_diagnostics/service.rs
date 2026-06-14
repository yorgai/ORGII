use std::sync::{Arc, OnceLock};
use std::time::Duration;

use tokio::sync::RwLock;

use super::queue::{
    enqueue_snapshot, ensure_install_id, now_rfc3339, read_unsent_records, unsent_count,
    DiagnosticsPaths,
};
use super::sanitize::{bucket_cpu_percent, bucket_duration_ms, bucket_ram_mb, sanitize_snapshot};
use super::types::{
    DiagnosticsFlushStatus, DiagnosticsLevel, DiagnosticsQueueRecord, DiagnosticsServiceConfig,
    DiagnosticsUploadPayload, DiagnosticsUsageSnapshot, DIAGNOSTICS_SCHEMA_VERSION,
};

const ENDPOINT_ENV: &str = "ORGII_DIAGNOSTICS_ENDPOINT";
const USER_AGENT: &str = "ORGII Diagnostics";

static GLOBAL_SERVICE: OnceLock<Arc<DiagnosticsService>> = OnceLock::new();

#[derive(Debug)]
pub struct DiagnosticsService {
    paths: DiagnosticsPaths,
    config: RwLock<DiagnosticsServiceConfig>,
    install_id: RwLock<Option<String>>,
    scheduler_started: OnceLock<()>,
}

impl DiagnosticsService {
    pub fn global() -> Arc<Self> {
        GLOBAL_SERVICE
            .get_or_init(|| {
                Arc::new(Self {
                    paths: DiagnosticsPaths::new(app_paths::diagnostics_dir()),
                    config: RwLock::new(DiagnosticsServiceConfig::default()),
                    install_id: RwLock::new(None),
                    scheduler_started: OnceLock::new(),
                })
            })
            .clone()
    }

    pub async fn start(self: Arc<Self>, config: DiagnosticsServiceConfig) -> Result<(), String> {
        self.configure(config).await;
        self.ensure_install_id().await?;
        self.start_scheduler();
        Ok(())
    }

    pub async fn configure(&self, config: DiagnosticsServiceConfig) {
        let mut guard = self.config.write().await;
        *guard = config.normalized();
    }

    pub async fn record_usage_snapshot(
        &self,
        snapshot: DiagnosticsUsageSnapshot,
    ) -> Result<DiagnosticsQueueRecord, String> {
        let config = self.config.read().await.clone();
        let sanitized = sanitize_snapshot(snapshot, config.diagnostics_level);
        let paths = self.paths.clone();
        tokio::task::spawn_blocking(move || enqueue_snapshot(&paths, sanitized))
            .await
            .map_err(|err| format!("Task join error: {}", err))?
    }

    pub async fn record_performance_snapshot(&self) -> Result<DiagnosticsQueueRecord, String> {
        let config = self.config.read().await.clone();
        if config.diagnostics_level == DiagnosticsLevel::Off {
            return Err("Diagnostics are disabled".to_string());
        }
        let metrics = perf_utils::get_process_metrics();
        let snapshot = DiagnosticsUsageSnapshot {
            schema_version: DIAGNOSTICS_SCHEMA_VERSION,
            diagnostics_level: DiagnosticsLevel::PerformanceOnly,
            captured_at: now_rfc3339(),
            app_launch_count: 1,
            app_usage_duration_bucket: Some(
                bucket_duration_ms((metrics.uptime_secs as f64) * 1000.0).to_string(),
            ),
            system_profile: None,
            app_resource_usage: Some(serde_json::json!({
                "appAvgRamBucket": bucket_ram_mb(metrics.memory_rss_mb),
                "appPeakRamBucket": bucket_ram_mb(metrics.memory_rss_mb),
                "appAvgCpuBucket": bucket_cpu_percent(metrics.cpu_percent as f64),
                "uptimeBucket": bucket_duration_ms((metrics.uptime_secs as f64) * 1000.0),
            })),
            sessions: None,
            workspaces: None,
            model_usage: None,
            top_models_by_run_count: None,
            rust_agent_top_sessions_by_duration: None,
            external_tools: None,
            top_languages: None,
            rpc: None,
            http: None,
        };
        let paths = self.paths.clone();
        tokio::task::spawn_blocking(move || enqueue_snapshot(&paths, snapshot))
            .await
            .map_err(|err| format!("Task join error: {}", err))?
    }

    pub async fn flush_now(&self) -> Result<DiagnosticsFlushStatus, String> {
        let config = self.config.read().await.clone();
        if !config.uploads_enabled() {
            let paths = self.paths.clone();
            let queued_unsent = tokio::task::spawn_blocking(move || unsent_count(&paths.queue))
                .await
                .map_err(|err| format!("Task join error: {}", err))??;
            return Ok(DiagnosticsFlushStatus {
                endpoint_configured: endpoint_url().is_some(),
                attempted: false,
                uploaded: 0,
                queued_unsent,
            });
        }

        let Some(endpoint) = endpoint_url() else {
            let paths = self.paths.clone();
            let queued_unsent = tokio::task::spawn_blocking(move || unsent_count(&paths.queue))
                .await
                .map_err(|err| format!("Task join error: {}", err))??;
            return Ok(DiagnosticsFlushStatus {
                endpoint_configured: false,
                attempted: false,
                uploaded: 0,
                queued_unsent,
            });
        };

        let install_id = self.ensure_install_id().await?;
        let paths = self.paths.clone();
        let records = tokio::task::spawn_blocking(move || read_unsent_records(&paths.queue))
            .await
            .map_err(|err| format!("Task join error: {}", err))??;

        if records.is_empty() {
            return Ok(DiagnosticsFlushStatus {
                endpoint_configured: true,
                attempted: false,
                uploaded: 0,
                queued_unsent: 0,
            });
        }

        let payload = DiagnosticsUploadPayload {
            schema_version: DIAGNOSTICS_SCHEMA_VERSION,
            install_id,
            generated_at: now_rfc3339(),
            records: records.clone(),
        };
        let client = reqwest::Client::new();
        let response = client
            .post(endpoint)
            .header(reqwest::header::USER_AGENT, USER_AGENT)
            .json(&payload)
            .send()
            .await
            .map_err(|err| format!("Diagnostics upload failed: {}", err))?;

        if !response.status().is_success() {
            return Err(format!(
                "Diagnostics upload failed with status {}",
                response.status()
            ));
        }

        let sent_at = now_rfc3339();
        let sent_ids: Vec<String> = records.into_iter().map(|record| record.id).collect();
        let paths = self.paths.clone();
        let uploaded = sent_ids.len();
        tokio::task::spawn_blocking(move || {
            super::queue::mark_records_sent(&paths.queue, &sent_ids, &sent_at)?;
            unsent_count(&paths.queue)
        })
        .await
        .map_err(|err| format!("Task join error: {}", err))?
        .map(|queued_unsent| DiagnosticsFlushStatus {
            endpoint_configured: true,
            attempted: true,
            uploaded,
            queued_unsent,
        })
    }

    async fn ensure_install_id(&self) -> Result<String, String> {
        if let Some(existing) = self.install_id.read().await.clone() {
            return Ok(existing);
        }
        let paths = self.paths.clone();
        let install_id = tokio::task::spawn_blocking(move || ensure_install_id(&paths))
            .await
            .map_err(|err| format!("Task join error: {}", err))??;
        let mut guard = self.install_id.write().await;
        *guard = Some(install_id.clone());
        Ok(install_id)
    }

    fn start_scheduler(self: &Arc<Self>) {
        if self.scheduler_started.set(()).is_err() {
            return;
        }
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let hours = service.config.read().await.upload_interval_hours;
                tokio::time::sleep(Duration::from_secs(
                    hours.saturating_mul(60).saturating_mul(60),
                ))
                .await;
                if let Err(err) = service.record_performance_snapshot().await {
                    tracing::warn!(error = %err, "[Diagnostics] Failed to record scheduled performance snapshot");
                }
                if let Err(err) = service.flush_now().await {
                    tracing::warn!(error = %err, "[Diagnostics] Scheduled flush failed");
                }
            }
        });
    }
}

fn endpoint_url() -> Option<String> {
    std::env::var(ENDPOINT_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| option_env!("ORGII_DIAGNOSTICS_ENDPOINT").map(ToOwned::to_owned))
        .filter(|value| !value.trim().is_empty())
}

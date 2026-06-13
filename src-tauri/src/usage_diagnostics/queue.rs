use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use uuid::Uuid;

use super::types::{DiagnosticsQueueRecord, DiagnosticsUsageSnapshot};

const INSTALL_ID_FILE: &str = "install_id";
const QUEUE_FILE: &str = "queue.jsonl";
const MAX_QUEUE_RECORDS: usize = 2_000;

#[derive(Debug, Clone)]
pub struct DiagnosticsPaths {
    pub dir: PathBuf,
    pub install_id: PathBuf,
    pub queue: PathBuf,
}

impl DiagnosticsPaths {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            install_id: dir.join(INSTALL_ID_FILE),
            queue: dir.join(QUEUE_FILE),
            dir,
        }
    }
}

pub fn ensure_install_id(paths: &DiagnosticsPaths) -> Result<String, String> {
    fs::create_dir_all(&paths.dir).map_err(|err| {
        format!(
            "Failed to create diagnostics directory {}: {}",
            paths.dir.display(),
            err
        )
    })?;

    if paths.install_id.exists() {
        let existing = fs::read_to_string(&paths.install_id).map_err(|err| {
            format!(
                "Failed to read diagnostics install id {}: {}",
                paths.install_id.display(),
                err
            )
        })?;
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    let install_id = Uuid::new_v4().to_string();
    write_atomic(&paths.install_id, install_id.as_bytes())?;
    if let Err(err) = app_paths::set_sensitive_file_permissions(&paths.install_id) {
        tracing::warn!(error = %err, path = %paths.install_id.display(), "[Diagnostics] Failed to restrict install id file permissions");
    }
    Ok(install_id)
}

pub fn enqueue_snapshot(
    paths: &DiagnosticsPaths,
    snapshot: DiagnosticsUsageSnapshot,
) -> Result<DiagnosticsQueueRecord, String> {
    fs::create_dir_all(&paths.dir).map_err(|err| {
        format!(
            "Failed to create diagnostics directory {}: {}",
            paths.dir.display(),
            err
        )
    })?;

    trim_queue_if_needed(&paths.queue)?;

    let record = DiagnosticsQueueRecord {
        id: Uuid::new_v4().to_string(),
        created_at: now_rfc3339(),
        sent_at: None,
        snapshot,
    };
    let serialized = serde_json::to_string(&record)
        .map_err(|err| format!("Failed to encode diagnostics queue record: {}", err))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.queue)
        .map_err(|err| {
            format!(
                "Failed to open diagnostics queue {}: {}",
                paths.queue.display(),
                err
            )
        })?;
    writeln!(file, "{}", serialized).map_err(|err| {
        format!(
            "Failed to append diagnostics queue {}: {}",
            paths.queue.display(),
            err
        )
    })?;
    if let Err(err) = app_paths::set_sensitive_file_permissions(&paths.queue) {
        tracing::warn!(error = %err, path = %paths.queue.display(), "[Diagnostics] Failed to restrict queue file permissions");
    }
    Ok(record)
}

pub fn read_records(path: &Path) -> Result<Vec<DiagnosticsQueueRecord>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let file = File::open(path).map_err(|err| {
        format!(
            "Failed to open diagnostics queue {}: {}",
            path.display(),
            err
        )
    })?;
    let reader = BufReader::new(file);
    let mut records = Vec::new();
    for (line_index, line) in reader.lines().enumerate() {
        let line = line.map_err(|err| {
            format!(
                "Failed to read diagnostics queue {} line {}: {}",
                path.display(),
                line_index + 1,
                err
            )
        })?;
        if line.trim().is_empty() {
            continue;
        }
        let record = serde_json::from_str::<DiagnosticsQueueRecord>(&line).map_err(|err| {
            format!(
                "Failed to parse diagnostics queue {} line {}: {}",
                path.display(),
                line_index + 1,
                err
            )
        })?;
        records.push(record);
    }
    Ok(records)
}

pub fn read_unsent_records(path: &Path) -> Result<Vec<DiagnosticsQueueRecord>, String> {
    Ok(read_records(path)?
        .into_iter()
        .filter(|record| record.sent_at.is_none())
        .collect())
}

pub fn mark_records_sent(path: &Path, sent_ids: &[String], sent_at: &str) -> Result<(), String> {
    if sent_ids.is_empty() || !path.exists() {
        return Ok(());
    }
    let mut records = read_records(path)?;
    for record in &mut records {
        if sent_ids.contains(&record.id) {
            record.sent_at = Some(sent_at.to_string());
        }
    }
    write_records(path, &records)
}

pub fn unsent_count(path: &Path) -> Result<usize, String> {
    Ok(read_unsent_records(path)?.len())
}

pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn trim_queue_if_needed(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let records = read_records(path)?;
    if records.len() < MAX_QUEUE_RECORDS {
        return Ok(());
    }
    let retained: Vec<DiagnosticsQueueRecord> = records
        .into_iter()
        .filter(|record| record.sent_at.is_none())
        .rev()
        .take(MAX_QUEUE_RECORDS - 1)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    write_records(path, &retained)
}

fn write_records(path: &Path, records: &[DiagnosticsQueueRecord]) -> Result<(), String> {
    let mut bytes = Vec::new();
    for record in records {
        let serialized = serde_json::to_string(record)
            .map_err(|err| format!("Failed to encode diagnostics queue record: {}", err))?;
        bytes.extend_from_slice(serialized.as_bytes());
        bytes.push(b'\n');
    }
    write_atomic(path, &bytes)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            format!(
                "Failed to create diagnostics parent directory {}: {}",
                parent.display(),
                err
            )
        })?;
    }
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("System clock error while writing diagnostics file: {}", err))?
        .as_nanos();
    let tmp_path = path.with_extension(format!("tmp-{}", nanos));
    {
        let mut file = File::create(&tmp_path).map_err(|err| {
            format!(
                "Failed to create diagnostics temp file {}: {}",
                tmp_path.display(),
                err
            )
        })?;
        file.write_all(bytes).map_err(|err| {
            format!(
                "Failed to write diagnostics temp file {}: {}",
                tmp_path.display(),
                err
            )
        })?;
        file.sync_all().map_err(|err| {
            format!(
                "Failed to sync diagnostics temp file {}: {}",
                tmp_path.display(),
                err
            )
        })?;
    }
    fs::rename(&tmp_path, path).map_err(|err| {
        format!(
            "Failed to replace diagnostics file {} with {}: {}",
            path.display(),
            tmp_path.display(),
            err
        )
    })?;
    Ok(())
}

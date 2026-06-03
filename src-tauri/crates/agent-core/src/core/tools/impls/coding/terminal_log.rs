//! Terminal log file writer — file-backed logs for background processes.
//!
//! Each subprocess run gets a log file under `{app_data}/agent-terminal-logs/{workspace_slug}/`.
//! The file has a YAML header with metadata (pid, cwd, command, started_at, etc.) followed
//! by interleaved stdout/stderr lines.
//!
//! This replaces the in-memory `ProcessManager` ring buffer — the agent can now use
//! `run_shell` with `cat`, `tail`, `sleep`, and `kill` to follow up on background processes.

use chrono::{DateTime, Utc};
use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// Tie-breaking counter appended to timestamp-based run IDs.
static RUN_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Max number of log files to keep per workspace. Oldest are deleted on create.
const MAX_LOG_FILES: usize = 50;

/// Status of a terminal log's associated process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogProcessStatus {
    Running,
    Backgrounded,
    Exited(i32),
    Killed,
}

/// Metadata stored in the log file header.
#[derive(Debug, Clone)]
pub struct LogHeader {
    pub pid: u32,
    pub cwd: String,
    pub command: String,
    pub started_at: DateTime<Utc>,
    pub status: LogProcessStatus,
    pub running_for_ms: Option<u64>,
    pub ended_at: Option<DateTime<Utc>>,
    pub exit_code: Option<i32>,
}

impl LogHeader {
    /// Create a new header for a running process.
    pub fn new(pid: u32, cwd: String, command: String) -> Self {
        Self {
            pid,
            cwd,
            command,
            started_at: Utc::now(),
            status: LogProcessStatus::Running,
            running_for_ms: None,
            ended_at: None,
            exit_code: None,
        }
    }

    /// Format the header as YAML-ish text (matches Cursor's format).
    pub fn to_yaml(&self) -> String {
        let mut lines = vec![
            "---".to_string(),
            format!("pid: {}", self.pid),
            format!("cwd: {}", self.cwd),
            format!("command: {}", escape_yaml_string(&self.command)),
            format!("started_at: {}", self.started_at.to_rfc3339()),
        ];

        match self.status {
            LogProcessStatus::Running => {
                if let Some(ms) = self.running_for_ms {
                    lines.push(format!("running_for_ms: {}", ms));
                }
            }
            LogProcessStatus::Backgrounded => {
                lines.push("status: backgrounded".to_string());
                if let Some(ms) = self.running_for_ms {
                    lines.push(format!("running_for_ms: {}", ms));
                }
            }
            LogProcessStatus::Exited(code) => {
                lines.push(format!("exit_code: {}", code));
                if let Some(ended) = &self.ended_at {
                    lines.push(format!("ended_at: {}", ended.to_rfc3339()));
                }
            }
            LogProcessStatus::Killed => {
                lines.push("status: killed".to_string());
                if let Some(ended) = &self.ended_at {
                    lines.push(format!("ended_at: {}", ended.to_rfc3339()));
                }
            }
        }

        lines.push("---".to_string());
        lines.join("\n")
    }
}

/// Escape a string for YAML (handle quotes and newlines).
fn escape_yaml_string(s: &str) -> String {
    if s.contains('\n') || s.contains('"') || s.contains('\'') {
        // Use double-quoted form with escape sequences
        format!(
            "\"{}\"",
            s.replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('\n', "\\n")
        )
    } else {
        s.to_string()
    }
}

/// A single terminal log file writer.
pub struct TerminalLogWriter {
    pub run_id: String,
    pub path: PathBuf,
    pub header: LogHeader,
    writer: Option<BufWriter<File>>,
}

impl TerminalLogWriter {
    /// Create a new log file and write the initial header.
    ///
    /// File naming: `{unix_millis}_{counter}.txt` — unique across restarts.
    /// Old log files beyond `MAX_LOG_FILES` are pruned on each create.
    pub fn create(logs_root: &Path, pid: u32, cwd: &str, command: &str) -> std::io::Result<Self> {
        fs::create_dir_all(logs_root)?;

        let ts_ms = Utc::now().timestamp_millis();
        let seq = RUN_COUNTER.fetch_add(1, Ordering::SeqCst);
        let run_id = format!("{}_{}", ts_ms, seq);
        let path = logs_root.join(format!("{}.txt", run_id));

        cleanup_old_logs(logs_root, MAX_LOG_FILES);

        let header = LogHeader::new(pid, cwd.to_string(), command.to_string());

        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&path)?;

        let mut writer = BufWriter::new(file);
        writeln!(writer, "{}", header.to_yaml())?;
        writer.flush()?;

        Ok(Self {
            run_id,
            path,
            header,
            writer: Some(writer),
        })
    }

    /// Append a line to the log file.
    pub fn append(&mut self, line: &str) -> std::io::Result<()> {
        if let Some(ref mut writer) = self.writer {
            write!(writer, "{}", line)?;
            // Flush periodically (or let BufWriter handle it)
        }
        Ok(())
    }

    /// Flush any buffered output.
    pub fn flush(&mut self) -> std::io::Result<()> {
        if let Some(ref mut writer) = self.writer {
            writer.flush()?;
        }
        Ok(())
    }

    /// Update the header with new status and rewrite it.
    /// Note: This rewrites the entire file header. For simplicity, we append
    /// a footer instead of rewriting the header in-place.
    pub fn finalize(
        &mut self,
        status: LogProcessStatus,
        exit_code: Option<i32>,
    ) -> std::io::Result<()> {
        self.header.status = status;
        self.header.ended_at = Some(Utc::now());
        self.header.exit_code = exit_code;

        // Flush any remaining output
        self.flush()?;

        // Append a footer with final status (easier than rewriting header)
        if let Some(ref mut writer) = self.writer {
            writeln!(writer)?;
            writeln!(writer, "---")?;
            match status {
                LogProcessStatus::Exited(code) => {
                    writeln!(writer, "exit_code: {}", code)?;
                }
                LogProcessStatus::Killed => {
                    writeln!(writer, "status: killed")?;
                }
                _ => {}
            }
            if let Some(ended) = &self.header.ended_at {
                writeln!(writer, "ended_at: {}", ended.to_rfc3339())?;
            }
            let elapsed_ms = (Utc::now() - self.header.started_at).num_milliseconds();
            writeln!(writer, "elapsed_ms: {}", elapsed_ms)?;
            writer.flush()?;
        }

        Ok(())
    }
}

/// Remove oldest log files when the directory exceeds `keep` entries.
fn cleanup_old_logs(dir: &Path, keep: usize) {
    let entries: Vec<_> = match fs::read_dir(dir) {
        Ok(rd) => rd
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "txt"))
            .collect(),
        Err(_) => return,
    };
    if entries.len() <= keep {
        return;
    }
    let mut by_time: Vec<_> = entries
        .into_iter()
        .filter_map(|entry| {
            entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .map(|t| (t, entry.path()))
        })
        .collect();
    by_time.sort_by_key(|(t, _)| *t);
    let to_remove = by_time.len().saturating_sub(keep);
    for (_, path) in by_time.into_iter().take(to_remove) {
        if let Err(err) = fs::remove_file(&path) {
            if err.kind() != std::io::ErrorKind::NotFound {
                tracing::debug!(
                    path = %path.display(),
                    error = %err,
                    "[terminal-log] cleanup_old_logs: failed to remove old log file"
                );
            }
        }
    }
}

impl Drop for TerminalLogWriter {
    fn drop(&mut self) {
        if let Err(err) = self.flush() {
            tracing::warn!("Failed to flush TerminalLogWriter on drop: {}", err);
        }
    }
}

/// Create a workspace slug from a path (matches Cursor's `Users-...-project` format).
pub fn workspace_slug(workspace_path: &Path) -> String {
    workspace_path
        .to_string_lossy()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

/// Resolve the terminal logs root directory.
///
/// Priority:
/// 1. `{app_data_dir}/agent-terminal-logs/{workspace_slug}/` (Tauri app)
/// 2. `{workspace}/.orgii/terminals/` (fallback for API-only mode)
pub fn resolve_logs_root(app_data_dir: Option<&Path>, workspace: &Path) -> PathBuf {
    if let Some(app_data) = app_data_dir {
        let slug = workspace_slug(workspace);
        app_data.join("agent-terminal-logs").join(slug)
    } else {
        // Fallback: workspace-local directory
        workspace.join(".orgii").join("terminals")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_workspace_slug() {
        let path = Path::new("/Users/laptop-h/Documents/GitHub/orgii_frontend");
        let slug = workspace_slug(path);
        assert_eq!(slug, "Users-laptop-h-Documents-GitHub-orgii_frontend");
    }

    #[test]
    fn test_log_writer_create_and_append() {
        let temp = TempDir::new().unwrap();
        let logs_root = temp.path();

        let mut writer =
            TerminalLogWriter::create(logs_root, 12345, "/home/user/project", "npm run build")
                .unwrap();

        writer.append("Building...\n").unwrap();
        writer.append("Done!\n").unwrap();
        writer
            .finalize(LogProcessStatus::Exited(0), Some(0))
            .unwrap();

        // Verify file exists and contains expected content
        let content = fs::read_to_string(&writer.path).unwrap();
        assert!(content.contains("pid: 12345"));
        assert!(content.contains("npm run build"));
        assert!(content.contains("Building..."));
        assert!(content.contains("exit_code: 0"));
    }

    #[test]
    fn test_escape_yaml_string() {
        assert_eq!(escape_yaml_string("simple"), "simple");
        assert_eq!(
            escape_yaml_string("with \"quotes\""),
            "\"with \\\"quotes\\\"\""
        );
        assert_eq!(escape_yaml_string("multi\nline"), "\"multi\\nline\"");
    }

    #[test]
    fn test_cleanup_old_logs() {
        let temp = TempDir::new().unwrap();
        let dir = temp.path();
        for i in 0..10 {
            fs::write(dir.join(format!("{}.txt", i)), "data").unwrap();
        }
        cleanup_old_logs(dir, 3);
        let remaining: Vec<_> = fs::read_dir(dir).unwrap().filter_map(|e| e.ok()).collect();
        assert_eq!(remaining.len(), 3);
    }

    #[test]
    fn test_run_id_format() {
        let temp = TempDir::new().unwrap();
        let writer = TerminalLogWriter::create(temp.path(), 1, "/tmp", "ls").unwrap();
        let fname = writer.path.file_stem().unwrap().to_string_lossy();
        assert!(
            fname.contains('_'),
            "run_id should be timestamp_counter: {}",
            fname
        );
    }

    #[test]
    fn test_finalize_killed_status() {
        let temp = TempDir::new().unwrap();
        let mut writer = TerminalLogWriter::create(temp.path(), 999, "/tmp", "sleep 999").unwrap();
        writer.append("partial output\n").unwrap();
        writer.finalize(LogProcessStatus::Killed, None).unwrap();

        let content = fs::read_to_string(&writer.path).unwrap();
        assert!(
            content.contains("status: killed"),
            "Footer should contain killed status"
        );
        assert!(
            content.contains("elapsed_ms:"),
            "Footer should contain elapsed time"
        );
        assert!(
            !content.contains("exit_code:"),
            "Killed process should not have exit_code in footer"
        );
    }

    #[test]
    fn test_finalize_exited_with_nonzero() {
        let temp = TempDir::new().unwrap();
        let mut writer = TerminalLogWriter::create(temp.path(), 100, "/tmp", "false").unwrap();
        writer
            .finalize(LogProcessStatus::Exited(1), Some(1))
            .unwrap();

        let content = fs::read_to_string(&writer.path).unwrap();
        assert!(content.contains("exit_code: 1"));
    }

    #[test]
    fn test_cleanup_ignores_non_txt_files() {
        let temp = TempDir::new().unwrap();
        let dir = temp.path();
        for i in 0..5 {
            fs::write(dir.join(format!("{}.txt", i)), "data").unwrap();
        }
        fs::write(dir.join("readme.md"), "keep me").unwrap();
        cleanup_old_logs(dir, 2);
        assert!(
            dir.join("readme.md").exists(),
            "Non-txt files should not be deleted"
        );
        let txt_count = fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().is_some_and(|ext| ext == "txt"))
            .count();
        assert_eq!(txt_count, 2);
    }

    #[test]
    fn test_cleanup_noop_when_under_limit() {
        let temp = TempDir::new().unwrap();
        let dir = temp.path();
        for i in 0..3 {
            fs::write(dir.join(format!("{}.txt", i)), "data").unwrap();
        }
        cleanup_old_logs(dir, 10);
        let count = fs::read_dir(dir).unwrap().filter_map(|e| e.ok()).count();
        assert_eq!(count, 3, "No files should be deleted when under limit");
    }

    #[test]
    fn test_multiple_writers_unique_ids() {
        let temp = TempDir::new().unwrap();
        let writer_a = TerminalLogWriter::create(temp.path(), 1, "/tmp", "a").unwrap();
        let writer_b = TerminalLogWriter::create(temp.path(), 2, "/tmp", "b").unwrap();
        assert_ne!(
            writer_a.run_id, writer_b.run_id,
            "Concurrent writers should have different run_ids"
        );
    }

    #[test]
    fn test_resolve_logs_root_with_app_data() {
        let app_data = Path::new("/home/user/.local/share/com.soyd.app");
        let workspace = Path::new("/home/user/projects/myapp");
        let result = resolve_logs_root(Some(app_data), workspace);
        assert!(result.to_string_lossy().contains("agent-terminal-logs"));
        assert!(result
            .to_string_lossy()
            .contains("home-user-projects-myapp"));
    }

    #[test]
    fn test_resolve_logs_root_fallback() {
        let workspace = Path::new("/home/user/projects/myapp");
        let result = resolve_logs_root(None, workspace);
        assert_eq!(result, workspace.join(".orgii").join("terminals"));
    }
}

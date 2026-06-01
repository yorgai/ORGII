//! RAM History Ring Buffer
//!
//! Background sampler that records the app's total RAM footprint
//! (main process RSS + child process RSS) at a fixed cadence into
//! a bounded ring buffer. Survives Settings → Monitor panel close;
//! lost on app restart.
//!
//! Memory cost: 2880 samples × 16 B ≈ 46 KB. Sampling cost: one
//! `sysinfo::refresh_processes_specifics` every `SAMPLE_INTERVAL_SECS`.

use serde::Serialize;
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

/// Sample interval. 30 s gives 24 h coverage in `MAX_SAMPLES` while
/// keeping syscall pressure trivial.
const SAMPLE_INTERVAL_SECS: u64 = 30;

/// Ring buffer capacity. 2880 × 30 s = 24 h.
const MAX_SAMPLES: usize = 2880;

#[derive(Debug, Clone, Copy, Serialize)]
pub struct RamSample {
    /// Unix timestamp in milliseconds.
    pub timestamp: i64,
    /// Main process RSS + sum of child RSS, in megabytes.
    pub total_mb: f32,
}

static RAM_HISTORY: std::sync::OnceLock<Mutex<VecDeque<RamSample>>> = std::sync::OnceLock::new();

fn buffer() -> &'static Mutex<VecDeque<RamSample>> {
    RAM_HISTORY.get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_SAMPLES)))
}

/// Spawn the background sampler. Idempotent — second call is a no-op.
pub fn start_sampler() {
    use std::sync::atomic::{AtomicBool, Ordering};
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    if let Err(err) = std::thread::Builder::new()
        .name("ram-history-sampler".into())
        .spawn(|| {
            // Dedicated System instance so we don't contend with the
            // shared SYSTEM_CACHE on every tick.
            let mut system = System::new();
            let pid = Pid::from_u32(std::process::id());

            // Take an initial sample immediately so the chart has a
            // data point before the first 30 s elapses.
            sample_once(&mut system, pid);

            loop {
                std::thread::sleep(std::time::Duration::from_secs(SAMPLE_INTERVAL_SECS));
                sample_once(&mut system, pid);
            }
        })
    {
        tracing::warn!(
            error = %err,
            "ram_history: sampler thread failed to start"
        );
    }
}

fn sample_once(system: &mut System, self_pid: Pid) {
    // Refresh self + all processes (we need children too).
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_memory(),
    );

    let self_rss = system.process(self_pid).map(|p| p.memory()).unwrap_or(0);

    let mut children_rss: u64 = 0;
    for (_, process) in system.processes() {
        if let Some(parent) = process.parent() {
            if parent == self_pid {
                children_rss = children_rss.saturating_add(process.memory());
            }
        }
    }

    let total_mb = (self_rss + children_rss) as f32 / 1024.0 / 1024.0;
    if total_mb <= 0.0 {
        return;
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let buf = buffer();
    let mut guard = match buf.lock() {
        Ok(g) => g,
        Err(err) => {
            tracing::warn!(
                error = %err,
                "ram_history: buffer mutex poisoned; dropping sample"
            );
            return;
        }
    };
    if guard.len() >= MAX_SAMPLES {
        guard.pop_front();
    }
    guard.push_back(RamSample {
        timestamp,
        total_mb,
    });
}

/// Snapshot of the current ring buffer.
#[tauri::command]
pub fn get_ram_history() -> Vec<RamSample> {
    let buf = buffer();
    match buf.lock() {
        Ok(guard) => guard.iter().copied().collect(),
        Err(err) => {
            tracing::warn!(
                error = %err,
                "ram_history: buffer mutex poisoned on read; returning empty"
            );
            Vec::new()
        }
    }
}

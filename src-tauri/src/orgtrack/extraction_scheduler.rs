use perf_utils::process_metrics::{get_process_metrics, get_system_memory};
use serde::{Deserialize, Serialize};

pub const DEFAULT_SOFT_PAUSE_RSS_MB: f64 = 800.0;
pub const DEFAULT_HARD_PAUSE_RSS_MB: f64 = 1024.0;
pub const DEFAULT_RESUME_RSS_MB: f64 = 700.0;
pub const DEFAULT_MIN_SYSTEM_AVAILABLE_MB: f64 = 1024.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionMemoryGateConfig {
    pub soft_pause_rss_mb: f64,
    pub hard_pause_rss_mb: f64,
    pub resume_rss_mb: f64,
    pub min_system_available_mb: f64,
}

impl Default for ExtractionMemoryGateConfig {
    fn default() -> Self {
        Self {
            soft_pause_rss_mb: DEFAULT_SOFT_PAUSE_RSS_MB,
            hard_pause_rss_mb: DEFAULT_HARD_PAUSE_RSS_MB,
            resume_rss_mb: DEFAULT_RESUME_RSS_MB,
            min_system_available_mb: DEFAULT_MIN_SYSTEM_AVAILABLE_MB,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtractionMemoryDecision {
    Run,
    PauseSoft,
    PauseHard,
    PauseSystemMemory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionMemoryGateState {
    pub decision: ExtractionMemoryDecision,
    pub rust_rss_mb: f64,
    pub system_available_mb: f64,
    pub should_resume: bool,
}

pub fn evaluate_memory_gate(config: &ExtractionMemoryGateConfig) -> ExtractionMemoryGateState {
    let process = get_process_metrics();
    let system = get_system_memory();
    let decision = if process.memory_rss_mb >= config.hard_pause_rss_mb {
        ExtractionMemoryDecision::PauseHard
    } else if system.available_mb > 0.0 && system.available_mb < config.min_system_available_mb {
        ExtractionMemoryDecision::PauseSystemMemory
    } else if process.memory_rss_mb >= config.soft_pause_rss_mb {
        ExtractionMemoryDecision::PauseSoft
    } else {
        ExtractionMemoryDecision::Run
    };
    ExtractionMemoryGateState {
        decision,
        rust_rss_mb: process.memory_rss_mb,
        system_available_mb: system.available_mb,
        should_resume: process.memory_rss_mb < config.resume_rss_mb
            && (system.available_mb == 0.0
                || system.available_mb >= config.min_system_available_mb),
    }
}

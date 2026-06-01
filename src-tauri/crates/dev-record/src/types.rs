//! Coding Activity Tracker — Types
//!
//! Typed enums and structs for activity tracking. All domain values use
//! enums (never raw strings) per workspace rules.

use serde::{Deserialize, Serialize};
use std::fmt;

// ============================================
// Enums
// ============================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivitySource {
    OrgiiEditor,
    Terminal,
    Agent,
    VsCode,
    Cursor,
    JetBrains,
    Vim,
    Sublime,
    Zed,
    Xcode,
    Emacs,
    Trae,
    Windsurf,
    Fleet,
    Nova,
    Lapce,
    Helix,
    Kakoune,
    AiCli,
    ClaudeCode,
    Codex,
    GeminiCli,
    KiroCli,
    Aider,
    Unknown,
}

impl fmt::Display for ActivitySource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::OrgiiEditor => write!(f, "orgii_editor"),
            Self::Terminal => write!(f, "terminal"),
            Self::Agent => write!(f, "agent"),
            Self::VsCode => write!(f, "vscode"),
            Self::Cursor => write!(f, "cursor"),
            Self::JetBrains => write!(f, "jetbrains"),
            Self::Vim => write!(f, "vim"),
            Self::Sublime => write!(f, "sublime"),
            Self::Zed => write!(f, "zed"),
            Self::Xcode => write!(f, "xcode"),
            Self::Emacs => write!(f, "emacs"),
            Self::Trae => write!(f, "trae"),
            Self::Windsurf => write!(f, "windsurf"),
            Self::Fleet => write!(f, "fleet"),
            Self::Nova => write!(f, "nova"),
            Self::Lapce => write!(f, "lapce"),
            Self::Helix => write!(f, "helix"),
            Self::Kakoune => write!(f, "kakoune"),
            Self::AiCli => write!(f, "ai_cli"),
            Self::ClaudeCode => write!(f, "claude_code"),
            Self::Codex => write!(f, "codex"),
            Self::GeminiCli => write!(f, "gemini_cli"),
            Self::KiroCli => write!(f, "kiro_cli"),
            Self::Aider => write!(f, "aider"),
            Self::Unknown => write!(f, "unknown"),
        }
    }
}

impl ActivitySource {
    pub fn from_str_value(value: &str) -> Self {
        match value {
            "orgii_editor" => Self::OrgiiEditor,
            "terminal" => Self::Terminal,
            "agent" => Self::Agent,
            "vscode" => Self::VsCode,
            "cursor" => Self::Cursor,
            "jetbrains" => Self::JetBrains,
            "vim" => Self::Vim,
            "sublime" => Self::Sublime,
            "zed" => Self::Zed,
            "xcode" => Self::Xcode,
            "emacs" => Self::Emacs,
            "trae" => Self::Trae,
            "windsurf" => Self::Windsurf,
            "fleet" => Self::Fleet,
            "nova" => Self::Nova,
            "lapce" => Self::Lapce,
            "helix" => Self::Helix,
            "kakoune" => Self::Kakoune,
            "ai_cli" => Self::AiCli,
            "claude_code" => Self::ClaudeCode,
            "codex" => Self::Codex,
            "gemini_cli" => Self::GeminiCli,
            "kiro_cli" => Self::KiroCli,
            "aider" => Self::Aider,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    FileEdit,
    FileCreate,
    FileDelete,
    TerminalCommand,
    AgentAction,
    FocusGained,
    FocusLost,
}

impl fmt::Display for EventType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FileEdit => write!(f, "file_edit"),
            Self::FileCreate => write!(f, "file_create"),
            Self::FileDelete => write!(f, "file_delete"),
            Self::TerminalCommand => write!(f, "terminal_command"),
            Self::AgentAction => write!(f, "agent_action"),
            Self::FocusGained => write!(f, "focus_gained"),
            Self::FocusLost => write!(f, "focus_lost"),
        }
    }
}

impl EventType {
    pub fn from_str_value(value: &str) -> Option<Self> {
        match value {
            "file_edit" => Some(Self::FileEdit),
            "file_create" => Some(Self::FileCreate),
            "file_delete" => Some(Self::FileDelete),
            "terminal_command" => Some(Self::TerminalCommand),
            "agent_action" => Some(Self::AgentAction),
            "focus_gained" => Some(Self::FocusGained),
            "focus_lost" => Some(Self::FocusLost),
            _ => None,
        }
    }
}

// ============================================
// Structs — Ingestion
// ============================================

#[derive(Debug, Clone)]
pub struct Heartbeat {
    pub timestamp: String,
    pub workspace_path: Option<String>,
    pub file_path: Option<String>,
    pub language: Option<String>,
    pub source: ActivitySource,
    pub event_type: EventType,
    pub lines_added: i32,
    pub lines_removed: i32,
    pub metadata_json: Option<String>,
}

// ============================================
// Structs — IDE Detection
// ============================================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedIde {
    pub source: ActivitySource,
    pub pid: u32,
    pub process_name: String,
    pub is_frontmost: bool,
}

// ============================================
// Structs — Query Results
// ============================================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailySummary {
    pub date: String,
    pub workspace_path: Option<String>,
    pub language: Option<String>,
    pub total_seconds: i64,
    pub file_edits: i64,
    pub lines_added: i64,
    pub lines_removed: i64,
    pub terminal_cmds: i64,
    pub agent_actions: i64,
    pub files_touched: i64,
    pub primary_source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodingSession {
    pub id: i64,
    pub start_time: String,
    pub end_time: Option<String>,
    pub workspace_path: Option<String>,
    pub source: String,
    pub duration_seconds: i64,
    pub heartbeat_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageStat {
    pub language: String,
    pub total_seconds: i64,
    pub file_edits: i64,
    pub lines_added: i64,
    pub lines_removed: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapCell {
    pub hour: u32,
    pub day_of_week: u32,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeUsageStat {
    pub source: String,
    pub total_seconds: i64,
    pub file_edits: i64,
    pub heartbeat_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreakInfo {
    pub current_streak: i64,
    pub longest_streak: i64,
    pub last_active_date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHotspot {
    pub file_path: String,
    pub edit_count: i64,
    pub lines_added: i64,
    pub lines_removed: i64,
    pub commit_count: i64,
}

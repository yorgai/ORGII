use crate::types::*;

#[test]
fn activity_source_from_str_value_orgii_editor() {
    assert_eq!(
        ActivitySource::from_str_value("orgii_editor"),
        ActivitySource::OrgiiEditor
    );
}

#[test]
fn activity_source_from_str_value_terminal() {
    assert_eq!(
        ActivitySource::from_str_value("terminal"),
        ActivitySource::Terminal
    );
}

#[test]
fn activity_source_from_str_value_agent() {
    assert_eq!(
        ActivitySource::from_str_value("agent"),
        ActivitySource::Agent
    );
}

#[test]
fn activity_source_from_str_value_vscode() {
    assert_eq!(
        ActivitySource::from_str_value("vscode"),
        ActivitySource::VsCode
    );
}

#[test]
fn activity_source_from_str_value_cursor() {
    assert_eq!(
        ActivitySource::from_str_value("cursor"),
        ActivitySource::Cursor
    );
}

#[test]
fn activity_source_from_str_value_jetbrains() {
    assert_eq!(
        ActivitySource::from_str_value("jetbrains"),
        ActivitySource::JetBrains
    );
}

#[test]
fn activity_source_from_str_value_vim() {
    assert_eq!(ActivitySource::from_str_value("vim"), ActivitySource::Vim);
}

#[test]
fn activity_source_from_str_value_sublime() {
    assert_eq!(
        ActivitySource::from_str_value("sublime"),
        ActivitySource::Sublime
    );
}

#[test]
fn activity_source_from_str_value_zed() {
    assert_eq!(ActivitySource::from_str_value("zed"), ActivitySource::Zed);
}

#[test]
fn activity_source_from_str_value_xcode() {
    assert_eq!(
        ActivitySource::from_str_value("xcode"),
        ActivitySource::Xcode
    );
}

#[test]
fn activity_source_from_str_value_emacs() {
    assert_eq!(
        ActivitySource::from_str_value("emacs"),
        ActivitySource::Emacs
    );
}

#[test]
fn activity_source_from_str_value_trae() {
    assert_eq!(ActivitySource::from_str_value("trae"), ActivitySource::Trae);
}

#[test]
fn activity_source_from_str_value_windsurf() {
    assert_eq!(
        ActivitySource::from_str_value("windsurf"),
        ActivitySource::Windsurf
    );
}

#[test]
fn activity_source_from_str_value_fleet() {
    assert_eq!(
        ActivitySource::from_str_value("fleet"),
        ActivitySource::Fleet
    );
}

#[test]
fn activity_source_from_str_value_nova() {
    assert_eq!(ActivitySource::from_str_value("nova"), ActivitySource::Nova);
}

#[test]
fn activity_source_from_str_value_lapce() {
    assert_eq!(
        ActivitySource::from_str_value("lapce"),
        ActivitySource::Lapce
    );
}

#[test]
fn activity_source_from_str_value_helix() {
    assert_eq!(
        ActivitySource::from_str_value("helix"),
        ActivitySource::Helix
    );
}

#[test]
fn activity_source_from_str_value_kakoune() {
    assert_eq!(
        ActivitySource::from_str_value("kakoune"),
        ActivitySource::Kakoune
    );
}

#[test]
fn activity_source_from_str_value_ai_cli() {
    assert_eq!(
        ActivitySource::from_str_value("ai_cli"),
        ActivitySource::AiCli
    );
}

#[test]
fn activity_source_from_str_value_claude_code() {
    assert_eq!(
        ActivitySource::from_str_value("claude_code"),
        ActivitySource::ClaudeCode
    );
}

#[test]
fn activity_source_from_str_value_codex() {
    assert_eq!(
        ActivitySource::from_str_value("codex"),
        ActivitySource::Codex
    );
}

#[test]
fn activity_source_from_str_value_gemini_cli() {
    assert_eq!(
        ActivitySource::from_str_value("gemini_cli"),
        ActivitySource::GeminiCli
    );
}

#[test]
fn activity_source_from_str_value_kiro_cli() {
    assert_eq!(
        ActivitySource::from_str_value("kiro_cli"),
        ActivitySource::KiroCli
    );
}

#[test]
fn activity_source_from_str_value_aider() {
    assert_eq!(
        ActivitySource::from_str_value("aider"),
        ActivitySource::Aider
    );
}

#[test]
fn activity_source_from_str_value_unknown() {
    assert_eq!(
        ActivitySource::from_str_value("unknown_tool"),
        ActivitySource::Unknown
    );
}

#[test]
fn activity_source_display_roundtrip() {
    let variants = [
        ActivitySource::OrgiiEditor,
        ActivitySource::Terminal,
        ActivitySource::Agent,
        ActivitySource::VsCode,
        ActivitySource::Cursor,
        ActivitySource::JetBrains,
        ActivitySource::Vim,
        ActivitySource::Sublime,
        ActivitySource::Zed,
        ActivitySource::Xcode,
        ActivitySource::Emacs,
        ActivitySource::Trae,
        ActivitySource::Windsurf,
        ActivitySource::Fleet,
        ActivitySource::Nova,
        ActivitySource::Lapce,
        ActivitySource::Helix,
        ActivitySource::Kakoune,
        ActivitySource::AiCli,
        ActivitySource::ClaudeCode,
        ActivitySource::Codex,
        ActivitySource::GeminiCli,
        ActivitySource::KiroCli,
        ActivitySource::Aider,
        ActivitySource::Unknown,
    ];
    for variant in variants {
        let s = format!("{}", variant);
        let parsed = ActivitySource::from_str_value(&s);
        assert_eq!(parsed, variant, "Display roundtrip failed for {}", s);
    }
}

#[test]
fn event_type_from_str_value_file_edit() {
    assert_eq!(
        EventType::from_str_value("file_edit"),
        Some(EventType::FileEdit)
    );
}

#[test]
fn event_type_from_str_value_file_create() {
    assert_eq!(
        EventType::from_str_value("file_create"),
        Some(EventType::FileCreate)
    );
}

#[test]
fn event_type_from_str_value_file_delete() {
    assert_eq!(
        EventType::from_str_value("file_delete"),
        Some(EventType::FileDelete)
    );
}

#[test]
fn event_type_from_str_value_terminal_command() {
    assert_eq!(
        EventType::from_str_value("terminal_command"),
        Some(EventType::TerminalCommand)
    );
}

#[test]
fn event_type_from_str_value_agent_action() {
    assert_eq!(
        EventType::from_str_value("agent_action"),
        Some(EventType::AgentAction)
    );
}

#[test]
fn event_type_from_str_value_focus_gained() {
    assert_eq!(
        EventType::from_str_value("focus_gained"),
        Some(EventType::FocusGained)
    );
}

#[test]
fn event_type_from_str_value_focus_lost() {
    assert_eq!(
        EventType::from_str_value("focus_lost"),
        Some(EventType::FocusLost)
    );
}

#[test]
fn event_type_from_str_value_unknown() {
    assert_eq!(EventType::from_str_value("unknown_event"), None);
}

#[test]
fn event_type_display_roundtrip() {
    let variants = [
        EventType::FileEdit,
        EventType::FileCreate,
        EventType::FileDelete,
        EventType::TerminalCommand,
        EventType::AgentAction,
        EventType::FocusGained,
        EventType::FocusLost,
    ];
    for variant in variants {
        let s = format!("{}", variant);
        let parsed = EventType::from_str_value(&s);
        assert_eq!(parsed, Some(variant), "Display roundtrip failed for {}", s);
    }
}

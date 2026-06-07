use crate::definitions::builtin::GUI_CONTROL_AGENT_ID;

const MAX_RELEVANT_CONTROLS: usize = 4;

struct ControlCard {
    id: &'static str,
    kind: &'static str,
    summary: &'static str,
    call: &'static str,
    terms: &'static [&'static str],
}

const CONTROL_CARDS: &[ControlCard] = &[
    ControlCard {
        id: "settings.language.set",
        kind: "action",
        summary: "Set the ORGII app language/locale. Use directly for language requests; Spotlight also exposes this as a second-level language picker.",
        call: r#"control_orgii({ "action": "settings.language.set", "params": { "language": "fr" } }) for French. Supported language codes: en, fr, zh, zh-Hant, es, ru, pt, de, ja, ko, tr, vi, pl. In Spotlight, choose Language, then choose the target language."#,
        terms: &[
            "language", "locale", "translation", "french", "français", "francais", "fr", "english", "chinese", "spanish", "german", "japanese", "korean", "russian", "portuguese", "turkish", "vietnamese", "polish",
        ],
    },
    ControlCard {
        id: "spotlight",
        kind: "tool",
        summary: "Open or route ORGII Spotlight, command palette, workspace picker, branch picker, file search, or Agent session search.",
        call: r#"spotlight({ "operation": "open" | "close" | "toggle" | "workspace_picker" | "branch_picker" | "file_search" | "command_palette" | "agent_session_search", "mode": "switch" | "open" | "add" | "create" })"#,
        terms: &[
            "spotlight", "command palette", "cmd k", "command", "quick open", "file search", "find file", "workspace picker", "switch workspace", "open folder", "add workspace", "create workspace", "branch picker", "checkout branch", "session search", "find session",
        ],
    },
    ControlCard {
        id: "theme.setLight/theme.setDark/theme.setHighContrast",
        kind: "actions",
        summary: "Switch ORGII appearance using discrete theme commands. Prefer these over parameterized theme operations.",
        call: r#"control_orgii({ "action": "theme.setLight", "params": {} }), control_orgii({ "action": "theme.setDark", "params": {} }), or control_orgii({ "action": "theme.setHighContrast", "params": {} })"#,
        terms: &[
            "theme", "appearance", "light theme", "light mode", "dark theme", "dark mode", "high contrast", "contrast", "accessibility theme",
        ],
    },
    ControlCard {
        id: "chatPanel settings",
        kind: "actions",
        summary: "Change chat panel settings with discrete commands for position, pagination, and model picker style.",
        call: r#"Position: chatPanel.setMyStationLeft, chatPanel.setMyStationRight, chatPanel.setAgentStationLeft, chatPanel.setAgentStationRight. Pagination: chatPanel.enablePagination or chatPanel.disablePagination. Model picker: chatPanel.useModelPickerSpotlight or chatPanel.useModelPickerDropdown."#,
        terms: &[
            "chat panel", "chat location", "chat left", "chat right", "my station chat", "agent station chat", "pagination", "chat rounds", "model picker", "model dropdown", "model spotlight",
        ],
    },
    ControlCard {
        id: "workstation layout settings",
        kind: "actions",
        summary: "Change Workstation layout settings with discrete commands.",
        call: r#"Layout density: workstation.setComfortLayout or workstation.setCompactLayout. Sidebar: workstation.setSidebarLeft or workstation.setSidebarRight. Dock: workstation.enableDockAutoHide or workstation.disableDockAutoHide."#,
        terms: &[
            "workstation layout", "compact layout", "comfort layout", "sidebar position", "workstation sidebar", "dock auto hide", "auto hide dock", "dock visible",
        ],
    },
    ControlCard {
        id: "workstation.openSourceControlTab",
        kind: "action",
        summary: "Open the Workstation Source Control / Git sidebar tab.",
        call: r#"control_orgii({ "action": "workstation.openSourceControlTab", "params": {} })"#,
        terms: &["source control", "scm", "git panel", "git sidebar", "changes", "staged", "unstaged"],
    },
    ControlCard {
        id: "app.goToSettings",
        kind: "action",
        summary: "Navigate to Settings.",
        call: r#"control_orgii({ "action": "app.goToSettings", "params": {} })"#,
        terms: &["settings", "preferences", "configuration", "config", "options"],
    },
    ControlCard {
        id: "sidebar.toggle",
        kind: "action",
        summary: "Toggle the global app sidebar.",
        call: r#"control_orgii({ "action": "sidebar.toggle", "params": {} })"#,
        terms: &["sidebar", "side bar", "toggle sidebar", "collapse sidebar", "expand sidebar", "navigation sidebar"],
    },
    ControlCard {
        id: "app.zoomIn/app.zoomOut/app.zoomReset",
        kind: "actions",
        summary: "Adjust the application UI scale.",
        call: r#"control_orgii({ "action": "app.zoomIn", "params": {} }), control_orgii({ "action": "app.zoomOut", "params": {} }), or control_orgii({ "action": "app.zoomReset", "params": {} })"#,
        terms: &["zoom", "scale", "ui scale", "bigger", "larger", "smaller", "reset zoom"],
    },
];

fn normalize(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .map(|ch| if ch.is_alphanumeric() { ch } else { ' ' })
        .collect::<String>()
}

fn score_card(query: &str, normalized_query: &str, card: &ControlCard) -> usize {
    let mut score = 0;
    let normalized_id = normalize(card.id);

    for token in normalized_query.split_whitespace() {
        if token.len() < 2 {
            continue;
        }
        if normalized_id.split_whitespace().any(|part| part == token) {
            score += 4;
        }
    }

    for term in card.terms {
        let normalized_term = normalize(term);
        if query.contains(&term.to_lowercase()) || normalized_query.contains(&normalized_term) {
            score += 10 + normalized_term.split_whitespace().count();
        } else {
            for token in normalized_term.split_whitespace() {
                if token.len() >= 3
                    && normalized_query
                        .split_whitespace()
                        .any(|part| part == token)
                {
                    score += 2;
                }
            }
        }
    }

    score
}

pub fn build_gui_control_relevant_controls_section(
    agent_definition_id: Option<&str>,
    user_message: &str,
) -> Option<String> {
    if agent_definition_id != Some(GUI_CONTROL_AGENT_ID) {
        return None;
    }

    let query = user_message.to_lowercase();
    let normalized_query = normalize(user_message);
    if normalized_query.trim().is_empty() {
        return None;
    }

    let mut scored: Vec<(usize, &ControlCard)> = CONTROL_CARDS
        .iter()
        .map(|card| (score_card(&query, &normalized_query, card), card))
        .filter(|(score, _)| *score > 0)
        .collect();

    scored.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| left.1.id.cmp(right.1.id)));
    scored.truncate(MAX_RELEVANT_CONTROLS);

    if scored.is_empty() {
        return None;
    }

    let mut section = String::from(
        "## Relevant GUI controls for this request\n\nUse these direct controls before calling `gui.inspect`. `gui.inspect` is only for unknown controls.\n",
    );

    for (index, (score, card)) in scored.iter().enumerate() {
        section.push_str(&format!(
            "\n{}. {} `{}` (score {})\n   - {}\n   - Call: {}\n",
            index + 1,
            card.kind,
            card.id,
            score,
            card.summary,
            card.call
        ));
    }

    Some(section)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retrieves_language_for_french_request() {
        let section = build_gui_control_relevant_controls_section(
            Some(GUI_CONTROL_AGENT_ID),
            "change my language to French",
        )
        .expect("section");

        assert!(section.contains("settings.language.set"));
        assert!(section.contains("\"language\": \"fr\""));
    }

    #[test]
    fn retrieves_spotlight_for_command_palette_request() {
        let section = build_gui_control_relevant_controls_section(
            Some(GUI_CONTROL_AGENT_ID),
            "open the command palette",
        )
        .expect("section");

        assert!(section.contains("`spotlight`"));
        assert!(section.contains("command_palette"));
    }

    #[test]
    fn retrieves_discrete_theme_commands() {
        let section = build_gui_control_relevant_controls_section(
            Some(GUI_CONTROL_AGENT_ID),
            "switch to high contrast theme",
        )
        .expect("section");

        assert!(section.contains("theme.setHighContrast"));
    }

    #[test]
    fn retrieves_chat_panel_settings_commands() {
        let section = build_gui_control_relevant_controls_section(
            Some(GUI_CONTROL_AGENT_ID),
            "move the chat panel to the right and use the model picker dropdown",
        )
        .expect("section");

        assert!(section.contains("chatPanel.setMyStationRight"));
        assert!(section.contains("chatPanel.useModelPickerDropdown"));
    }

    #[test]
    fn skips_non_gui_control_agents() {
        assert!(build_gui_control_relevant_controls_section(
            Some("builtin:os"),
            "change my language to French",
        )
        .is_none());
    }
}

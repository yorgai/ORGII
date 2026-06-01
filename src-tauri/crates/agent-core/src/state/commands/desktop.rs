//! Desktop permission and safety configuration Tauri commands.
//!
//! Uses native macOS Accessibility/ScreenCaptureKit permission checks for
//! app-owned permission UI; agent-facing desktop automation goes through the
//! bundled Peekaboo CLI tool.

use serde::{Deserialize, Serialize};
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopConfig {
    /// Hide ORGII windows while the Peekaboo CLI is actively operating.
    #[serde(default = "app_utils::default_true")]
    pub hide_before_action: bool,
    /// Inject `--input-strategy synthFirst` on Peekaboo input commands so they
    /// post real CGEvent (HID) input instead of pure Accessibility actions.
    /// Disabling this lets apps with anti-automation detection (e.g. WeChat)
    /// see a non-HID event pattern, but uses Peekaboo's default strategy.
    #[serde(default = "app_utils::default_true")]
    pub anti_detection: bool,
    /// Inject `--profile human` on Peekaboo `type` commands so keystrokes carry
    /// human-like cadence. Disabling this types at maximum speed.
    #[serde(default = "app_utils::default_true")]
    pub human_input_profile: bool,
    /// Treat real hardware Escape keydowns as an abort signal for in-flight
    /// desktop automation. Our own synthesized Escapes are always excluded.
    #[serde(default = "app_utils::default_true")]
    pub escape_abort: bool,
}

impl Default for DesktopConfig {
    fn default() -> Self {
        Self {
            hide_before_action: true,
            anti_detection: true,
            human_input_profile: true,
            escape_abort: true,
        }
    }
}

fn desktop_config_path() -> std::path::PathBuf {
    app_paths::orgii_root().join("data/desktop_config.json")
}

fn parse_desktop_config_content(content: &str, source: &str) -> Result<DesktopConfig, String> {
    serde_json::from_str(content)
        .map_err(|err| format!("Failed to parse desktop config {}: {}", source, err))
}

fn load_desktop_config_from(path: &std::path::Path) -> Result<DesktopConfig, String> {
    match std::fs::read_to_string(path) {
        Ok(data) => parse_desktop_config_content(&data, &path.display().to_string()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(DesktopConfig::default()),
        Err(err) => Err(format!(
            "Failed to read desktop config {}: {}",
            path.display(),
            err
        )),
    }
}

/// Load the current desktop safety config. Missing file means defaults;
/// existing but unreadable/malformed config is an error.
pub(crate) fn load_desktop_config() -> Result<DesktopConfig, String> {
    load_desktop_config_from(&desktop_config_path())
}

fn save_desktop_config(config: &DesktopConfig) -> Result<(), String> {
    let path = desktop_config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let data = serde_json::to_string_pretty(config).map_err(|err| err.to_string())?;
    std::fs::write(&path, data).map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn agent_get_desktop_config() -> Result<DesktopConfig, String> {
    load_desktop_config()
}

#[tauri::command]
pub async fn agent_set_desktop_config(config: DesktopConfig) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        crate::tools::impls::desktop::escape_hotkey::set_enabled(config.escape_abort);
    }
    save_desktop_config(&config)?;
    info!(
        "[desktop] Updated desktop config: hide_before_action={}, anti_detection={}, human_input_profile={}, escape_abort={}",
        config.hide_before_action,
        config.anti_detection,
        config.human_input_profile,
        config.escape_abort
    );
    Ok(())
}

/// Single source of truth for the desktop permission names exposed by
/// `agent_check_desktop_permissions` / `agent_request_desktop_permissions`.
///
/// Wire format is the Title-Case display name (`"Accessibility"`,
/// `"Screen Recording"`) — that string is also surfaced in the UI, so we
/// keep the variant names matching the wire form via `serde(rename)`.
/// Anything that needs to compare permission names should construct or
/// match this enum instead of comparing raw strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DesktopPermissionName {
    #[serde(rename = "Accessibility")]
    Accessibility,
    #[serde(rename = "Screen Recording")]
    ScreenRecording,
}

impl DesktopPermissionName {
    pub fn as_str(self) -> &'static str {
        match self {
            DesktopPermissionName::Accessibility => "Accessibility",
            DesktopPermissionName::ScreenRecording => "Screen Recording",
        }
    }

    pub fn from_wire(value: &str) -> Option<Self> {
        match value {
            "Accessibility" => Some(DesktopPermissionName::Accessibility),
            "Screen Recording" => Some(DesktopPermissionName::ScreenRecording),
            _ => None,
        }
    }

    fn grant_instructions(self) -> &'static str {
        match self {
            DesktopPermissionName::Accessibility => {
                "Open System Settings → Privacy & Security → Accessibility → Enable for this app"
            }
            DesktopPermissionName::ScreenRecording => {
                "Open System Settings → Privacy & Security → Screen Recording → Enable for this app"
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn permission_status_json(name: DesktopPermissionName, granted: bool) -> serde_json::Value {
    serde_json::json!({
        "name": name.as_str(),
        "granted": granted,
        "required": true,
        "grantInstructions": name.grant_instructions(),
    })
}

#[tauri::command]
pub async fn agent_check_desktop_permissions() -> Result<Vec<serde_json::Value>, String> {
    #[cfg(target_os = "macos")]
    {
        let permissions = crate::tools::impls::desktop::permissions::check_permissions();
        Ok(vec![
            permission_status_json(
                DesktopPermissionName::Accessibility,
                permissions.accessibility,
            ),
            permission_status_json(
                DesktopPermissionName::ScreenRecording,
                permissions.screen_recording,
            ),
        ])
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(vec![])
    }
}

#[tauri::command]
pub async fn agent_request_desktop_permissions(
    permission: String,
) -> Result<serde_json::Value, String> {
    let parsed = DesktopPermissionName::from_wire(&permission).ok_or_else(|| {
        format!(
            "Unknown desktop permission: {permission:?}. Expected one of: {:?}, {:?}",
            DesktopPermissionName::Accessibility.as_str(),
            DesktopPermissionName::ScreenRecording.as_str(),
        )
    })?;

    #[cfg(target_os = "macos")]
    {
        use crate::tools::impls::desktop::permissions;

        match parsed {
            DesktopPermissionName::Accessibility => {
                let granted = permissions::request_accessibility();
                info!(
                    "[agent] Accessibility prompt triggered, currently granted: {}",
                    granted
                );
            }
            DesktopPermissionName::ScreenRecording => {
                let granted = permissions::request_screen_recording();
                info!(
                    "[agent] Screen Recording prompt triggered, granted: {}",
                    granted
                );
            }
        }

        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        let permissions = permissions::check_permissions();
        let permissions_list = vec![
            permission_status_json(
                DesktopPermissionName::Accessibility,
                permissions.accessibility,
            ),
            permission_status_json(
                DesktopPermissionName::ScreenRecording,
                permissions.screen_recording,
            ),
        ];

        Ok(serde_json::json!({
            "triggered": true,
            "permissions": permissions_list,
        }))
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = parsed;
        Ok(serde_json::json!({
            "triggered": false,
            "permissions": [],
        }))
    }
}

#[cfg(debug_assertions)]
#[doc(hidden)]
pub fn debug_parse_desktop_config(content: &str) -> Result<DesktopConfig, String> {
    parse_desktop_config_content(content, "debug payload")
}

#[cfg(test)]
mod tests {
    use super::{load_desktop_config_from, DesktopConfig};

    #[test]
    fn load_desktop_config_missing_file_returns_defaults() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("missing.json");

        let config = load_desktop_config_from(&path).expect("missing file returns defaults");

        assert_eq!(
            config.hide_before_action,
            DesktopConfig::default().hide_before_action
        );
        assert_eq!(
            config.anti_detection,
            DesktopConfig::default().anti_detection
        );
        assert_eq!(
            config.human_input_profile,
            DesktopConfig::default().human_input_profile
        );
    }

    #[test]
    fn load_desktop_config_invalid_json_returns_err() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("desktop_config.json");
        std::fs::write(&path, "{ invalid").expect("write invalid config");

        let err = load_desktop_config_from(&path).unwrap_err();

        assert!(err.contains("Failed to parse desktop config"), "got: {err}");
    }
}

//! LSP/Lint Install/Uninstall Commands
//!
//! Tauri commands for generating install and uninstall commands
//! for language servers and lint tools.

use super::package_manager::{
    detect_install_type, detect_package_manager, detect_package_manager_uninstall,
    extract_package_name,
};
use crate::lint_tools::get_lint_tool_install_hint;
use crate::server_defs::servers_for_language_id;

/// Resolve the install hint for a given language by looking up its first
/// matching server definition. Returns the hint or an "unsupported language"
/// error string suitable for surfacing to the frontend.
fn install_hint_for_language(language: &str) -> Result<String, String> {
    servers_for_language_id(language)
        .first()
        .map(|server_def| server_def.install_hint())
        .ok_or_else(|| {
            format!(
                "Unsupported language: {}. See LSP documentation for supported languages.",
                language
            )
        })
}

/// Install command result
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallCommandResult {
    /// The full command to run in terminal
    pub command: String,
    /// Whether a suitable package manager was found
    pub package_manager_found: bool,
    /// Error message if any
    pub error: Option<String>,
}

/// Uninstall command result
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallCommandResult {
    /// The full command to run in terminal
    pub command: String,
    /// Whether a suitable package manager was found
    pub package_manager_found: bool,
    /// Whether uninstall is supported for this tool
    pub uninstall_supported: bool,
    /// Error message if any
    pub error: Option<String>,
}

/// Get the install command for a language server
/// Returns the command that should be executed in a terminal
#[tauri::command]
pub fn lsp_get_install_command(language: String) -> InstallCommandResult {
    let install_hint = match install_hint_for_language(&language) {
        Ok(hint) => hint,
        Err(err) => {
            return InstallCommandResult {
                command: String::new(),
                package_manager_found: false,
                error: Some(err),
            };
        }
    };

    let install_hint: &str = &install_hint;
    let install_type = detect_install_type(install_hint);

    // If it's an unknown type, don't try to execute as a command
    // The hint is likely informational text (e.g., "Install from <url>")
    if install_type == "unknown" {
        return InstallCommandResult {
            command: String::new(),
            package_manager_found: false,
            error: Some(format!("Manual installation required: {}", install_hint)),
        };
    }

    // Try to detect the package manager
    let pm = match detect_package_manager(install_type) {
        Some(pm) => pm,
        None => {
            return InstallCommandResult {
                command: install_hint.to_string(),
                package_manager_found: false,
                error: Some(format!(
                    "No {} package manager found. Install hint: {}",
                    install_type, install_hint
                )),
            };
        }
    };

    // Extract the package name and build the command
    let package = match extract_package_name(install_hint) {
        Some(p) => p,
        None => {
            return InstallCommandResult {
                command: install_hint.to_string(),
                package_manager_found: true,
                error: None,
            };
        }
    };

    // Build the install command
    let mut cmd_parts = vec![pm.command];
    cmd_parts.extend(pm.install_args);
    cmd_parts.push(&package);

    InstallCommandResult {
        command: cmd_parts.join(" "),
        package_manager_found: true,
        error: None,
    }
}

/// Get the uninstall command for a language server
#[tauri::command]
pub fn lsp_get_uninstall_command(language: String) -> UninstallCommandResult {
    let install_hint = match install_hint_for_language(&language) {
        Ok(hint) => hint,
        Err(err) => {
            return UninstallCommandResult {
                command: String::new(),
                package_manager_found: false,
                uninstall_supported: false,
                error: Some(err),
            };
        }
    };

    let install_hint: &str = &install_hint;
    let install_type = detect_install_type(install_hint);

    // If it's an unknown type, uninstall is not supported
    if install_type == "unknown" {
        return UninstallCommandResult {
            command: String::new(),
            package_manager_found: false,
            uninstall_supported: false,
            error: Some(format!(
                "Uninstall not supported. Original install method: {}",
                install_hint
            )),
        };
    }

    // Go install doesn't have a standard uninstall
    if install_type == "go" {
        return UninstallCommandResult {
            command: String::new(),
            package_manager_found: true,
            uninstall_supported: false,
            error: Some("Go packages must be manually removed from GOPATH/bin".to_string()),
        };
    }

    // Try to detect the package manager for uninstall
    let pm = match detect_package_manager_uninstall(install_type) {
        Some(pm) => pm,
        None => {
            return UninstallCommandResult {
                command: String::new(),
                package_manager_found: false,
                uninstall_supported: false,
                error: Some(format!(
                    "No {} package manager found for uninstall",
                    install_type
                )),
            };
        }
    };

    // Extract the package name
    let package = match extract_package_name(install_hint) {
        Some(p) => p,
        None => {
            return UninstallCommandResult {
                command: String::new(),
                package_manager_found: true,
                uninstall_supported: false,
                error: Some("Could not extract package name from install hint".to_string()),
            };
        }
    };

    // Build the uninstall command
    let mut cmd_parts = vec![pm.command];
    cmd_parts.extend(pm.uninstall_args);
    cmd_parts.push(&package);

    UninstallCommandResult {
        command: cmd_parts.join(" "),
        package_manager_found: true,
        uninstall_supported: true,
        error: None,
    }
}

/// Get the install command for a lint tool
#[tauri::command]
pub fn lint_get_install_command(tool_id: String) -> InstallCommandResult {
    // Get the install hint for this tool
    let install_hint = match get_lint_tool_install_hint(&tool_id) {
        Some(hint) => hint,
        None => {
            return InstallCommandResult {
                command: String::new(),
                package_manager_found: false,
                error: Some(format!("Unknown lint tool: {}", tool_id)),
            };
        }
    };

    let install_type = detect_install_type(install_hint);

    // If it's an unknown type, don't try to execute as a command
    if install_type == "unknown" {
        return InstallCommandResult {
            command: String::new(),
            package_manager_found: false,
            error: Some(format!("Manual installation required: {}", install_hint)),
        };
    }

    // Try to detect the package manager
    let pm = match detect_package_manager(install_type) {
        Some(pm) => pm,
        None => {
            return InstallCommandResult {
                command: install_hint.to_string(),
                package_manager_found: false,
                error: Some(format!(
                    "No {} package manager found. Install hint: {}",
                    install_type, install_hint
                )),
            };
        }
    };

    // Extract the package name and build the command
    let package = match extract_package_name(install_hint) {
        Some(p) => p,
        None => {
            return InstallCommandResult {
                command: install_hint.to_string(),
                package_manager_found: true,
                error: None,
            };
        }
    };

    // Build the install command
    let mut cmd_parts = vec![pm.command];
    cmd_parts.extend(pm.install_args);
    cmd_parts.push(&package);

    InstallCommandResult {
        command: cmd_parts.join(" "),
        package_manager_found: true,
        error: None,
    }
}

/// Get the uninstall command for a lint tool
#[tauri::command]
pub fn lint_get_uninstall_command(tool_id: String) -> UninstallCommandResult {
    // Get the install hint for this tool
    let install_hint = match get_lint_tool_install_hint(&tool_id) {
        Some(hint) => hint,
        None => {
            return UninstallCommandResult {
                command: String::new(),
                package_manager_found: false,
                uninstall_supported: false,
                error: Some(format!("Unknown lint tool: {}", tool_id)),
            };
        }
    };

    let install_type = detect_install_type(install_hint);

    // If it's an unknown type, uninstall is not supported
    if install_type == "unknown" {
        return UninstallCommandResult {
            command: String::new(),
            package_manager_found: false,
            uninstall_supported: false,
            error: Some(format!(
                "Uninstall not supported. Original install method: {}",
                install_hint
            )),
        };
    }

    // Go install doesn't have a standard uninstall
    if install_type == "go" {
        return UninstallCommandResult {
            command: String::new(),
            package_manager_found: true,
            uninstall_supported: false,
            error: Some("Go packages must be manually removed from GOPATH/bin".to_string()),
        };
    }

    // Try to detect the package manager for uninstall
    let pm = match detect_package_manager_uninstall(install_type) {
        Some(pm) => pm,
        None => {
            return UninstallCommandResult {
                command: String::new(),
                package_manager_found: false,
                uninstall_supported: false,
                error: Some(format!(
                    "No {} package manager found for uninstall",
                    install_type
                )),
            };
        }
    };

    // Extract the package name
    let package = match extract_package_name(install_hint) {
        Some(p) => p,
        None => {
            return UninstallCommandResult {
                command: String::new(),
                package_manager_found: true,
                uninstall_supported: false,
                error: Some("Could not extract package name from install hint".to_string()),
            };
        }
    };

    // Build the uninstall command
    let mut cmd_parts = vec![pm.command];
    cmd_parts.extend(pm.uninstall_args);
    cmd_parts.push(&package);

    UninstallCommandResult {
        command: cmd_parts.join(" "),
        package_manager_found: true,
        uninstall_supported: true,
        error: None,
    }
}

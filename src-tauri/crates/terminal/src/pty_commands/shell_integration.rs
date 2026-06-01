//! Shell integration injection.
//!
//! Writes OSC 633 integration scripts to a temp directory and returns
//! the environment / argument modifications needed to activate them
//! for a given shell kind.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tracing::warn;

use super::shells::ShellKind;

// Embed scripts at compile time so they ship inside the binary.
const ZSH_SCRIPT: &str = include_str!("integration_scripts/shellIntegration.zsh");
const BASH_SCRIPT: &str = include_str!("integration_scripts/shellIntegration.bash");
const FISH_SCRIPT: &str = include_str!("integration_scripts/shellIntegration.fish");
const PWSH_SCRIPT: &str = include_str!("integration_scripts/shellIntegration.ps1");

/// Modifications that `create_session` should apply to the CommandBuilder.
#[derive(Debug, Clone)]
pub struct IntegrationConfig {
    /// Environment variables to set (key, value).
    pub env_vars: Vec<(String, String)>,
    /// Arguments to prepend before the shell's own args.
    pub prepend_args: Vec<String>,
    /// If true, remove `--login` / `-l` from the default args
    /// (bash needs non-login mode for `--init-file` to work).
    pub strip_login_args: bool,
}

// ---------------------------------------------------------------------------
// Temp directory (created once per process)
// ---------------------------------------------------------------------------

static INTEGRATION_DIR: OnceLock<Option<PathBuf>> = OnceLock::new();

fn get_integration_dir() -> Option<&'static Path> {
    INTEGRATION_DIR
        .get_or_init(|| match setup_integration_dir() {
            Ok(dir) => Some(dir),
            Err(err) => {
                warn!("Shell integration setup failed: {err}");
                None
            }
        })
        .as_deref()
}

fn setup_integration_dir() -> Result<PathBuf, String> {
    let base = std::env::temp_dir().join("orgii-shell-integration");

    std::fs::create_dir_all(&base).map_err(|err| format!("mkdir {}: {err}", base.display()))?;

    write_if_changed(&base.join("shellIntegration.zsh"), ZSH_SCRIPT)?;
    write_if_changed(&base.join("shellIntegration.bash"), BASH_SCRIPT)?;
    write_if_changed(&base.join("shellIntegration.fish"), FISH_SCRIPT)?;
    write_if_changed(&base.join("shellIntegration.ps1"), PWSH_SCRIPT)?;

    setup_zsh_zdotdir(&base)?;

    Ok(base)
}

/// Only write the file if it doesn't exist or its content differs.
fn write_if_changed(path: &Path, content: &str) -> Result<(), String> {
    if let Ok(existing) = std::fs::read_to_string(path) {
        if existing == content {
            return Ok(());
        }
    }
    std::fs::write(path, content).map_err(|err| format!("write {}: {err}", path.display()))
}

// ---------------------------------------------------------------------------
// zsh ZDOTDIR wrapper
// ---------------------------------------------------------------------------

fn setup_zsh_zdotdir(base: &Path) -> Result<(), String> {
    let zsh_dir = base.join("zsh");
    std::fs::create_dir_all(&zsh_dir)
        .map_err(|err| format!("mkdir {}: {err}", zsh_dir.display()))?;

    let integration_path = base.join("shellIntegration.zsh");

    let zshenv = r#"# Orgii ZDOTDIR wrapper — restore user env and source integration.
if [[ -n "$USER_ZDOTDIR" ]]; then
    ZDOTDIR="$USER_ZDOTDIR"
else
    ZDOTDIR="$HOME"
fi
[[ -f "$ZDOTDIR/.zshenv" ]] && . "$ZDOTDIR/.zshenv"
"#;

    let zshrc = format!(
        r#"# Orgii ZDOTDIR wrapper — source user rc then install hooks.
if [[ -n "$USER_ZDOTDIR" ]]; then
    ZDOTDIR="$USER_ZDOTDIR"
else
    ZDOTDIR="$HOME"
fi
[[ -f "$ZDOTDIR/.zshrc" ]] && . "$ZDOTDIR/.zshrc"
. "{integration}"
"#,
        integration = integration_path.display()
    );

    write_if_changed(&zsh_dir.join(".zshenv"), zshenv)?;
    write_if_changed(&zsh_dir.join(".zshrc"), &zshrc)?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Return the integration config for a shell kind, or `None` when
/// shell integration is not supported or the temp dir failed to set up.
pub fn integration_config(kind: &ShellKind) -> Option<IntegrationConfig> {
    let base = get_integration_dir()?;

    match kind {
        ShellKind::Zsh => {
            let zdotdir = base.join("zsh");
            let user_zdotdir = dirs::home_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            Some(IntegrationConfig {
                env_vars: vec![
                    ("ZDOTDIR".into(), zdotdir.to_string_lossy().into_owned()),
                    ("USER_ZDOTDIR".into(), user_zdotdir),
                ],
                prepend_args: vec![],
                strip_login_args: false,
            })
        }

        ShellKind::Bash => {
            let init_file = base.join("shellIntegration.bash");
            Some(IntegrationConfig {
                env_vars: vec![],
                prepend_args: vec![
                    "--init-file".into(),
                    init_file.to_string_lossy().into_owned(),
                ],
                strip_login_args: true,
            })
        }

        ShellKind::Fish => {
            let script = base.join("shellIntegration.fish");
            let source_cmd = format!("source \"{}\"", script.display());
            Some(IntegrationConfig {
                env_vars: vec![],
                prepend_args: vec!["--init-command".into(), source_cmd],
                strip_login_args: false,
            })
        }

        ShellKind::Pwsh => {
            let script = base.join("shellIntegration.ps1");
            let dot_cmd = format!(". \"{}\"", script.display());
            Some(IntegrationConfig {
                env_vars: vec![],
                prepend_args: vec!["-noexit".into(), "-command".into(), dot_cmd],
                strip_login_args: false,
            })
        }

        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
#[path = "tests/shell_integration_tests.rs"]
mod tests;

//! Desktop tool registration for bundled Peekaboo CLI automation.

use std::collections::HashSet;

use crate::tools::impls::desktop::PeekabooCliTool;
use crate::tools::registry::ToolRegistry;

use super::{register_if_enabled, ToolDeps};

/// Register desktop automation tools when the platform and session config support them.
pub fn register(registry: &mut ToolRegistry, deps: &ToolDeps, disabled: &HashSet<String>) {
    if !deps.desktop_enabled || !cfg!(target_os = "macos") {
        return;
    }

    register_if_enabled(
        registry,
        Box::new(PeekabooCliTool::new(deps.app_handle.clone())),
        disabled,
    );
}

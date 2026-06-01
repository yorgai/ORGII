//! Node command policy: allowed commands per platform.
//!
//! Defines which node commands are permitted by default and per-platform.
//! Commands not in the allowlist are rejected before being sent to the node.

/// Default allowed commands for all platforms.
pub const DEFAULT_ALLOWED_COMMANDS: &[&str] = &[
    // Canvas
    "canvas.present",
    "canvas.hide",
    "canvas.navigate",
    "canvas.eval",
    "canvas.snapshot",
    "canvas.a2ui.pushJSONL",
    "canvas.a2ui.reset",
    // Camera
    "camera.list",
    "camera.snap",
    "camera.clip",
    // Screen
    "screen.record",
    // Location
    "location.get",
    // System
    "system.run",
    "system.notify",
    "system.which",
];

/// Check if a command is allowed for a given platform.
///
/// If `custom_allowlist` is non-empty, it overrides the defaults.
pub fn is_command_allowed(
    command: &str,
    _platform: Option<&str>,
    custom_allowlist: &[String],
) -> bool {
    if !custom_allowlist.is_empty() {
        return custom_allowlist.iter().any(|allowed| allowed == command);
    }

    DEFAULT_ALLOWED_COMMANDS.contains(&command)
}

#[cfg(test)]
#[path = "tests/command_policy_tests.rs"]
mod tests;

//! Display enumeration helpers shared by the panel and the bar window.
//!
//! Coordinates and sizes are exposed to the UI in *logical* pixels
//! (i.e. physical / scale_factor), which is what Tauri's `set_position` /
//! `set_size` expect.

use tracing::warn;

/// Public description of a single connected display, safe to ship to the UI.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WingmanMonitorInfo {
    /// 0-based index into `AppHandle::available_monitors()`. The UI passes this
    /// index back to `open_wingman_window` to target a specific display.
    pub index: usize,
    pub name: String,
    /// Top-left corner of the full screen rect (logical px).
    pub x: f64,
    pub y: f64,
    /// Full screen size (logical px, incl. menu bar + Dock area).
    pub width: f64,
    pub height: f64,
    /// Work area = visible rect excluding menu bar + Dock.
    pub work_x: f64,
    pub work_y: f64,
    pub work_width: f64,
    pub work_height: f64,
    pub scale_factor: f64,
    pub is_primary: bool,
}

/// Enumerate every connected display as `WingmanMonitorInfo`.
pub(crate) fn list_monitors(app_handle: &tauri::AppHandle) -> Vec<WingmanMonitorInfo> {
    let monitors = match app_handle.available_monitors() {
        Ok(m) => m,
        Err(e) => {
            warn!("[wingman] available_monitors() error: {}", e);
            return Vec::new();
        }
    };
    let primary_name = app_handle
        .primary_monitor()
        .ok()
        .flatten()
        .and_then(|m| m.name().cloned());

    monitors
        .into_iter()
        .enumerate()
        .map(|(i, m)| {
            let scale = m.scale_factor();
            let pos = m.position();
            let size = m.size();
            let work = m.work_area();
            let name = m
                .name()
                .cloned()
                .unwrap_or_else(|| format!("Screen {}", i + 1));
            let is_primary = primary_name.as_ref().is_some_and(|p| p == &name);
            WingmanMonitorInfo {
                index: i,
                name,
                x: pos.x as f64 / scale,
                y: pos.y as f64 / scale,
                width: size.width as f64 / scale,
                height: size.height as f64 / scale,
                work_x: work.position.x as f64 / scale,
                work_y: work.position.y as f64 / scale,
                work_width: work.size.width as f64 / scale,
                work_height: work.size.height as f64 / scale,
                scale_factor: scale,
                is_primary,
            }
        })
        .collect()
}

/// Resolve a monitor by index, falling back to the primary monitor, then any
/// available monitor. Returns `None` only if no displays are reported at all.
pub(crate) fn resolve_monitor(
    app_handle: &tauri::AppHandle,
    index: Option<usize>,
) -> Option<tauri::Monitor> {
    let monitors = app_handle.available_monitors().ok()?;
    if let Some(i) = index {
        if let Some(m) = monitors.get(i) {
            return Some(m.clone());
        }
        warn!(
            "[wingman] monitor index {} out of range (have {}) — falling back to primary",
            i,
            monitors.len()
        );
    }
    if let Ok(Some(m)) = app_handle.primary_monitor() {
        return Some(m);
    }
    monitors.into_iter().next()
}

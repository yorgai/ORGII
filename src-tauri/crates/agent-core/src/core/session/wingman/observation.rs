//! Per-cycle observation helpers: prompt assembly + screenshot capture.
//!
//! These are the two small pure-ish helpers the Wingman loop calls once per
//! observation tick. Split out of `wingman.rs` so the core loop file stays
//! focused on scheduling.

/// Build the per-cycle observation prompt sent to the LLM.
pub(super) fn build_observation_prompt(
    mission: &str,
    flow_context: &str,
    has_screenshot: bool,
) -> String {
    let mut parts = Vec::new();

    parts.push(format!(
        "## Wingman Observation Cycle\n\nYour mission: {mission}"
    ));

    if !flow_context.is_empty() {
        parts.push(flow_context.to_string());
    }

    let screenshot_note = if has_screenshot {
        "A screenshot of the current screen is attached as an image in this message — look at it directly. \
         If you need exact UI targets, call `control_desktop_with_peekaboo` with a Peekaboo inspection command such as `see --json` or a scoped `see` variant."
    } else {
        "No screenshot was available this cycle. \
         Call `control_desktop_with_peekaboo` with `see --json` if you need to inspect the screen, \
         or base your observation on the activity context above."
    };

    parts.push(format!(
        "{screenshot_note}\n\n\
         Review the screen and activity context against your mission. \
         Respond with a brief nudge (1–3 sentences) if you notice something worth flagging, \
         or exactly `[no change]` if everything looks fine."
    ));

    parts.join("\n\n")
}

/// Capture a screenshot of the main display using native ScreenCaptureKit.
///
/// Returns a PNG base64 string on success.
pub(super) async fn capture_screenshot() -> Result<String, String> {
    use crate::tools::impls::desktop::screen_capture;

    let png_bytes = tokio::task::spawn_blocking(screen_capture::capture_screen_png)
        .await
        .map_err(|e| format!("screenshot join: {e}"))?
        .map_err(|e| format!("screenshot: {e}"))?;

    Ok(screen_capture::png_to_base64(&png_bytes))
}

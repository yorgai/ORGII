//! Screenshot capture using CGWindowList / CGDisplay (macOS 10.5+).
//!
//! Split into per-concern submodules so each file is small and focused
//! on a single Core Graphics surface area:
//!
//! - `displays` — `CGDisplay*` enumeration + `DisplayInfo` (id, bounds,
//!   pixel size, scale_factor)
//! - `png` — `CGDisplayCreateImage` / `CGWindowListCreateImage` → PNG via
//!   ImageIO. Lossless path used when callers want byte-perfect results.
//! - `jpeg` — `CGDisplayCreateImage` + `CGImageCreateWithImageInRect` →
//!   downscaled JPEG via ImageIO. Lossy path used for LLM image inputs;
//!   includes the per-display crop fidelity logic.
//! - `windows` — `CGWindowListCopyWindowInfo` walk + `find_window_for_pid`
//!   resolution cascade.
//! - `dict_helpers` — typed `CFDictionary` accessors used by `windows`.

mod dict_helpers;
mod displays;
mod jpeg;
mod png;
mod windows;

// Items kept at the `screen_capture::` surface — checked one by one
// against real call sites. `DisplayInfo` and `WindowInfo` types,
// `main_display_size`, `capture_display_png`, and `get_on_screen_windows`
// are reached only through the deeper `displays::` / `png::` / `windows::`
// segment by siblings, so we don't flatten them. `capture_display_jpeg`,
// `capture_region_jpeg`, and `capture_screen_jpeg` had no callers at all
// and were removed from `jpeg.rs`.
pub use displays::{display_for_point, list_displays, main_display_id};
pub use jpeg::{capture_display_jpeg_sized, capture_region_jpeg_sized};
pub use png::{capture_screen_png, capture_window_png, png_to_base64};
pub use windows::{find_window_for_pid, find_window_info_for_pid};

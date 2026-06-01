//! Display enumeration and lookup helpers (CGDisplay* APIs).
//!
//! Wraps `CGGetActiveDisplayList`, `CGDisplayBounds`, `CGDisplayPixels{Wide,High}`,
//! and `CGMainDisplayID` into a `DisplayInfo` row that carries the global rect,
//! native pixel size, and `pixel/point` scale factor on a single struct.

use core_graphics::geometry::CGRect;

/// Metadata for one connected display.
#[derive(Debug, Clone)]
pub struct DisplayInfo {
    pub id: u32,
    pub is_main: bool,
    pub bounds: CGRect,   // global screen-point rect (top-left origin CG space)
    pub pixel_width: u32, // native pixel width (retina: 2x logical)
    pub pixel_height: u32,
    pub scale_factor: f64, // pixel / point ratio (1.0 or 2.0 typically)
}

/// Get the main display's ID.
pub fn main_display_id() -> u32 {
    extern "C" {
        fn CGMainDisplayID() -> u32;
    }
    unsafe { CGMainDisplayID() }
}

/// Enumerate all active (powered-on) displays.
pub fn list_displays() -> Vec<DisplayInfo> {
    extern "C" {
        fn CGGetActiveDisplayList(
            max_displays: u32,
            active_displays: *mut u32,
            display_count: *mut u32,
        ) -> i32;
        fn CGMainDisplayID() -> u32;
        fn CGDisplayBounds(display: u32) -> CGRect;
        fn CGDisplayPixelsWide(display: u32) -> usize;
        fn CGDisplayPixelsHigh(display: u32) -> usize;
    }

    unsafe {
        let mut ids = [0u32; 16];
        let mut count: u32 = 0;
        let err = CGGetActiveDisplayList(16, ids.as_mut_ptr(), &mut count);
        if err != 0 || count == 0 {
            return Vec::new();
        }
        let main_id = CGMainDisplayID();
        ids[..count as usize]
            .iter()
            .map(|&id| {
                let bounds = CGDisplayBounds(id);
                let pw = CGDisplayPixelsWide(id) as u32;
                let ph = CGDisplayPixelsHigh(id) as u32;
                let scale = if bounds.size.width > 0.0 {
                    pw as f64 / bounds.size.width
                } else {
                    1.0
                };
                DisplayInfo {
                    id,
                    is_main: id == main_id,
                    bounds,
                    pixel_width: pw,
                    pixel_height: ph,
                    scale_factor: scale,
                }
            })
            .collect()
    }
}

/// Find the display whose bounds contain the given global CG point.
/// Returns the main display as fallback.
pub fn display_for_point(x: f64, y: f64) -> u32 {
    for d in list_displays() {
        if x >= d.bounds.origin.x
            && x < d.bounds.origin.x + d.bounds.size.width
            && y >= d.bounds.origin.y
            && y < d.bounds.origin.y + d.bounds.size.height
        {
            return d.id;
        }
    }
    main_display_id()
}

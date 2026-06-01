//! `CGWindowList`-backed window enumeration and PID-to-window resolution.
//!
//! `find_window_for_pid` and `find_window_info_for_pid` are the two public
//! callers — both walk the `CGWindowListCopyWindowInfo` snapshot to map
//! a process to its frontmost-app window. The resolution cascade prefers
//! the AX-resolved `CGWindowID` hint (via `_AXUIElementGetWindow`); if
//! that's unset or invalidated, it falls back to a title + layer + area
//! score that mirrors the legacy heuristic.

use core_foundation::base::TCFType;
use core_foundation::dictionary::CFDictionary;
use core_graphics::geometry::CGRect;
use std::ffi::c_void;

use super::dict_helpers::{dict_get_i32, dict_get_rect, dict_get_string};

/// Window info entry from CGWindowListCopyWindowInfo.
#[derive(Debug)]
pub struct WindowInfo {
    pub window_id: u32,
    pub pid: Option<i32>,
    pub name: Option<String>,
    pub layer: i32,
    pub bounds: CGRect,
}

/// Find the on-screen window for a given PID.
///
/// Resolution cascade, highest-confidence first:
///
///   1. **`cg_window_id_hint`** — if the AX tree walker resolved the
///      focused/main window to a CGWindowID via `_AXUIElementGetWindow`,
///      we match it directly. Zero ambiguity; short-circuits the scoring.
///   2. **Title hint + layer + area scoring** — legacy heuristic for
///      when the private API returned nothing (sandboxed apps, some
///      fullscreen presentations). Title match adds +100; layer==0
///      (normal app window) adds +1000; larger area breaks ties.
///
/// Returns `(window_id, bounds)` or `None` when no CGWindowList entry
/// belongs to the PID.
pub fn find_window_for_pid(
    pid: i32,
    cg_window_id_hint: Option<u32>,
    title_hint: Option<&str>,
) -> Option<(u32, CGRect)> {
    let window_list = get_on_screen_windows()?;

    // Fast path: the AX tree told us exactly which window it walked.
    // Short-circuit the scoring — an ID match is infinitely better
    // than a title substring in multi-document apps.
    if let Some(target_id) = cg_window_id_hint {
        for entry in &window_list {
            if entry.pid == Some(pid) && entry.window_id == target_id {
                return Some((entry.window_id, entry.bounds));
            }
        }
        // Hint didn't correlate (window may have closed between the
        // AX walk and the CGWindowList read). Fall through to the
        // heuristic rather than returning None — the heuristic's
        // still better than nothing.
    }

    let mut best: Option<(u32, CGRect, i32)> = None;

    for entry in &window_list {
        // System-owned windows (WindowServer, menu-bar overlays, Spaces
        // transitions) have no `kCGWindowOwnerPID`. Skipping them with
        // `continue` — NOT `?` — is load-bearing: a bare `?` would exit
        // the whole function on the first such entry and silently drop
        // every remaining candidate, including the one belonging to us.
        let Some(entry_pid) = entry.pid else {
            continue;
        };
        if entry_pid != pid {
            continue;
        }

        let mut score: i32 = 0;
        if let Some(hint) = title_hint {
            if let Some(ref name) = entry.name {
                if name.contains(hint) {
                    score += 100;
                }
            }
        }

        let area = entry.bounds.size.width * entry.bounds.size.height;
        score += area as i32;

        if entry.layer == 0 {
            score += 1000;
        }

        match &best {
            Some((_, _, best_score)) if *best_score >= score => {}
            _ => {
                best = Some((entry.window_id, entry.bounds, score));
            }
        }
    }

    best.map(|(wid, bounds, _)| (wid, bounds))
}

/// Like [`find_window_for_pid`] but returns the full [`WindowInfo`]
/// entry instead of just `(window_id, bounds)`. Used by the worker
/// dispatch to populate [`WireWindowInfo`] with accurate metadata
/// (layer, name) without changing the existing function's return type.
///
/// [`WireWindowInfo`]:
///     crate::core::tools::impls::desktop::worker::proto::WireWindowInfo
pub fn find_window_info_for_pid(
    pid: i32,
    cg_window_id_hint: Option<u32>,
    title_hint: Option<&str>,
) -> Option<WindowInfo> {
    let window_list = get_on_screen_windows()?;

    if let Some(target_id) = cg_window_id_hint {
        for entry in &window_list {
            if entry.pid == Some(pid) && entry.window_id == target_id {
                return Some(WindowInfo {
                    window_id: entry.window_id,
                    pid: entry.pid,
                    name: entry.name.clone(),
                    layer: entry.layer,
                    bounds: entry.bounds,
                });
            }
        }
    }

    let mut best: Option<(&WindowInfo, i32)> = None;
    for entry in &window_list {
        let Some(entry_pid) = entry.pid else {
            continue;
        };
        if entry_pid != pid {
            continue;
        }
        let mut score: i32 = 0;
        if let Some(hint) = title_hint {
            if let Some(ref name) = entry.name {
                if name.contains(hint) {
                    score += 100;
                }
            }
        }
        score += entry.bounds.size.width as i32 * entry.bounds.size.height as i32;
        if entry.layer == 0 {
            score += 1000;
        }
        match best {
            Some((_, best_score)) if best_score >= score => {}
            _ => best = Some((entry, score)),
        }
    }

    best.map(|(entry, _)| WindowInfo {
        window_id: entry.window_id,
        pid: entry.pid,
        name: entry.name.clone(),
        layer: entry.layer,
        bounds: entry.bounds,
    })
}

/// Get all on-screen windows via CGWindowListCopyWindowInfo.
pub fn get_on_screen_windows() -> Option<Vec<WindowInfo>> {
    extern "C" {
        fn CGWindowListCopyWindowInfo(option: u32, relative_to_window: u32) -> *const c_void;
        fn CFArrayGetCount(array: *const c_void) -> isize;
        fn CFArrayGetValueAtIndex(array: *const c_void, idx: isize) -> *const c_void;
    }

    let array_ref = unsafe { CGWindowListCopyWindowInfo(1, 0) };
    if array_ref.is_null() {
        return None;
    }

    let zero_rect = CGRect::new(
        &core_graphics::geometry::CGPoint::new(0.0, 0.0),
        &core_graphics::geometry::CGSize::new(0.0, 0.0),
    );

    unsafe {
        let count = CFArrayGetCount(array_ref);
        let mut windows = Vec::with_capacity(count as usize);

        for idx in 0..count {
            let dict_ref = CFArrayGetValueAtIndex(array_ref, idx);
            if dict_ref.is_null() {
                continue;
            }
            let dict: CFDictionary = CFDictionary::wrap_under_get_rule(dict_ref as *const _);

            let window_id = dict_get_i32(&dict, "kCGWindowNumber").unwrap_or(0) as u32;
            let pid = dict_get_i32(&dict, "kCGWindowOwnerPID");
            let name = dict_get_string(&dict, "kCGWindowName");
            let layer = dict_get_i32(&dict, "kCGWindowLayer").unwrap_or(0);
            let bounds = dict_get_rect(&dict, "kCGWindowBounds").unwrap_or(zero_rect);

            windows.push(WindowInfo {
                window_id,
                pid,
                name,
                layer,
                bounds,
            });
        }

        core_foundation::base::CFRelease(array_ref as _);
        Some(windows)
    }
}

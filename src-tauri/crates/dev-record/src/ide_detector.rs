//! External IDE Detection
//!
//! Scans running processes to detect external code editors/IDEs using known
//! signatures, a cached `sysinfo::System`, and scan interval throttling.
//!
//! Also detects which IDE is currently frontmost (macOS only via CGWindowList).

use super::types::{ActivitySource, DetectedIde};
use std::sync::Mutex;
use std::time::Instant;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

// ============================================
// IDE Signature Definitions
// ============================================

#[derive(Clone, Copy)]
enum MatchMode {
    Exact,
    WordStart,
}

struct IdeSignature {
    name: &'static str,
    source: ActivitySource,
    mode: MatchMode,
}

const KNOWN_IDE_SIGNATURES: &[IdeSignature] = &[
    // VS Code
    IdeSignature {
        name: "code",
        source: ActivitySource::VsCode,
        mode: MatchMode::WordStart,
    },
    IdeSignature {
        name: "code helper",
        source: ActivitySource::VsCode,
        mode: MatchMode::WordStart,
    },
    IdeSignature {
        name: "code - insiders",
        source: ActivitySource::VsCode,
        mode: MatchMode::WordStart,
    },
    // Cursor (VS Code fork)
    IdeSignature {
        name: "cursor",
        source: ActivitySource::Cursor,
        mode: MatchMode::WordStart,
    },
    IdeSignature {
        name: "cursor helper",
        source: ActivitySource::Cursor,
        mode: MatchMode::WordStart,
    },
    // Trae (ByteDance VS Code fork)
    IdeSignature {
        name: "trae",
        source: ActivitySource::Trae,
        mode: MatchMode::WordStart,
    },
    IdeSignature {
        name: "trae helper",
        source: ActivitySource::Trae,
        mode: MatchMode::WordStart,
    },
    // Windsurf (Codeium VS Code fork)
    IdeSignature {
        name: "windsurf",
        source: ActivitySource::Windsurf,
        mode: MatchMode::WordStart,
    },
    IdeSignature {
        name: "windsurf helper",
        source: ActivitySource::Windsurf,
        mode: MatchMode::WordStart,
    },
    // JetBrains family
    IdeSignature {
        name: "idea",
        source: ActivitySource::JetBrains,
        mode: MatchMode::WordStart,
    },
    IdeSignature {
        name: "webstorm",
        source: ActivitySource::JetBrains,
        mode: MatchMode::WordStart,
    },
    IdeSignature {
        name: "pycharm",
        source: ActivitySource::JetBrains,
        mode: MatchMode::WordStart,
    },
    IdeSignature {
        name: "goland",
        source: ActivitySource::JetBrains,
        mode: MatchMode::WordStart,
    },
    IdeSignature {
        name: "rustrover",
        source: ActivitySource::JetBrains,
        mode: MatchMode::WordStart,
    },
    IdeSignature {
        name: "clion",
        source: ActivitySource::JetBrains,
        mode: MatchMode::WordStart,
    },
    IdeSignature {
        name: "rider",
        source: ActivitySource::JetBrains,
        mode: MatchMode::WordStart,
    },
    IdeSignature {
        name: "phpstorm",
        source: ActivitySource::JetBrains,
        mode: MatchMode::WordStart,
    },
    IdeSignature {
        name: "datagrip",
        source: ActivitySource::JetBrains,
        mode: MatchMode::WordStart,
    },
    IdeSignature {
        name: "android studio",
        source: ActivitySource::JetBrains,
        mode: MatchMode::WordStart,
    },
    // JetBrains Fleet
    IdeSignature {
        name: "fleet",
        source: ActivitySource::Fleet,
        mode: MatchMode::WordStart,
    },
    // Vim / Neovim
    IdeSignature {
        name: "vim",
        source: ActivitySource::Vim,
        mode: MatchMode::Exact,
    },
    IdeSignature {
        name: "nvim",
        source: ActivitySource::Vim,
        mode: MatchMode::Exact,
    },
    IdeSignature {
        name: "neovide",
        source: ActivitySource::Vim,
        mode: MatchMode::Exact,
    },
    // Sublime Text
    IdeSignature {
        name: "sublime_text",
        source: ActivitySource::Sublime,
        mode: MatchMode::Exact,
    },
    IdeSignature {
        name: "subl",
        source: ActivitySource::Sublime,
        mode: MatchMode::Exact,
    },
    // Zed
    IdeSignature {
        name: "zed",
        source: ActivitySource::Zed,
        mode: MatchMode::Exact,
    },
    // Xcode
    IdeSignature {
        name: "xcode",
        source: ActivitySource::Xcode,
        mode: MatchMode::WordStart,
    },
    // Emacs
    IdeSignature {
        name: "emacs",
        source: ActivitySource::Emacs,
        mode: MatchMode::Exact,
    },
    // Nova (Panic)
    IdeSignature {
        name: "nova",
        source: ActivitySource::Nova,
        mode: MatchMode::WordStart,
    },
    // Lapce
    IdeSignature {
        name: "lapce",
        source: ActivitySource::Lapce,
        mode: MatchMode::WordStart,
    },
    // Helix
    IdeSignature {
        name: "hx",
        source: ActivitySource::Helix,
        mode: MatchMode::Exact,
    },
    IdeSignature {
        name: "helix",
        source: ActivitySource::Helix,
        mode: MatchMode::WordStart,
    },
    // Kakoune
    IdeSignature {
        name: "kak",
        source: ActivitySource::Kakoune,
        mode: MatchMode::Exact,
    },
    IdeSignature {
        name: "kakoune",
        source: ActivitySource::Kakoune,
        mode: MatchMode::Exact,
    },
    // AI CLI Agents
    IdeSignature {
        name: "claude",
        source: ActivitySource::AiCli,
        mode: MatchMode::Exact,
    },
    IdeSignature {
        name: "codex",
        source: ActivitySource::AiCli,
        mode: MatchMode::Exact,
    },
    IdeSignature {
        name: "gemini",
        source: ActivitySource::AiCli,
        mode: MatchMode::Exact,
    },
    IdeSignature {
        name: "gemini-cli",
        source: ActivitySource::AiCli,
        mode: MatchMode::Exact,
    },
    IdeSignature {
        name: "kiro",
        source: ActivitySource::AiCli,
        mode: MatchMode::WordStart,
    },
    IdeSignature {
        name: "kiro-cli",
        source: ActivitySource::AiCli,
        mode: MatchMode::Exact,
    },
    IdeSignature {
        name: "aider",
        source: ActivitySource::AiCli,
        mode: MatchMode::Exact,
    },
    IdeSignature {
        name: "cursor-agent",
        source: ActivitySource::AiCli,
        mode: MatchMode::Exact,
    },
];

// ============================================
// Cached Scanner
// ============================================

struct IdeDetectorCache {
    system: System,
    last_scan: Option<Instant>,
    cached_result: Vec<DetectedIde>,
}

static IDE_CACHE: std::sync::OnceLock<Mutex<IdeDetectorCache>> = std::sync::OnceLock::new();

const SCAN_INTERVAL_MS: u128 = 30_000;

fn get_cache() -> &'static Mutex<IdeDetectorCache> {
    IDE_CACHE.get_or_init(|| {
        Mutex::new(IdeDetectorCache {
            system: System::new(),
            last_scan: None,
            cached_result: Vec::new(),
        })
    })
}

fn matches_signature(proc_name: &str, sig: &IdeSignature) -> bool {
    match sig.mode {
        MatchMode::Exact => proc_name == sig.name,
        MatchMode::WordStart => {
            proc_name == sig.name
                || proc_name.starts_with(&format!("{}.", sig.name))
                || proc_name.starts_with(&format!("{} ", sig.name))
                || proc_name.starts_with(&format!("{}-", sig.name))
        }
    }
}

/// Scan running processes for known IDEs. Results are cached for 30 seconds.
pub fn scan_ides() -> Vec<DetectedIde> {
    let cache = get_cache();
    // A poisoned mutex would silently render "no IDEs detected"
    // forever (the mutex never recovers on its own), and the
    // dev-record UI would mis-attribute it to "no IDEs running".
    // Warn so the poisoning surfaces.
    let mut guard = match cache.lock() {
        Ok(guard) => guard,
        Err(err) => {
            tracing::warn!(
                error = %err,
                "ide_detector::scan_ides: cache mutex poisoned; returning empty (cache will stay broken until process restart)"
            );
            return Vec::new();
        }
    };

    if let Some(last) = guard.last_scan {
        if last.elapsed().as_millis() < SCAN_INTERVAL_MS {
            return guard.cached_result.clone();
        }
    }

    guard.system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing(),
    );

    let frontmost_pid = get_frontmost_pid();
    let mut detected: Vec<DetectedIde> = Vec::new();
    let mut seen_sources = std::collections::HashSet::new();

    for process in guard.system.processes().values() {
        let proc_name = process.name().to_string_lossy().to_lowercase();
        let proc_pid = process.pid().as_u32();

        for sig in KNOWN_IDE_SIGNATURES {
            if matches_signature(&proc_name, sig) && !seen_sources.contains(&sig.source) {
                seen_sources.insert(sig.source);
                detected.push(DetectedIde {
                    source: sig.source,
                    pid: proc_pid,
                    process_name: process.name().to_string_lossy().to_string(),
                    is_frontmost: frontmost_pid.is_some_and(|fp| fp == proc_pid),
                });
                break;
            }
        }
    }

    guard.cached_result = detected.clone();
    guard.last_scan = Some(Instant::now());

    detected
}

/// Force a fresh scan ignoring the cache interval.
pub fn force_rescan() -> Vec<DetectedIde> {
    if let Ok(mut guard) = get_cache().lock() {
        guard.last_scan = None;
    }
    scan_ides()
}

/// Get the frontmost IDE source, if any.
pub fn get_frontmost_ide() -> Option<ActivitySource> {
    scan_ides()
        .into_iter()
        .find(|ide| ide.is_frontmost)
        .map(|ide| ide.source)
}

// ============================================
// Frontmost Window Detection (macOS)
// ============================================

#[cfg(target_os = "macos")]
fn get_frontmost_pid() -> Option<u32> {
    use core_foundation::base::TCFType;
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> *const std::ffi::c_void;
    }

    const K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY: u32 = 1;
    const K_CG_NULL_WINDOW_ID: u32 = 0;

    unsafe {
        let window_list =
            CGWindowListCopyWindowInfo(K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY, K_CG_NULL_WINDOW_ID);

        if window_list.is_null() {
            return None;
        }

        let list = window_list as core_foundation::array::CFArrayRef;
        let count = core_foundation::array::CFArrayGetCount(list);

        // The first on-screen window at layer 0 is typically the frontmost app
        for idx in 0..count {
            let dict = core_foundation::array::CFArrayGetValueAtIndex(list, idx)
                as core_foundation::dictionary::CFDictionaryRef;
            if dict.is_null() {
                continue;
            }

            let layer_key = CFString::new("kCGWindowLayer");
            let mut layer_ref: *const std::ffi::c_void = std::ptr::null();
            let layer_val = if core_foundation::dictionary::CFDictionaryGetValueIfPresent(
                dict,
                layer_key.as_CFTypeRef() as *const _,
                &mut layer_ref,
            ) != 0
            {
                let layer_num = CFNumber::wrap_under_get_rule(
                    layer_ref as core_foundation::number::CFNumberRef,
                );
                layer_num.to_i64().unwrap_or(-1)
            } else {
                -1
            };

            if layer_val != 0 {
                continue;
            }

            let pid_key = CFString::new("kCGWindowOwnerPID");
            let mut pid_ref: *const std::ffi::c_void = std::ptr::null();
            if core_foundation::dictionary::CFDictionaryGetValueIfPresent(
                dict,
                pid_key.as_CFTypeRef() as *const _,
                &mut pid_ref,
            ) != 0
            {
                let pid_num =
                    CFNumber::wrap_under_get_rule(pid_ref as core_foundation::number::CFNumberRef);
                let pid = pid_num.to_i64().unwrap_or(0);
                core_foundation::base::CFRelease(window_list);
                return Some(pid as u32);
            }
        }

        core_foundation::base::CFRelease(window_list);
        None
    }
}

#[cfg(not(target_os = "macos"))]
fn get_frontmost_pid() -> Option<u32> {
    None
}

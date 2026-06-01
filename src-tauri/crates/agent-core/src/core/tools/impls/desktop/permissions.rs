//! Native macOS permission checks for Accessibility and Screen Recording.
//!
//! Used by app-owned permission UI. Agent-facing permission checks can also be
//! run through the bundled Peekaboo CLI tool when the model needs them.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct DesktopPermissions {
    pub accessibility: bool,
    pub screen_recording: bool,
}

extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

/// Check current Accessibility and Screen Recording permission status.
///
/// These are non-blocking checks — they do not trigger system prompts.
pub fn check_permissions() -> DesktopPermissions {
    unsafe {
        DesktopPermissions {
            accessibility: AXIsProcessTrusted(),
            screen_recording: CGPreflightScreenCaptureAccess(),
        }
    }
}

/// Request Screen Recording permission (triggers the system dialog).
/// Returns the updated permission status.
pub fn request_screen_recording() -> bool {
    unsafe { CGRequestScreenCaptureAccess() }
}

/// Request Accessibility permission by checking with the prompt option.
/// macOS presents the TCC dialog when `kAXTrustedCheckOptionPrompt` is `true`.
pub fn request_accessibility() -> bool {
    use core_foundation::base::{CFRelease, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::CFString;

    extern "C" {
        fn AXIsProcessTrustedWithOptions(options: core_foundation::base::CFTypeRef) -> bool;
    }

    unsafe {
        let key = CFString::new("AXTrustedCheckOptionPrompt");
        let value = CFBoolean::true_value();
        let dict = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), value.as_CFType())]);
        let result = AXIsProcessTrustedWithOptions(dict.as_concrete_TypeRef() as _);
        CFRelease(dict.as_concrete_TypeRef() as _);
        result
    }
}

/// Whether all required desktop permissions are granted.
pub fn all_granted() -> bool {
    let perms = check_permissions();
    perms.accessibility && perms.screen_recording
}

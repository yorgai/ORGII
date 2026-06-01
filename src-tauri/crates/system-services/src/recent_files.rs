//! macOS Recent Files Management
//!
//! Adds files/folders to the macOS "Recent Items" list shown in:
//! - Dock right-click menu
//! - Expose (Mission Control / App Exposé)
//! - Apple menu > Recent Items
//!
//! Uses NSDocumentController API via Cocoa bindings.
//!
//! IMPORTANT: NSDocumentController is @MainActor — all calls MUST be dispatched
//! to the main thread. Tauri commands run on background threads, so we use
//! `dispatch2::DispatchQueue::main().exec_async(...)` for every NSDocumentController call.
//!
//! DEV-MODE LIMITATION: Dock Exposé and Apple menu > Recent Items only work when
//! the app runs from a .app bundle (which embeds Info.plist with CFBundleDocumentTypes).
//! `tauri dev` runs a bare binary without the bundle, so macOS never sees the document
//! type registration. Use `tauri build --debug` to test these features.
//! The custom Dock right-click menu and File > Open Recent work in both modes.

#[cfg(target_os = "macos")]
use objc2::msg_send;
#[cfg(target_os = "macos")]
use objc2::runtime::{AnyClass, AnyObject};
#[cfg(target_os = "macos")]
use objc2_foundation::NSString;

/// Add a file or folder to macOS recent documents.
///
/// This appears in:
/// - Dock right-click menu > "Recent Items"
/// - Apple menu > Recent Items
/// - Expose/Mission Control recent files
///
/// # Arguments
/// * `path` - Absolute path to the file or folder
///
/// # Returns
/// * `Ok(())` on success
/// * `Err(String)` if the path is invalid or operation fails
#[tauri::command]
pub fn add_to_recent_documents(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        add_to_recent_documents_macos(&path)
    }

    #[cfg(not(target_os = "macos"))]
    {
        // No-op on other platforms - they handle recent files differently
        // Windows: Uses JumpList (would need separate implementation)
        // Linux: Uses .desktop files (would need separate implementation)
        let _ = path;
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn add_to_recent_documents_macos(path: &str) -> Result<(), String> {
    use std::path::Path;

    if !Path::new(path).exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    let path_owned = path.to_string();

    // Dispatch to main thread — NSDocumentController is @MainActor
    dispatch2::DispatchQueue::main().exec_async(move || unsafe {
        let document_controller_class =
            AnyClass::get(c"NSDocumentController").expect("NSDocumentController");
        let document_controller: *mut AnyObject =
            msg_send![document_controller_class, sharedDocumentController];
        if document_controller.is_null() {
            return;
        }

        let path_nsstring = NSString::from_str(&path_owned);
        let ns_url_class = AnyClass::get(c"NSURL").expect("NSURL");
        let file_url: *mut AnyObject = msg_send![ns_url_class, fileURLWithPath: &*path_nsstring];
        if file_url.is_null() {
            return;
        }

        let _: () = msg_send![document_controller, noteNewRecentDocumentURL: file_url];
    });

    Ok(())
}

/// Add multiple files/folders to macOS recent documents.
///
/// More efficient than calling `add_to_recent_documents` multiple times
/// as it batches the operations.
///
/// # Arguments
/// * `paths` - Vector of absolute paths to files or folders
///
/// # Returns
/// * `Ok(count)` - Number of successfully added items
/// * `Err(String)` if a critical error occurs
#[tauri::command]
pub fn add_multiple_to_recent_documents(paths: Vec<String>) -> Result<usize, String> {
    let mut success_count = 0;

    for path in paths {
        match add_to_recent_documents(path) {
            Ok(()) => success_count += 1,
            Err(err) => {
                // Log but don't fail - continue with other paths
                eprintln!("[RecentFiles] Failed to add path: {}", err);
            }
        }
    }

    Ok(success_count)
}

/// Clear all recent documents from macOS.
///
/// This clears the recent documents list shown in Dock and Apple menu.
/// Use with caution as this affects the system-wide recent documents.
///
/// # Returns
/// * `Ok(())` on success
/// * `Err(String)` if the operation fails
#[tauri::command]
pub fn clear_recent_documents() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        clear_recent_documents_macos()
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn clear_recent_documents_macos() -> Result<(), String> {
    dispatch2::DispatchQueue::main().exec_async(|| unsafe {
        let document_controller_class =
            AnyClass::get(c"NSDocumentController").expect("NSDocumentController");
        let document_controller: *mut AnyObject =
            msg_send![document_controller_class, sharedDocumentController];
        if document_controller.is_null() {
            return;
        }
        let _: () = msg_send![
            document_controller,
            clearRecentDocuments: std::ptr::null::<AnyObject>(),
        ];
    });
    Ok(())
}

/// Get the maximum number of recent documents macOS will store.
///
/// This is a system preference that users can configure in System Preferences.
///
/// # Returns
/// * The maximum number of recent documents (typically 10-50)
#[tauri::command]
pub fn get_max_recent_documents() -> Result<usize, String> {
    #[cfg(target_os = "macos")]
    {
        get_max_recent_documents_macos()
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(10) // Default fallback
    }
}

#[cfg(target_os = "macos")]
fn get_max_recent_documents_macos() -> Result<usize, String> {
    unsafe {
        let document_controller_class =
            AnyClass::get(c"NSDocumentController").expect("NSDocumentController");
        let document_controller: *mut AnyObject =
            msg_send![document_controller_class, sharedDocumentController];
        if document_controller.is_null() {
            return Err("Failed to get NSDocumentController".to_string());
        }

        let max_count: usize = msg_send![document_controller, maximumRecentDocumentCount];
        Ok(max_count)
    }
}

#[cfg(test)]
#[path = "tests/recent_files_tests.rs"]
mod tests;

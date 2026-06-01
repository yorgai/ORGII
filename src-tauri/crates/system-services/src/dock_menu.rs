//! macOS Dock Right-Click Menu
//!
//! Injects an `applicationDockMenu:` method into Tauri's NSApplicationDelegate
//! so that right-clicking the Dock icon shows recent folders.
//!
//! Tauri doesn't support dock menus natively (open feature request), so we use
//! the objc runtime to add the method dynamically after Tauri sets up its delegate.

#[cfg(target_os = "macos")]
use objc2::msg_send;
#[cfg(target_os = "macos")]
use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
#[cfg(target_os = "macos")]
use objc2::sel;

#[cfg(target_os = "macos")]
use super::app_menu::get_recent_paths;

/// Install `applicationDockMenu:` on Tauri's app delegate.
/// Must be called after Tauri has finished setting up (inside `.setup()`).
#[cfg(target_os = "macos")]
pub fn install_dock_menu() {
    unsafe {
        let ns_application = AnyClass::get(c"NSApplication").expect("NSApplication");
        let app: *mut AnyObject = msg_send![ns_application, sharedApplication];
        let delegate: *mut AnyObject = msg_send![app, delegate];
        if delegate.is_null() {
            eprintln!("[DockMenu] No NSApplication delegate found");
            return;
        }

        let delegate_class: *const AnyClass = msg_send![delegate, class];
        if delegate_class.is_null() {
            eprintln!("[DockMenu] Could not get delegate class");
            return;
        }

        // Cast away const — class_addMethod needs *mut AnyClass
        let delegate_class_mut = delegate_class as *mut AnyClass;

        let sel = sel!(applicationDockMenu:);

        // Only add if not already present (idempotent)
        if (*delegate_class_mut).instance_method(sel).is_some() {
            return;
        }

        // "@@:@" means: returns id (@), self implicit, SEL implicit, sender id (@)
        let imp: extern "C" fn(&AnyObject, Sel, *mut AnyObject) -> *mut AnyObject =
            dock_menu_handler;
        let added = objc2::ffi::class_addMethod(
            delegate_class_mut,
            sel,
            std::mem::transmute::<
                extern "C" fn(&AnyObject, Sel, *mut AnyObject) -> *mut AnyObject,
                Imp,
            >(imp),
            c"@@:@".as_ptr(),
        );

        if added.as_bool() {
            println!("✅ [DockMenu] Installed applicationDockMenu: on Tauri delegate");
        } else {
            eprintln!("[DockMenu] Failed to add applicationDockMenu: method");
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn install_dock_menu() {
    // No-op on non-macOS
}

/// Called by the Objective-C runtime when user right-clicks the Dock icon.
/// Builds an NSMenu from the current RECENT_PATHS.
#[cfg(target_os = "macos")]
extern "C" fn dock_menu_handler(
    _self: &AnyObject,
    _cmd: Sel,
    _sender: *mut AnyObject,
) -> *mut AnyObject {
    use objc2_foundation::NSString;

    unsafe {
        let ns_menu_class = AnyClass::get(c"NSMenu").expect("NSMenu");
        let menu: *mut AnyObject = msg_send![ns_menu_class, alloc];
        let menu: *mut AnyObject = msg_send![menu, init];

        let recent_paths = get_recent_paths();

        if recent_paths.is_empty() {
            return menu;
        }

        let ns_menu_item_class = AnyClass::get(c"NSMenuItem").expect("NSMenuItem");

        // "Recent Folders" header (disabled, acts as section title)
        let header_title = NSString::from_str("Recent Folders");
        let empty_key = NSString::from_str("");
        let header_item: *mut AnyObject = msg_send![ns_menu_item_class, alloc];
        let header_item: *mut AnyObject = msg_send![
            header_item,
            initWithTitle: &*header_title,
            action: std::ptr::null::<AnyObject>(),
            keyEquivalent: &*empty_key,
        ];
        let _: () = msg_send![header_item, setEnabled: false];
        let _: () = msg_send![menu, addItem: header_item];

        for path in &recent_paths {
            let display_name = std::path::Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path.clone());

            let title = NSString::from_str(&display_name);
            let key_equiv = NSString::from_str("");

            let item: *mut AnyObject = msg_send![ns_menu_item_class, alloc];
            let item: *mut AnyObject = msg_send![
                item,
                initWithTitle: &*title,
                action: sel!(dockMenuOpenRecent:),
                keyEquivalent: &*key_equiv,
            ];

            // Store the full path as representedObject so the action handler can retrieve it
            let path_nsstring = NSString::from_str(path);
            let _: () = msg_send![item, setRepresentedObject: &*path_nsstring];

            // Target = the app delegate (self in the original context)
            let app: *mut AnyObject = msg_send![ns_application(), sharedApplication];
            let delegate: *mut AnyObject = msg_send![app, delegate];
            let _: () = msg_send![item, setTarget: delegate];

            let _: () = msg_send![menu, addItem: item];
        }

        menu
    }
}

/// Cached `NSApplication` class lookup used inside the dock-menu handler.
#[cfg(target_os = "macos")]
fn ns_application() -> &'static AnyClass {
    AnyClass::get(c"NSApplication").expect("NSApplication")
}

/// Install the `dockMenuOpenRecent:` action handler on the delegate class.
/// This is the action that fires when a dock menu recent item is clicked.
#[cfg(target_os = "macos")]
pub fn install_dock_menu_action(app_handle: &tauri::AppHandle) {
    // Store a clone of app_handle in a global so the extern "C" fn can access it
    *DOCK_APP_HANDLE.lock().unwrap() = Some(app_handle.clone());

    unsafe {
        let app: *mut AnyObject = msg_send![ns_application(), sharedApplication];
        let delegate: *mut AnyObject = msg_send![app, delegate];
        if delegate.is_null() {
            return;
        }

        let delegate_class: *const AnyClass = msg_send![delegate, class];
        let delegate_class_mut = delegate_class as *mut AnyClass;

        let sel = sel!(dockMenuOpenRecent:);
        if (*delegate_class_mut).instance_method(sel).is_some() {
            return;
        }

        let imp: extern "C" fn(&AnyObject, Sel, *mut AnyObject) = dock_menu_open_recent_handler;
        let added = objc2::ffi::class_addMethod(
            delegate_class_mut,
            sel,
            std::mem::transmute::<extern "C" fn(&AnyObject, Sel, *mut AnyObject), Imp>(imp),
            c"v@:@".as_ptr(),
        );

        if !added.as_bool() {
            eprintln!("[DockMenu] Failed to add dockMenuOpenRecent: method");
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn install_dock_menu_action(_app_handle: &tauri::AppHandle) {
    // No-op
}

/// Global AppHandle so the extern "C" handler can emit events to the frontend.
static DOCK_APP_HANDLE: std::sync::Mutex<Option<tauri::AppHandle>> = std::sync::Mutex::new(None);

/// Action handler for dock menu recent item clicks.
/// Extracts the path from representedObject and emits `menu-open-recent` to the frontend.
#[cfg(target_os = "macos")]
extern "C" fn dock_menu_open_recent_handler(_self: &AnyObject, _cmd: Sel, sender: *mut AnyObject) {
    unsafe {
        let represented_object: *mut AnyObject = msg_send![sender, representedObject];
        if represented_object.is_null() {
            return;
        }

        let path_cstr: *const std::os::raw::c_char = msg_send![represented_object, UTF8String];
        if path_cstr.is_null() {
            return;
        }

        let path = std::ffi::CStr::from_ptr(path_cstr)
            .to_string_lossy()
            .to_string();

        if let Some(ref app_handle) = *DOCK_APP_HANDLE.lock().unwrap() {
            use tauri::{Emitter, Manager};
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.emit("menu-open-recent", path);
            }
        }
    }
}

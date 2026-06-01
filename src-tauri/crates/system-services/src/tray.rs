//! System tray menu management
//!
//! Handles creation and event handling for the system tray icon and menu

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};

/// Load tray icon - embedded at compile time from icons folder.
///
/// `tray-icon.png` is a 32×32 monochrome PNG with transparent background — the
/// shape is encoded in the alpha channel, RGB is solid black. macOS treats it
/// as a template image (see `icon_as_template(true)` below) and tints it for
/// light/dark menu bar automatically. Windows/Linux render it as-is.
fn load_tray_icon() -> Image<'static> {
    Image::from_bytes(include_bytes!("../../../icons/tray-icon.png"))
        .expect("Failed to load embedded tray icon")
}

/// Create the tray menu with all items
pub fn create_tray_menu(app: &AppHandle) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let todos_item = MenuItem::with_id(app, "todos", "To dos: None", true, None::<&str>)?;
    let separator1 = PredefinedMenuItem::separator(app)?;
    let recent_sessions_item = MenuItem::with_id(
        app,
        "recent_sessions",
        "Recent sessions: None",
        true,
        None::<&str>,
    )?;
    let separator2 = PredefinedMenuItem::separator(app)?;
    let new_session_item =
        MenuItem::with_id(app, "new_session", "New session", true, None::<&str>)?;
    let separator3 = PredefinedMenuItem::separator(app)?;
    let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let open_app_item = MenuItem::with_id(app, "open_app", "Open App", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &todos_item,
            &separator1,
            &recent_sessions_item,
            &separator2,
            &new_session_item,
            &separator3,
            &settings_item,
            &open_app_item,
            &quit_item,
        ],
    )?;

    Ok(menu)
}

/// Setup the system tray with icon and menu
pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let menu = create_tray_menu(app)?;
    let icon = load_tray_icon();

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open_app" => {
                let _ = app_window::recreate_main_window(app);
            }
            "new_session" => {
                let _ = app_window::recreate_main_window(app);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("tray-new-session", ());
                }
            }
            "settings" => {
                let _ = app_window::recreate_main_window(app);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("tray-open-settings", ());
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

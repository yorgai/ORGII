//! Inline Webview Capture
//!
//! Captures the visible contents of an inline webview as a PNG data URL,
//! suitable for attaching to a chat input as an image.
//!
//! ## Platform Support
//!
//! - **macOS**: Uses WKWebView's `takeSnapshot:withCompletionHandler:` API
//!   via Objective-C runtime. Produces a PNG representation of the visible
//!   viewport (not full-page).
//! - **Other platforms**: Returns an error. Cross-platform capture can be
//!   added by wiring per-platform snapshot APIs (WebView2 on Windows,
//!   WebKitGTK on Linux).

use base64::Engine;
use tauri::{AppHandle, Manager};

/// Capture the current visible contents of an inline webview and return a
/// base64-encoded `data:image/png;...` URL.
///
/// The caller is responsible for injecting the returned data URL into the
/// chat image attachment pipeline.
#[tauri::command]
pub async fn browser_inline_capture(app: AppHandle, label: String) -> Result<String, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    #[cfg(target_os = "macos")]
    {
        let png_bytes = take_snapshot_macos(&webview).await?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
        Ok(format!("data:image/png;base64,{}", encoded))
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = webview;
        Err("browser_inline_capture is only supported on macOS at this time".to_string())
    }
}

// ============================================
// macOS implementation (WKWebView.takeSnapshot)
// ============================================

#[cfg(target_os = "macos")]
async fn take_snapshot_macos(webview: &tauri::Webview) -> Result<Vec<u8>, String> {
    use block2::RcBlock;
    use objc2::runtime::{AnyClass, AnyObject, Bool};
    use objc2::{msg_send, sel};
    use std::sync::mpsc;

    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();

    // SAFETY: Accesses WKWebView via Objective-C runtime.
    // - wv.inner() returns a valid WKWebView* on macOS
    // - WKWebView.takeSnapshotWithConfiguration:completionHandler: is a
    //   documented WebKit API that returns an NSImage on the main thread.
    // - The completion block reads the NSImage's TIFF rep, converts to PNG
    //   via NSBitmapImageRep, and sends the bytes back through the channel.
    // - All pointers are null-checked before use.
    let result = webview.with_webview(move |wv| unsafe {
        let wk_webview: *mut AnyObject = wv.inner() as *mut AnyObject;
        if wk_webview.is_null() {
            let _ = tx.send(Err("WKWebView pointer is null".to_string()));
            return;
        }

        // WKSnapshotConfiguration is optional (nil → whole visible viewport
        // at 2x scale on Retina). We pass nil to match what the user sees.
        let snapshot_config: *mut AnyObject = std::ptr::null_mut();

        let tx_clone = tx.clone();
        let block = RcBlock::new(move |ns_image: *mut AnyObject, error: *mut AnyObject| {
            if !error.is_null() {
                let desc: *mut AnyObject = msg_send![error, localizedDescription];
                let message = if desc.is_null() {
                    "unknown snapshot error".to_string()
                } else {
                    let utf8: *const i8 = msg_send![desc, UTF8String];
                    if utf8.is_null() {
                        "unknown snapshot error".to_string()
                    } else {
                        std::ffi::CStr::from_ptr(utf8)
                            .to_str()
                            .unwrap_or("unknown snapshot error")
                            .to_string()
                    }
                };
                let _ = tx_clone.send(Err(format!("takeSnapshot failed: {}", message)));
                return;
            }

            if ns_image.is_null() {
                let _ = tx_clone.send(Err("takeSnapshot returned nil image".to_string()));
                return;
            }

            // Convert NSImage → TIFF → NSBitmapImageRep → PNG bytes.
            let tiff_data: *mut AnyObject = msg_send![ns_image, TIFFRepresentation];
            if tiff_data.is_null() {
                let _ = tx_clone.send(Err("TIFFRepresentation returned nil".to_string()));
                return;
            }

            let bitmap_class = AnyClass::get(c"NSBitmapImageRep").expect("NSBitmapImageRep");
            let bitmap: *mut AnyObject = msg_send![bitmap_class, imageRepWithData: tiff_data];
            if bitmap.is_null() {
                let _ = tx_clone.send(Err("NSBitmapImageRep imageRepWithData nil".to_string()));
                return;
            }

            // NSBitmapImageFileTypePNG = 4
            let png_type: u64 = 4;
            let empty_props_class = AnyClass::get(c"NSDictionary").expect("NSDictionary");
            let empty_props: *mut AnyObject = msg_send![empty_props_class, dictionary];
            let png_data: *mut AnyObject = msg_send![
                bitmap,
                representationUsingType: png_type,
                properties: empty_props,
            ];
            if png_data.is_null() {
                let _ = tx_clone.send(Err("representationUsingType:PNG returned nil".to_string()));
                return;
            }

            let length: usize = msg_send![png_data, length];
            let bytes_ptr: *const u8 = msg_send![png_data, bytes];
            if bytes_ptr.is_null() || length == 0 {
                let _ = tx_clone.send(Err("PNG data is empty".to_string()));
                return;
            }

            let slice = std::slice::from_raw_parts(bytes_ptr, length);
            let _ = tx_clone.send(Ok(slice.to_vec()));
        });

        // Prefer configuration-based API (macOS 10.13+); fall back to the
        // older selector only if responds-to check fails.
        let responds: Bool = msg_send![
            wk_webview,
            respondsToSelector: sel!(takeSnapshotWithConfiguration:completionHandler:),
        ];
        if responds.as_bool() {
            let _: () = msg_send![
                wk_webview,
                takeSnapshotWithConfiguration: snapshot_config,
                completionHandler: &*block,
            ];
        } else {
            let _ = tx.send(Err(
                "WKWebView does not respond to takeSnapshotWithConfiguration".to_string(),
            ));
        }
    });

    if let Err(err) = result {
        return Err(format!("with_webview failed: {}", err));
    }

    rx.recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| "timed out waiting for snapshot".to_string())?
}

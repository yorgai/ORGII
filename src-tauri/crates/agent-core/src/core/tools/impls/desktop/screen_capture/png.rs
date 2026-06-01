//! PNG screenshot capture.
//!
//! Uses CGDisplayCreateImage / CGWindowListCreateImage for the source CGImage
//! and ImageIO (`CGImageDestination*`) to emit lossless PNG bytes. Used by
//! the `screenshot` tool when `format=png`.

use base64::Engine;
use core_foundation::base::TCFType;
use core_foundation::string::CFString;
use core_graphics::geometry::CGRect;
use foreign_types::ForeignType;
use std::ffi::c_void;

use crate::tools::traits::ToolError;

use super::displays::main_display_id;

/// Capture a screenshot of a specific window, returning PNG bytes.
pub fn capture_window_png(window_id: u32) -> Result<Vec<u8>, ToolError> {
    capture_via_cg_window_list(window_id)
}

/// Capture a screenshot of the entire main display, returning PNG bytes.
pub fn capture_screen_png() -> Result<Vec<u8>, ToolError> {
    capture_display_png(main_display_id())
}

/// Capture a specific display by ID as PNG.
fn capture_display_png(display_id: u32) -> Result<Vec<u8>, ToolError> {
    extern "C" {
        fn CGDisplayCreateImage(display_id: u32) -> *mut c_void;
    }
    let cg_image = unsafe {
        let image_ref = CGDisplayCreateImage(display_id);
        if image_ref.is_null() {
            return Err(ToolError::ExecutionFailed(format!(
                "CGDisplayCreateImage returned null for display {}",
                display_id
            )));
        }
        core_graphics::image::CGImage::from_ptr(image_ref as *mut _)
    };
    cgimage_to_png(&cg_image)
}

/// Encode PNG bytes to base64 string.
pub fn png_to_base64(png_bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(png_bytes)
}

/// Capture a window by its CGWindowID using CGWindowListCreateImage.
fn capture_via_cg_window_list(window_id: u32) -> Result<Vec<u8>, ToolError> {
    extern "C" {
        fn CGWindowListCreateImage(
            screen_bounds: CGRect,
            list_option: u32,
            window_id: u32,
            image_option: u32,
        ) -> *mut c_void;
    }

    let list_option: u32 = 8; // kCGWindowListOptionIncludingWindow
    let image_option: u32 = 1; // kCGWindowImageBoundsIgnoreFraming

    let null_rect = CGRect::new(
        &core_graphics::geometry::CGPoint::new(0.0, 0.0),
        &core_graphics::geometry::CGSize::new(0.0, 0.0),
    );

    let cg_image = unsafe {
        let image_ref = CGWindowListCreateImage(null_rect, list_option, window_id, image_option);
        if image_ref.is_null() {
            return Err(ToolError::ExecutionFailed(format!(
                "CGWindowListCreateImage returned null for window {}",
                window_id
            )));
        }
        core_graphics::image::CGImage::from_ptr(image_ref as *mut _)
    };

    cgimage_to_png(&cg_image)
}

/// Convert a CGImage to PNG bytes using ImageIO.
fn cgimage_to_png(image: &core_graphics::image::CGImage) -> Result<Vec<u8>, ToolError> {
    extern "C" {
        fn CFDataGetLength(data: *const c_void) -> isize;
        fn CFDataGetBytePtr(data: *const c_void) -> *const u8;
    }

    #[link(name = "ImageIO", kind = "framework")]
    extern "C" {
        fn CGImageDestinationCreateWithData(
            data: *mut c_void,
            type_: *const c_void,
            count: usize,
            options: *const c_void,
        ) -> *mut c_void;
        fn CGImageDestinationAddImage(
            dest: *mut c_void,
            image: *const c_void,
            properties: *const c_void,
        );
        fn CGImageDestinationFinalize(dest: *mut c_void) -> bool;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFDataCreateMutable(allocator: *const c_void, capacity: isize) -> *mut c_void;
    }

    unsafe {
        let mutable_data = CFDataCreateMutable(std::ptr::null(), 0);
        if mutable_data.is_null() {
            return Err(ToolError::ExecutionFailed(
                "Failed to create mutable data".into(),
            ));
        }

        let png_uti = CFString::new("public.png");
        let dest = CGImageDestinationCreateWithData(
            mutable_data,
            png_uti.as_concrete_TypeRef() as *const c_void,
            1,
            std::ptr::null(),
        );
        if dest.is_null() {
            core_foundation::base::CFRelease(mutable_data as _);
            return Err(ToolError::ExecutionFailed(
                "Failed to create image destination".into(),
            ));
        }

        CGImageDestinationAddImage(dest, image.as_ptr() as *const c_void, std::ptr::null());

        if !CGImageDestinationFinalize(dest) {
            core_foundation::base::CFRelease(dest as _);
            core_foundation::base::CFRelease(mutable_data as _);
            return Err(ToolError::ExecutionFailed(
                "Failed to finalize PNG image".into(),
            ));
        }

        let length = CFDataGetLength(mutable_data);
        let ptr = CFDataGetBytePtr(mutable_data);
        let bytes = std::slice::from_raw_parts(ptr, length as usize).to_vec();

        core_foundation::base::CFRelease(dest as _);
        core_foundation::base::CFRelease(mutable_data as _);

        Ok(bytes)
    }
}

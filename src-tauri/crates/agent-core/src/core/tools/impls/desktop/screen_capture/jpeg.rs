//! JPEG screenshot capture with optional downscaling.
//!
//! Used by the `screenshot` tool when `format=jpeg`. Adds three concerns
//! that PNG doesn't have:
//!
//! 1. **Quality** — pass-through `kCGImageDestinationLossyCompressionQuality`.
//! 2. **Downscaling** — `max_dim` clamps the longest side via
//!    `CGBitmapContextCreate` so very large captures stay under the LLM's
//!    image-input budget. The reported `(out_w, out_h, ratio)` is what
//!    the caller stores in the tool result so coordinates round-trip.
//! 3. **Per-display crop fidelity** — `capture_region_jpeg_sized` checks
//!    whether the requested rect lives entirely on a single display and,
//!    if so, captures **that display** at native scale and crops in
//!    display-local pixel coords. Spanning regions fall back to the
//!    legacy global `CGWindowListCreateImage` path which is correct in
//!    coordinate space but at main-display backing scale.

use core_foundation::base::TCFType;
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_graphics::geometry::CGRect;
use foreign_types::ForeignType;
use std::ffi::c_void;

use crate::tools::traits::ToolError;

use super::displays::{list_displays, DisplayInfo};

/// Capture a specific display as JPEG, optionally downscaled to `max_dim` on the longest side.
/// Returns (jpeg_bytes, output_width, output_height, downscale_ratio).
/// A `max_dim` of 0 means no resize.
pub fn capture_display_jpeg_sized(
    display_id: u32,
    quality: f64,
    max_dim: u32,
) -> Result<(Vec<u8>, u32, u32, f64), ToolError> {
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

    let (resized, out_w, out_h, ratio) = maybe_downscale(cg_image, max_dim);
    let bytes = cgimage_to_jpeg(&resized, quality)?;
    Ok((bytes, out_w, out_h, ratio))
}

/// Capture a rectangular region in global CG screen space as JPEG, optionally resized.
/// Returns (jpeg_bytes, output_width, output_height, downscale_ratio).
///
/// **Per-display correctness:** the region is first matched against the active
/// displays. If it lies entirely on a single display, we use the per-display
/// `CGDisplayCreateImage` + `CGImageCreateWithImageInRect` path so the crop
/// inherits that display's native backing scale (retina detail preserved on
/// non-main monitors). If the region spans displays or doesn't overlap any
/// known display, we fall back to the global `CGWindowListCreateImage`
/// composite, which is correct in coordinate space but at main-display scale.
pub fn capture_region_jpeg_sized(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    quality: f64,
    max_dim: u32,
) -> Result<(Vec<u8>, u32, u32, f64), ToolError> {
    if width <= 0.0 || height <= 0.0 {
        return Err(ToolError::ExecutionFailed(format!(
            "region capture requires positive dimensions, got {:.0}x{:.0}",
            width, height
        )));
    }

    let displays = list_displays();
    let owner = displays.iter().find(|d| {
        let cx = x + width / 2.0;
        let cy = y + height / 2.0;
        cx >= d.bounds.origin.x
            && cx < d.bounds.origin.x + d.bounds.size.width
            && cy >= d.bounds.origin.y
            && cy < d.bounds.origin.y + d.bounds.size.height
    });

    let region_fully_inside_owner = owner
        .map(|d| {
            x >= d.bounds.origin.x
                && y >= d.bounds.origin.y
                && x + width <= d.bounds.origin.x + d.bounds.size.width
                && y + height <= d.bounds.origin.y + d.bounds.size.height
        })
        .unwrap_or(false);

    if let (Some(d), true) = (owner, region_fully_inside_owner) {
        return capture_display_local_region_jpeg(d, x, y, width, height, quality, max_dim);
    }

    capture_region_global_jpeg(x, y, width, height, quality, max_dim)
}

/// Per-display crop: capture the owning display at native pixel density,
/// then crop to the requested rect in display-local pixel coordinates.
/// This is the only path that preserves retina detail on non-main monitors.
fn capture_display_local_region_jpeg(
    display: &DisplayInfo,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    quality: f64,
    max_dim: u32,
) -> Result<(Vec<u8>, u32, u32, f64), ToolError> {
    extern "C" {
        fn CGDisplayCreateImage(display_id: u32) -> *mut c_void;
        fn CGImageCreateWithImageInRect(image: *const c_void, rect: CGRect) -> *mut c_void;
    }

    let local_x = (x - display.bounds.origin.x) * display.scale_factor;
    let local_y = (y - display.bounds.origin.y) * display.scale_factor;
    let local_w = width * display.scale_factor;
    let local_h = height * display.scale_factor;

    let crop_rect = CGRect::new(
        &core_graphics::geometry::CGPoint::new(local_x, local_y),
        &core_graphics::geometry::CGSize::new(local_w, local_h),
    );

    let cropped = unsafe {
        let full = CGDisplayCreateImage(display.id);
        if full.is_null() {
            return Err(ToolError::ExecutionFailed(format!(
                "CGDisplayCreateImage returned null for display {}",
                display.id
            )));
        }
        let cropped_ref = CGImageCreateWithImageInRect(full as *const c_void, crop_rect);
        // CGDisplayCreateImage is "Create" (+1 ref) and we don't keep the
        // full image — release it now. The cropped image holds its own ref.
        core_foundation::base::CFRelease(full as _);
        if cropped_ref.is_null() {
            return Err(ToolError::ExecutionFailed(format!(
                "CGImageCreateWithImageInRect returned null for region {}x{}+{}+{}",
                local_w as u32, local_h as u32, local_x as u32, local_y as u32
            )));
        }
        core_graphics::image::CGImage::from_ptr(cropped_ref as *mut _)
    };

    let (resized, out_w, out_h, ratio) = maybe_downscale(cropped, max_dim);
    let bytes = cgimage_to_jpeg(&resized, quality)?;
    Ok((bytes, out_w, out_h, ratio))
}

/// Legacy multi-display composite path. Used when the region spans displays
/// or doesn't overlap any known display (e.g. a virtual display we couldn't
/// enumerate). Coordinates are correct, but the image is rasterised at the
/// main display's backing scale so non-main retina detail is lost.
fn capture_region_global_jpeg(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    quality: f64,
    max_dim: u32,
) -> Result<(Vec<u8>, u32, u32, f64), ToolError> {
    extern "C" {
        fn CGWindowListCreateImage(
            screen_bounds: CGRect,
            list_option: u32,
            window_id: u32,
            image_option: u32,
        ) -> *mut c_void;
    }

    let bounds = CGRect::new(
        &core_graphics::geometry::CGPoint::new(x, y),
        &core_graphics::geometry::CGSize::new(width, height),
    );

    let cg_image = unsafe {
        let image_ref = CGWindowListCreateImage(bounds, 1, 0, 0);
        if image_ref.is_null() {
            return Err(ToolError::ExecutionFailed(
                "CGWindowListCreateImage returned null for region capture".into(),
            ));
        }
        core_graphics::image::CGImage::from_ptr(image_ref as *mut _)
    };

    let (resized, out_w, out_h, ratio) = maybe_downscale(cg_image, max_dim);
    let bytes = cgimage_to_jpeg(&resized, quality)?;
    Ok((bytes, out_w, out_h, ratio))
}

/// Downscale a CGImage so its longest side is at most `max_dim` pixels.
/// Returns (possibly-same image, width, height, downscale_ratio where ratio=output/input).
/// A ratio of 1.0 means no scaling was applied.
fn maybe_downscale(
    image: core_graphics::image::CGImage,
    max_dim: u32,
) -> (core_graphics::image::CGImage, u32, u32, f64) {
    use core_graphics::image::CGImage;
    extern "C" {
        fn CGImageGetWidth(image: *const c_void) -> usize;
        fn CGImageGetHeight(image: *const c_void) -> usize;
    }
    let src_w = unsafe { CGImageGetWidth(image.as_ptr() as *const c_void) } as u32;
    let src_h = unsafe { CGImageGetHeight(image.as_ptr() as *const c_void) } as u32;

    if max_dim == 0 || (src_w <= max_dim && src_h <= max_dim) {
        return (image, src_w, src_h, 1.0);
    }

    let longest = src_w.max(src_h);
    let ratio = max_dim as f64 / longest as f64;
    let dst_w = ((src_w as f64) * ratio).round().max(1.0) as u32;
    let dst_h = ((src_h as f64) * ratio).round().max(1.0) as u32;

    extern "C" {
        fn CGColorSpaceCreateDeviceRGB() -> *mut c_void;
        fn CGColorSpaceRelease(cs: *mut c_void);
        fn CGBitmapContextCreate(
            data: *mut c_void,
            width: usize,
            height: usize,
            bits_per_component: usize,
            bytes_per_row: usize,
            colorspace: *mut c_void,
            bitmap_info: u32,
        ) -> *mut c_void;
        fn CGContextDrawImage(ctx: *mut c_void, rect: CGRect, image: *const c_void);
        fn CGBitmapContextCreateImage(ctx: *mut c_void) -> *mut c_void;
        fn CGContextRelease(ctx: *mut c_void);
        fn CGContextSetInterpolationQuality(ctx: *mut c_void, q: i32);
    }

    // kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big = 1 | (4 << 12)
    const BITMAP_INFO: u32 = 1 | (4 << 12);

    unsafe {
        let cs = CGColorSpaceCreateDeviceRGB();
        let ctx = CGBitmapContextCreate(
            std::ptr::null_mut(),
            dst_w as usize,
            dst_h as usize,
            8,
            dst_w as usize * 4,
            cs,
            BITMAP_INFO,
        );
        CGColorSpaceRelease(cs);
        if ctx.is_null() {
            return (image, src_w, src_h, 1.0);
        }
        CGContextSetInterpolationQuality(ctx, 3); // kCGInterpolationHigh
        let rect = CGRect::new(
            &core_graphics::geometry::CGPoint::new(0.0, 0.0),
            &core_graphics::geometry::CGSize::new(dst_w as f64, dst_h as f64),
        );
        CGContextDrawImage(ctx, rect, image.as_ptr() as *const c_void);
        let scaled_ref = CGBitmapContextCreateImage(ctx);
        CGContextRelease(ctx);
        if scaled_ref.is_null() {
            return (image, src_w, src_h, 1.0);
        }
        let scaled = CGImage::from_ptr(scaled_ref as *mut _);
        (scaled, dst_w, dst_h, ratio)
    }
}

/// Convert a CGImage to JPEG bytes using ImageIO.
fn cgimage_to_jpeg(
    image: &core_graphics::image::CGImage,
    quality: f64,
) -> Result<Vec<u8>, ToolError> {
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

        let jpeg_uti = CFString::new("public.jpeg");
        let dest = CGImageDestinationCreateWithData(
            mutable_data,
            jpeg_uti.as_concrete_TypeRef() as *const c_void,
            1,
            std::ptr::null(),
        );
        if dest.is_null() {
            core_foundation::base::CFRelease(mutable_data as _);
            return Err(ToolError::ExecutionFailed(
                "Failed to create JPEG image destination".into(),
            ));
        }

        let quality_key = CFString::new("kCGImageDestinationLossyCompressionQuality");
        let quality_val = CFNumber::from(quality as f32);
        let props =
            CFDictionary::from_CFType_pairs(&[(quality_key.as_CFType(), quality_val.as_CFType())]);
        CGImageDestinationAddImage(
            dest,
            image.as_ptr() as *const c_void,
            props.as_concrete_TypeRef() as *const c_void,
        );

        if !CGImageDestinationFinalize(dest) {
            core_foundation::base::CFRelease(dest as _);
            core_foundation::base::CFRelease(mutable_data as _);
            return Err(ToolError::ExecutionFailed(
                "Failed to finalize JPEG image".into(),
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

//! Typed accessors for `CFDictionary` keys returned by CG window APIs.
//!
//! `CGWindowListCopyWindowInfo` returns a `CFArray<CFDictionary>` with mixed
//! Objective-C value types (`CFNumber`, `CFString`, nested `CFDictionary`).
//! These helpers wrap the unsafe `find` + `wrap_under_get_rule` dance so the
//! call sites in `windows.rs` stay readable.

use core_foundation::base::TCFType;
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_graphics::geometry::CGRect;
use std::ffi::c_void;

pub(super) fn dict_get_i32(dict: &CFDictionary, key: &str) -> Option<i32> {
    let cf_key = CFString::new(key);
    let value = dict.find(cf_key.as_concrete_TypeRef() as *const c_void)?;
    let num: CFNumber = unsafe { CFNumber::wrap_under_get_rule(*value as *const _) };
    num.to_i32()
}

pub(super) fn dict_get_string(dict: &CFDictionary, key: &str) -> Option<String> {
    let cf_key = CFString::new(key);
    let value = dict.find(cf_key.as_concrete_TypeRef() as *const c_void)?;
    let cf_str: CFString = unsafe { CFString::wrap_under_get_rule(*value as *const _) };
    Some(cf_str.to_string())
}

pub(super) fn dict_get_rect(dict: &CFDictionary, key: &str) -> Option<CGRect> {
    let cf_key = CFString::new(key);
    let value = dict.find(cf_key.as_concrete_TypeRef() as *const c_void)?;
    let bounds_dict: CFDictionary =
        unsafe { CFDictionary::wrap_under_get_rule(*value as *const _) };

    let x = dict_get_f64(&bounds_dict, "X")?;
    let y = dict_get_f64(&bounds_dict, "Y")?;
    let width = dict_get_f64(&bounds_dict, "Width")?;
    let height = dict_get_f64(&bounds_dict, "Height")?;

    Some(CGRect::new(
        &core_graphics::geometry::CGPoint::new(x, y),
        &core_graphics::geometry::CGSize::new(width, height),
    ))
}

fn dict_get_f64(dict: &CFDictionary, key: &str) -> Option<f64> {
    let cf_key = CFString::new(key);
    let value = dict.find(cf_key.as_concrete_TypeRef() as *const c_void)?;
    let num: CFNumber = unsafe { CFNumber::wrap_under_get_rule(*value as *const _) };
    num.to_f64()
}

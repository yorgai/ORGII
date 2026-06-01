//! Build script for `app_platform`.
//!
//! On macOS, compiles `src/objc_bridge/objc_catch.m` into a static lib
//! (`liborgii_objc_catch.a`) and links Foundation. The Rust FFI in
//! `objc_bridge::mod` declares the matching `extern "C"` symbols.
//!
//! On non-macOS targets this is a no-op — the `objc_bridge` module is
//! gated behind `#[cfg(target_os = "macos")]` and never compiled.

fn main() {
    #[cfg(target_os = "macos")]
    build_objc_bridge();
}

#[cfg(target_os = "macos")]
fn build_objc_bridge() {
    let src = "src/objc_bridge/objc_catch.m";
    println!("cargo:rerun-if-changed={}", src);

    cc::Build::new()
        .file(src)
        .flag("-fobjc-arc")
        .flag("-fobjc-exceptions")
        .compile("orgii_objc_catch");

    println!("cargo:rustc-link-lib=framework=Foundation");
}

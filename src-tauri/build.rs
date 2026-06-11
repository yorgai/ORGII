//! Tauri build script: codegen, resource bundling, and platform hooks for `tauri_build::build()`.
//!
//! Invoked automatically by Cargo before compiling the library; keep this file free of heavy
//! logic so configure-time stays fast.
//!
//! After `tauri_build::build()`, writes `OUT_DIR/tauri_invoke_handler_expr.rs` from
//! `src/commands/handler_list.inc` so `lib.rs` can `include!` the `tauri::generate_handler![...]`
//! invocation without a 900+ line macro in source control.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const OPTIONAL_SIDECAR_PLACEHOLDER_MARKER: &str = "ORGII_GENERATED_OPTIONAL_SIDECAR_PLACEHOLDER";

// Peekaboo, agent-browser, and dugite/git are downloaded at runtime into
// ~/.orgii/bin/ (post-notarized download strategy) and are no longer bundled
// inside the .app. No placeholder generation is needed for them.
const OPTIONAL_SIDECAR_RESOURCES: &[&str] = &[];

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    ensure_optional_sidecar_resources(&manifest_dir);

    tauri_build::build();

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR must be set"));
    let handler_list_path = manifest_dir.join("src/commands/handler_list.inc");

    println!("cargo:rerun-if-changed={}", handler_list_path.display());

    let fragment = fs::read_to_string(&handler_list_path).unwrap_or_else(|err| {
        panic!("failed to read {}: {}", handler_list_path.display(), err);
    });

    let generated = format!("tauri::generate_handler![\n{}]\n", fragment.trim_end());

    let out_path = out_dir.join("tauri_invoke_handler_expr.rs");
    fs::write(&out_path, generated).unwrap_or_else(|err| {
        panic!("failed to write {}: {}", out_path.display(), err);
    });
}

fn ensure_optional_sidecar_resources(manifest_dir: &Path) {
    for resource in OPTIONAL_SIDECAR_RESOURCES {
        println!(
            "cargo:rerun-if-changed={}",
            manifest_dir.join(resource).display()
        );
        let path = manifest_dir.join(resource);
        if path.exists() {
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap_or_else(|err| {
                panic!(
                    "failed to create optional sidecar resource directory {}: {}",
                    parent.display(),
                    err
                );
            });
        }
        fs::write(&path, optional_sidecar_placeholder(resource)).unwrap_or_else(|err| {
            panic!(
                "failed to create optional sidecar placeholder {}: {}",
                path.display(),
                err
            );
        });
        println!(
            "cargo:warning=created optional sidecar placeholder {}; install the real binary to enable that capability",
            path.display()
        );
    }
}

fn optional_sidecar_placeholder(resource: &str) -> String {
    format!(
        "{}\nresource={}\nThis placeholder only satisfies Tauri resource validation. Replace it with the real sidecar binary/metadata to enable the capability.\n",
        OPTIONAL_SIDECAR_PLACEHOLDER_MARKER,
        resource
    )
}

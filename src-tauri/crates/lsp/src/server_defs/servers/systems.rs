//! Systems language server definitions: Rust, C/C++, Go, Zig.

use std::path::{Path, PathBuf};

use crate::install_pipeline::InstallMethod;
use crate::root_detection::{
    find_nearest_root, find_workspace_root, RootPattern, CPP_PATTERN, GO_PATTERN,
    GO_WORKSPACE_MARKERS, RUST_PATTERN, ZIG_PATTERN,
};
use crate::server_defs::ServerDef;

pub struct RustServer;

impl ServerDef for RustServer {
    fn id(&self) -> &'static str {
        "rust"
    }

    fn display_name(&self) -> &'static str {
        "rust-analyzer"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["rs"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["rust"]
    }

    fn root_pattern(&self) -> RootPattern {
        RUST_PATTERN
    }

    fn install_method(&self) -> InstallMethod {
        // rust-analyzer is best installed via rustup
        InstallMethod::RequirePath
    }

    fn binary_name(&self) -> &'static str {
        "rust-analyzer"
    }

    fn command_args(&self) -> &'static [&'static str] {
        &[] // rust-analyzer doesn't need --stdio
    }

    fn install_hint(&self) -> String {
        "rustup component add rust-analyzer".to_string()
    }

    fn find_root(&self, file: &Path, workspace_root: &Path) -> Option<PathBuf> {
        // For Rust, we want to find the workspace Cargo.toml if it exists
        find_workspace_root(file, &RUST_PATTERN, &["Cargo.toml"], workspace_root)
            .or_else(|| find_nearest_root(file, &RUST_PATTERN, workspace_root))
    }
}

pub struct CppServer;

impl ServerDef for CppServer {
    fn id(&self) -> &'static str {
        "cpp"
    }

    fn display_name(&self) -> &'static str {
        "clangd"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["c", "cpp", "cc", "cxx", "h", "hpp", "hxx"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["c", "cpp"]
    }

    fn root_pattern(&self) -> RootPattern {
        CPP_PATTERN
    }

    fn install_method(&self) -> InstallMethod {
        // clangd is best installed via system package manager
        InstallMethod::RequirePath
    }

    fn binary_name(&self) -> &'static str {
        "clangd"
    }

    fn command_args(&self) -> &'static [&'static str] {
        &["--background-index"]
    }

    fn install_hint(&self) -> String {
        "brew install llvm".to_string()
    }
}

pub struct GoServer;

impl ServerDef for GoServer {
    fn id(&self) -> &'static str {
        "go"
    }

    fn display_name(&self) -> &'static str {
        "gopls"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["go"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["go"]
    }

    fn root_pattern(&self) -> RootPattern {
        GO_PATTERN
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::Go {
            module: "golang.org/x/tools/gopls@latest",
        }
    }

    fn binary_name(&self) -> &'static str {
        "gopls"
    }

    fn command_args(&self) -> &'static [&'static str] {
        &[]
    }

    fn find_root(&self, file: &Path, workspace_root: &Path) -> Option<PathBuf> {
        // For Go, check for go.work first (multi-module workspace)
        find_workspace_root(file, &GO_PATTERN, GO_WORKSPACE_MARKERS, workspace_root)
            .or_else(|| find_nearest_root(file, &GO_PATTERN, workspace_root))
    }
}

pub struct ZigServer;

impl ServerDef for ZigServer {
    fn id(&self) -> &'static str {
        "zig"
    }

    fn display_name(&self) -> &'static str {
        "Zig Language Server"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["zig"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["zig"]
    }

    fn root_pattern(&self) -> RootPattern {
        ZIG_PATTERN
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::RequirePath
    }

    fn binary_name(&self) -> &'static str {
        "zls"
    }

    fn command_args(&self) -> &'static [&'static str] {
        &[]
    }

    fn install_hint(&self) -> String {
        "brew install zls".to_string()
    }
}

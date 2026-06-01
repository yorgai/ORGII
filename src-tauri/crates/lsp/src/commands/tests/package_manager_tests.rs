//! Tests for package manager detection and package name extraction

use super::*;

// ============================================
// detect_install_type tests
// ============================================

#[test]
fn test_detect_install_type_npm() {
    assert_eq!(detect_install_type("npm install -g typescript"), "npm");
    assert_eq!(
        detect_install_type("npm install -g typescript-language-server"),
        "npm"
    );
}

#[test]
fn test_detect_install_type_pnpm() {
    assert_eq!(detect_install_type("pnpm add -g typescript"), "npm");
}

#[test]
fn test_detect_install_type_yarn() {
    assert_eq!(detect_install_type("yarn global add typescript"), "npm");
}

#[test]
fn test_detect_install_type_bun() {
    assert_eq!(detect_install_type("bun add -g typescript"), "npm");
}

#[test]
fn test_detect_install_type_pip() {
    assert_eq!(detect_install_type("pip install pyright"), "pip");
    assert_eq!(detect_install_type("pip3 install pyright"), "pip");
}

#[test]
fn test_detect_install_type_cargo() {
    assert_eq!(detect_install_type("cargo install rust-analyzer"), "cargo");
}

#[test]
fn test_detect_install_type_rustup() {
    assert_eq!(
        detect_install_type("rustup component add rust-analyzer"),
        "rustup"
    );
}

#[test]
fn test_detect_install_type_gem() {
    assert_eq!(detect_install_type("gem install solargraph"), "gem");
}

#[test]
fn test_detect_install_type_go() {
    assert_eq!(
        detect_install_type("go install golang.org/x/tools/gopls@latest"),
        "go"
    );
}

#[test]
fn test_detect_install_type_ghcup() {
    assert_eq!(detect_install_type("ghcup install hls"), "ghcup");
}

#[test]
fn test_detect_install_type_opam() {
    assert_eq!(detect_install_type("opam install ocaml-lsp-server"), "opam");
}

#[test]
fn test_detect_install_type_brew() {
    assert_eq!(
        detect_install_type("brew install lua-language-server"),
        "brew"
    );
}

#[test]
fn test_detect_install_type_unknown() {
    assert_eq!(
        detect_install_type("Install from https://example.com"),
        "unknown"
    );
    assert_eq!(detect_install_type("Download the binary"), "unknown");
}

#[test]
fn test_detect_install_type_case_insensitive() {
    assert_eq!(detect_install_type("NPM install -g typescript"), "npm");
    assert_eq!(detect_install_type("PIP install pyright"), "pip");
    assert_eq!(detect_install_type("CARGO install foo"), "cargo");
}

// ============================================
// extract_package_name tests
// ============================================

#[test]
fn test_extract_package_npm_single() {
    assert_eq!(
        extract_package_name("npm install -g typescript-language-server"),
        Some("typescript-language-server".to_string())
    );
}

#[test]
fn test_extract_package_npm_multiple() {
    assert_eq!(
        extract_package_name("npm install -g typescript-language-server typescript"),
        Some("typescript-language-server typescript".to_string())
    );
}

#[test]
fn test_extract_package_pnpm() {
    assert_eq!(
        extract_package_name("pnpm add -g typescript"),
        Some("typescript".to_string())
    );
}

#[test]
fn test_extract_package_yarn() {
    assert_eq!(
        extract_package_name("yarn global add typescript"),
        Some("typescript".to_string())
    );
}

#[test]
fn test_extract_package_pip() {
    assert_eq!(
        extract_package_name("pip install pyright"),
        Some("pyright".to_string())
    );
    assert_eq!(
        extract_package_name("pip3 install pyright"),
        Some("pyright".to_string())
    );
}

#[test]
fn test_extract_package_cargo() {
    assert_eq!(
        extract_package_name("cargo install rust-analyzer"),
        Some("rust-analyzer".to_string())
    );
}

#[test]
fn test_extract_package_rustup() {
    assert_eq!(
        extract_package_name("rustup component add rust-analyzer"),
        Some("rust-analyzer".to_string())
    );
}

#[test]
fn test_extract_package_gem() {
    assert_eq!(
        extract_package_name("gem install solargraph"),
        Some("solargraph".to_string())
    );
}

#[test]
fn test_extract_package_go() {
    assert_eq!(
        extract_package_name("go install golang.org/x/tools/gopls@latest"),
        Some("golang.org/x/tools/gopls@latest".to_string())
    );
}

#[test]
fn test_extract_package_brew() {
    assert_eq!(
        extract_package_name("brew install lua-language-server"),
        Some("lua-language-server".to_string())
    );
}

#[test]
fn test_extract_package_unknown() {
    assert_eq!(
        extract_package_name("Install from https://example.com"),
        None
    );
    assert_eq!(extract_package_name("Download the binary"), None);
}

#[test]
fn test_extract_package_empty_after_install() {
    // Edge case: "pip install" with no package
    assert_eq!(extract_package_name("pip install"), None);
}

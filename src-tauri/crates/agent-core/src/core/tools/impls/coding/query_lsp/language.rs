//! File-extension → LSP language ID mapping and workspace root inference.
//!
//! Two distinct mappings live here:
//!
//! - [`language_for_file`] returns the LSP **server** key (e.g. `typescript`
//!   for both `.ts` and `.tsx`). Used to pick which server to start.
//! - [`document_language_id_for_file`] returns the LSP **document** language
//!   ID (e.g. `typescriptreact` for `.tsx`). Used in `textDocument/didOpen`.
//!
//! Workspace root inference walks up from a file looking for `.git`,
//! `package.json`, `Cargo.toml`, etc. — see [`infer_workspace_root`].

use std::path::Path;
use std::path::PathBuf;

/// Look at the file's basename (case-insensitive) to spot files that the
/// language is determined by name rather than extension — `Dockerfile`,
/// `Dockerfile.dev`, `Containerfile`, `Makefile`, etc. Currently only
/// Dockerfile-shaped names are wired because that's the only such server
/// in `STATIC_SERVERS`.
fn language_for_special_filename(file_path: &str) -> Option<&'static str> {
    let basename = Path::new(file_path)
        .file_name()?
        .to_str()?
        .to_ascii_lowercase();
    if basename == "dockerfile"
        || basename == "containerfile"
        || basename.starts_with("dockerfile.")
        || basename.starts_with("containerfile.")
    {
        return Some("dockerfile");
    }
    None
}

/// File extension → LSP **server** language ID.
///
/// Comparison is case-insensitive (`foo.TS` and `foo.ts` both map to
/// `typescript`). Files whose language is determined by basename rather
/// than extension (`Dockerfile`) are handled separately.
pub(super) fn language_for_file(file_path: &str) -> Option<&'static str> {
    if let Some(language) = language_for_special_filename(file_path) {
        return Some(language);
    }

    let ext = file_path.rsplit('.').next()?.to_ascii_lowercase();
    match ext.as_str() {
        "ts" | "tsx" | "mts" | "cts" => Some("typescript"),
        "js" | "jsx" | "mjs" | "cjs" => Some("javascript"),
        "rs" => Some("rust"),
        "py" | "pyi" => Some("python"),
        "go" => Some("go"),
        // The C/C++ server (clangd) accepts both as language id "c" or
        // "cpp". `LspManager::servers_for_language_id` matches `"c"` to
        // CppServer because the server declares `language_ids: ["c","cpp"]`.
        "c" | "h" => Some("c"),
        "cpp" | "cc" | "cxx" | "hpp" | "hxx" => Some("cpp"),
        "java" => Some("java"),
        "kt" | "kts" => Some("kotlin"),
        "scala" | "sc" => Some("scala"),
        "rb" | "rake" | "gemspec" => Some("ruby"),
        "php" => Some("php"),
        "swift" => Some("swift"),
        "cs" => Some("csharp"),
        "lua" => Some("lua"),
        "hs" | "lhs" => Some("haskell"),
        "ml" | "mli" => Some("ocaml"),
        "ex" | "exs" => Some("elixir"),
        "clj" | "cljs" | "cljc" | "edn" => Some("clojure"),
        "html" | "htm" => Some("html"),
        "css" | "scss" | "sass" | "less" => Some("css"),
        "json" | "jsonc" => Some("json"),
        "yaml" | "yml" => Some("yaml"),
        "md" | "mdx" => Some("markdown"),
        "sh" | "bash" | "zsh" => Some("shellscript"),
        "dockerfile" => Some("dockerfile"),
        "sql" => Some("sql"),
        "vue" => Some("vue"),
        "svelte" => Some("svelte"),
        "zig" => Some("zig"),
        _ => None,
    }
}

/// File extension → LSP **document** language ID (`textDocument.languageId`).
///
/// TypeScript / JavaScript split their server-key (`typescript`) from their
/// document language id (`typescriptreact` for `.tsx`). Everything else
/// shares the same value, which we delegate to `language_for_file`.
pub(super) fn document_language_id_for_file(file_path: &str) -> Option<&'static str> {
    if let Some(language) = language_for_special_filename(file_path) {
        return Some(language);
    }

    let ext = file_path.rsplit('.').next()?.to_ascii_lowercase();
    match ext.as_str() {
        "ts" | "mts" | "cts" => Some("typescript"),
        "tsx" => Some("typescriptreact"),
        "js" | "mjs" | "cjs" => Some("javascript"),
        "jsx" => Some("javascriptreact"),
        _ => language_for_file(file_path),
    }
}

fn has_workspace_root_marker(dir: &Path) -> bool {
    const ROOT_MARKERS: &[&str] = &[
        ".git",
        "package.json",
        "tsconfig.json",
        "jsconfig.json",
        "Cargo.toml",
        "pyproject.toml",
        "go.mod",
        "pom.xml",
        "build.gradle",
        "build.gradle.kts",
        "Gemfile",
        "composer.json",
    ];

    ROOT_MARKERS.iter().any(|marker| dir.join(marker).exists())
}

/// Walk up from `file_path` looking for a workspace root marker. Falls back
/// to `fallback_workspace_root` (the open IDE workspace) when no marker is
/// found and the file lives inside it; otherwise returns the file's
/// containing directory.
pub(super) fn infer_workspace_root(file_path: &str, fallback_workspace_root: &Path) -> PathBuf {
    let file_path = Path::new(file_path);
    let start_dir = file_path.parent().unwrap_or(file_path);
    let within_workspace = start_dir.starts_with(fallback_workspace_root);
    let mut current = Some(start_dir);

    while let Some(dir) = current {
        if has_workspace_root_marker(dir) {
            return dir.to_path_buf();
        }

        if within_workspace && dir == fallback_workspace_root {
            break;
        }

        current = dir.parent();
    }

    if within_workspace {
        fallback_workspace_root.to_path_buf()
    } else {
        start_dir.to_path_buf()
    }
}

/// Convert a file path to a `file://` URI.
pub(super) fn path_to_uri(file_path: &str) -> String {
    if file_path.starts_with("file://") {
        file_path.to_string()
    } else {
        format!("file://{}", file_path)
    }
}

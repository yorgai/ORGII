//! Built-in LSP Server Definitions
//!
//! Implementations for all supported language servers.

use std::path::{Path, PathBuf};

use super::ServerDef;
use crate::install_pipeline::InstallMethod;
use crate::root_detection::*;

// ============================================
// Static Server Registry
// ============================================

/// All built-in server definitions as static references.
pub static STATIC_SERVERS: &[&dyn ServerDef] = &[
    // Web Languages
    &TypeScriptServer,
    &HtmlServer,
    &CssServer,
    &JsonServer,
    &VueServer,
    &SvelteServer,
    // Systems Languages
    &RustServer,
    &CppServer,
    &GoServer,
    &ZigServer,
    // JVM Languages
    &JavaServer,
    &KotlinServer,
    &ScalaServer,
    // Scripting Languages
    &PythonServer,
    &RubyServer,
    &PhpServer,
    &LuaServer,
    &ElixirServer,
    // Apple/Microsoft
    &SwiftServer,
    &CSharpServer,
    // Functional Languages
    &HaskellServer,
    &OcamlServer,
    &ClojureServer,
    // Config/Data Languages
    &YamlServer,
    &MarkdownServer,
    // Shell/DevOps
    &ShellServer,
    &DockerfileServer,
    &SqlServer,
];

/// Get all servers as boxed trait objects (for runtime polymorphism).
pub fn all_servers() -> Vec<Box<dyn ServerDef>> {
    STATIC_SERVERS
        .iter()
        .map(|s| -> Box<dyn ServerDef> {
            // We need to clone/box each server - since they're static, we just create new instances
            match s.id() {
                "typescript" => Box::new(TypeScriptServer),
                "html" => Box::new(HtmlServer),
                "css" => Box::new(CssServer),
                "json" => Box::new(JsonServer),
                "vue" => Box::new(VueServer),
                "svelte" => Box::new(SvelteServer),
                "rust" => Box::new(RustServer),
                "cpp" => Box::new(CppServer),
                "go" => Box::new(GoServer),
                "zig" => Box::new(ZigServer),
                "java" => Box::new(JavaServer),
                "kotlin" => Box::new(KotlinServer),
                "scala" => Box::new(ScalaServer),
                "python" => Box::new(PythonServer),
                "ruby" => Box::new(RubyServer),
                "php" => Box::new(PhpServer),
                "lua" => Box::new(LuaServer),
                "elixir" => Box::new(ElixirServer),
                "swift" => Box::new(SwiftServer),
                "csharp" => Box::new(CSharpServer),
                "haskell" => Box::new(HaskellServer),
                "ocaml" => Box::new(OcamlServer),
                "clojure" => Box::new(ClojureServer),
                "yaml" => Box::new(YamlServer),
                "markdown" => Box::new(MarkdownServer),
                "shellscript" => Box::new(ShellServer),
                "dockerfile" => Box::new(DockerfileServer),
                "sql" => Box::new(SqlServer),
                _ => unreachable!("Unknown server ID"),
            }
        })
        .collect()
}

// ============================================
// Web Languages
// ============================================

pub struct TypeScriptServer;

impl ServerDef for TypeScriptServer {
    fn id(&self) -> &'static str {
        "typescript"
    }

    fn display_name(&self) -> &'static str {
        "TypeScript Language Server"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &[
            "typescript",
            "typescriptreact",
            "javascript",
            "javascriptreact",
        ]
    }

    fn root_pattern(&self) -> RootPattern {
        TYPESCRIPT_PATTERN
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::Npm {
            package: "typescript-language-server typescript",
        }
    }

    fn binary_name(&self) -> &'static str {
        "typescript-language-server"
    }

    fn initialization_options(&self, root: &Path) -> Option<serde_json::Value> {
        // Inlay hints are language-server-level preferences and are safe
        // to send unconditionally — the editor decides whether to render
        // them. The `tsdk` pointer is only added when the workspace has a
        // matching `node_modules/typescript/lib`, since otherwise the
        // server falls back to its bundled tsserver and a missing
        // directory just creates noise.
        let mut options = serde_json::json!({
            "preferences": {
                "includeInlayParameterNameHints": "all",
                "includeInlayFunctionParameterTypeHints": true,
                "includeInlayVariableTypeHints": true,
                "includeInlayPropertyDeclarationTypeHints": true,
                "includeInlayFunctionLikeReturnTypeHints": true
            }
        });

        let tsdk = root.join("node_modules").join("typescript").join("lib");
        if tsdk.is_dir() {
            options["typescript"] = serde_json::json!({
                "tsdk": tsdk.to_string_lossy(),
                "enablePromptUseWorkspaceTsdk": true
            });
        }

        Some(options)
    }

    fn workspace_configuration(&self, root: &Path) -> Option<serde_json::Value> {
        let tsdk = root.join("node_modules").join("typescript").join("lib");
        let mut typescript = serde_json::json!({
            "format": { "enable": true },
            "validate": { "enable": true }
        });
        if tsdk.is_dir() {
            typescript["tsdk"] = serde_json::Value::String(tsdk.to_string_lossy().into_owned());
            typescript["enablePromptUseWorkspaceTsdk"] = serde_json::Value::Bool(true);
        }

        Some(serde_json::json!({
            "typescript": typescript,
            "javascript": {
                "format": { "enable": true },
                "validate": { "enable": true }
            }
        }))
    }
}

pub struct HtmlServer;

impl ServerDef for HtmlServer {
    fn id(&self) -> &'static str {
        "html"
    }

    fn display_name(&self) -> &'static str {
        "HTML Language Server"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["html", "htm"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["html"]
    }

    fn root_pattern(&self) -> RootPattern {
        TYPESCRIPT_PATTERN // HTML often lives in web projects
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::Npm {
            package: "vscode-langservers-extracted",
        }
    }

    fn binary_name(&self) -> &'static str {
        "vscode-html-language-server"
    }
}

pub struct CssServer;

impl ServerDef for CssServer {
    fn id(&self) -> &'static str {
        "css"
    }

    fn display_name(&self) -> &'static str {
        "CSS Language Server"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["css", "scss", "sass", "less"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["css", "scss", "sass", "less"]
    }

    fn root_pattern(&self) -> RootPattern {
        TYPESCRIPT_PATTERN
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::Npm {
            package: "vscode-langservers-extracted",
        }
    }

    fn binary_name(&self) -> &'static str {
        "vscode-css-language-server"
    }
}

pub struct JsonServer;

impl ServerDef for JsonServer {
    fn id(&self) -> &'static str {
        "json"
    }

    fn display_name(&self) -> &'static str {
        "JSON Language Server"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["json", "jsonc"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["json", "jsonc"]
    }

    fn root_pattern(&self) -> RootPattern {
        GENERIC_PATTERN
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::Npm {
            package: "vscode-langservers-extracted",
        }
    }

    fn binary_name(&self) -> &'static str {
        "vscode-json-language-server"
    }
}

pub struct VueServer;

impl ServerDef for VueServer {
    fn id(&self) -> &'static str {
        "vue"
    }

    fn display_name(&self) -> &'static str {
        "Vue Language Server"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["vue"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["vue"]
    }

    fn root_pattern(&self) -> RootPattern {
        TYPESCRIPT_PATTERN
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::Npm {
            package: "@vue/language-server",
        }
    }

    fn binary_name(&self) -> &'static str {
        "vue-language-server"
    }
}

pub struct SvelteServer;

impl ServerDef for SvelteServer {
    fn id(&self) -> &'static str {
        "svelte"
    }

    fn display_name(&self) -> &'static str {
        "Svelte Language Server"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["svelte"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["svelte"]
    }

    fn root_pattern(&self) -> RootPattern {
        TYPESCRIPT_PATTERN
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::Npm {
            package: "svelte-language-server",
        }
    }

    fn binary_name(&self) -> &'static str {
        "svelteserver"
    }
}

// ============================================
// Systems Languages
// ============================================

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

// ============================================
// JVM Languages
// ============================================

pub struct JavaServer;

impl ServerDef for JavaServer {
    fn id(&self) -> &'static str {
        "java"
    }

    fn display_name(&self) -> &'static str {
        "Eclipse JDT Language Server"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["java"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["java"]
    }

    fn root_pattern(&self) -> RootPattern {
        JAVA_PATTERN
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::RequirePath
    }

    fn binary_name(&self) -> &'static str {
        "jdtls"
    }

    fn command_args(&self) -> &'static [&'static str] {
        &[]
    }

    fn install_hint(&self) -> String {
        "brew install jdtls".to_string()
    }
}

pub struct KotlinServer;

impl ServerDef for KotlinServer {
    fn id(&self) -> &'static str {
        "kotlin"
    }

    fn display_name(&self) -> &'static str {
        "Kotlin Language Server"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["kt", "kts"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["kotlin"]
    }

    fn root_pattern(&self) -> RootPattern {
        JAVA_PATTERN // Kotlin uses same build tools
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::RequirePath
    }

    fn binary_name(&self) -> &'static str {
        "kotlin-language-server"
    }

    fn command_args(&self) -> &'static [&'static str] {
        &[]
    }

    fn install_hint(&self) -> String {
        "brew install kotlin-language-server".to_string()
    }
}

pub struct ScalaServer;

impl ServerDef for ScalaServer {
    fn id(&self) -> &'static str {
        "scala"
    }

    fn display_name(&self) -> &'static str {
        "Metals"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["scala", "sc"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["scala"]
    }

    fn root_pattern(&self) -> RootPattern {
        RootPattern {
            include: &["build.sbt", "build.sc", ".scala-build"],
            exclude: &[],
        }
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::RequirePath
    }

    fn binary_name(&self) -> &'static str {
        "metals"
    }

    fn command_args(&self) -> &'static [&'static str] {
        &[]
    }

    fn install_hint(&self) -> String {
        "brew install metals".to_string()
    }
}

// ============================================
// Scripting Languages
// ============================================

pub struct PythonServer;

impl ServerDef for PythonServer {
    fn id(&self) -> &'static str {
        "python"
    }

    fn display_name(&self) -> &'static str {
        "Pyright"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["py", "pyi"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["python"]
    }

    fn root_pattern(&self) -> RootPattern {
        PYTHON_PATTERN
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::Npm { package: "pyright" }
    }

    fn binary_name(&self) -> &'static str {
        "pyright-langserver"
    }

    fn initialization_options(&self, root: &Path) -> Option<serde_json::Value> {
        // Check for venv and provide pythonPath
        let venv_paths = [
            root.join(".venv/bin/python"),
            root.join("venv/bin/python"),
            root.join(".env/bin/python"),
        ];

        for venv_python in &venv_paths {
            if venv_python.exists() {
                return Some(serde_json::json!({
                    "python": {
                        "pythonPath": venv_python.to_string_lossy()
                    }
                }));
            }
        }

        None
    }
}

pub struct RubyServer;

impl ServerDef for RubyServer {
    fn id(&self) -> &'static str {
        "ruby"
    }

    fn display_name(&self) -> &'static str {
        "Solargraph"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["rb", "rake", "gemspec"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["ruby"]
    }

    fn root_pattern(&self) -> RootPattern {
        RUBY_PATTERN
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::RequirePath // gem install is workspace-specific
    }

    fn binary_name(&self) -> &'static str {
        "solargraph"
    }

    fn command_args(&self) -> &'static [&'static str] {
        &["stdio"]
    }

    fn install_hint(&self) -> String {
        "gem install solargraph".to_string()
    }
}

pub struct PhpServer;

impl ServerDef for PhpServer {
    fn id(&self) -> &'static str {
        "php"
    }

    fn display_name(&self) -> &'static str {
        "Intelephense"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["php"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["php"]
    }

    fn root_pattern(&self) -> RootPattern {
        PHP_PATTERN
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::Npm {
            package: "intelephense",
        }
    }

    fn binary_name(&self) -> &'static str {
        "intelephense"
    }
}

pub struct LuaServer;

impl ServerDef for LuaServer {
    fn id(&self) -> &'static str {
        "lua"
    }

    fn display_name(&self) -> &'static str {
        "Lua Language Server"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["lua"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["lua"]
    }

    fn root_pattern(&self) -> RootPattern {
        RootPattern {
            include: &[".luarc.json", ".luacheckrc", "rockspec"],
            exclude: &[],
        }
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::RequirePath
    }

    fn binary_name(&self) -> &'static str {
        "lua-language-server"
    }

    fn command_args(&self) -> &'static [&'static str] {
        &[]
    }

    fn install_hint(&self) -> String {
        "brew install lua-language-server".to_string()
    }
}

pub struct ElixirServer;

impl ServerDef for ElixirServer {
    fn id(&self) -> &'static str {
        "elixir"
    }

    fn display_name(&self) -> &'static str {
        "Elixir LS"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["ex", "exs"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["elixir"]
    }

    fn root_pattern(&self) -> RootPattern {
        ELIXIR_PATTERN
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::RequirePath
    }

    fn binary_name(&self) -> &'static str {
        "elixir-ls"
    }

    fn command_args(&self) -> &'static [&'static str] {
        &[]
    }

    fn install_hint(&self) -> String {
        "brew install elixir-ls".to_string()
    }
}

// ============================================
// Apple/Microsoft
// ============================================

pub struct SwiftServer;

impl ServerDef for SwiftServer {
    fn id(&self) -> &'static str {
        "swift"
    }

    fn display_name(&self) -> &'static str {
        "SourceKit-LSP"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["swift"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["swift"]
    }

    fn root_pattern(&self) -> RootPattern {
        SWIFT_PATTERN
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::RequirePath // Comes with Xcode
    }

    fn binary_name(&self) -> &'static str {
        "sourcekit-lsp"
    }

    fn command_args(&self) -> &'static [&'static str] {
        &[]
    }

    fn install_hint(&self) -> String {
        "Included with Xcode or Swift toolchain".to_string()
    }
}

pub struct CSharpServer;

impl ServerDef for CSharpServer {
    fn id(&self) -> &'static str {
        "csharp"
    }

    fn display_name(&self) -> &'static str {
        "OmniSharp"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["cs"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["csharp"]
    }

    fn root_pattern(&self) -> RootPattern {
        CSHARP_PATTERN
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::RequirePath
    }

    fn binary_name(&self) -> &'static str {
        "OmniSharp"
    }

    fn command_args(&self) -> &'static [&'static str] {
        &["-lsp"]
    }

    fn install_hint(&self) -> String {
        "brew install omnisharp/omnisharp-roslyn/omnisharp".to_string()
    }
}

// ============================================
// Functional Languages
// ============================================

pub struct HaskellServer;

impl ServerDef for HaskellServer {
    fn id(&self) -> &'static str {
        "haskell"
    }

    fn display_name(&self) -> &'static str {
        "Haskell Language Server"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["hs", "lhs"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["haskell"]
    }

    fn root_pattern(&self) -> RootPattern {
        RootPattern {
            include: &["cabal.project", "stack.yaml", "*.cabal", "package.yaml"],
            exclude: &[],
        }
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::RequirePath
    }

    fn binary_name(&self) -> &'static str {
        "haskell-language-server-wrapper"
    }

    fn command_args(&self) -> &'static [&'static str] {
        &["--lsp"]
    }

    fn install_hint(&self) -> String {
        "ghcup install hls".to_string()
    }
}

pub struct OcamlServer;

impl ServerDef for OcamlServer {
    fn id(&self) -> &'static str {
        "ocaml"
    }

    fn display_name(&self) -> &'static str {
        "OCaml LSP"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["ml", "mli"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["ocaml"]
    }

    fn root_pattern(&self) -> RootPattern {
        RootPattern {
            include: &["dune-project", "dune", "*.opam"],
            exclude: &[],
        }
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::RequirePath
    }

    fn binary_name(&self) -> &'static str {
        "ocamllsp"
    }

    fn command_args(&self) -> &'static [&'static str] {
        &[]
    }

    fn install_hint(&self) -> String {
        "opam install ocaml-lsp-server".to_string()
    }
}

pub struct ClojureServer;

impl ServerDef for ClojureServer {
    fn id(&self) -> &'static str {
        "clojure"
    }

    fn display_name(&self) -> &'static str {
        "Clojure LSP"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["clj", "cljs", "cljc", "edn"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["clojure", "clojurescript"]
    }

    fn root_pattern(&self) -> RootPattern {
        RootPattern {
            include: &["deps.edn", "project.clj", "shadow-cljs.edn"],
            exclude: &[],
        }
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::RequirePath
    }

    fn binary_name(&self) -> &'static str {
        "clojure-lsp"
    }

    fn command_args(&self) -> &'static [&'static str] {
        &[]
    }

    fn install_hint(&self) -> String {
        "brew install clojure-lsp/brew/clojure-lsp-native".to_string()
    }
}

// ============================================
// Config/Data Languages
// ============================================

pub struct YamlServer;

impl ServerDef for YamlServer {
    fn id(&self) -> &'static str {
        "yaml"
    }

    fn display_name(&self) -> &'static str {
        "YAML Language Server"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["yaml", "yml"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["yaml"]
    }

    fn root_pattern(&self) -> RootPattern {
        GENERIC_PATTERN
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::Npm {
            package: "yaml-language-server",
        }
    }

    fn binary_name(&self) -> &'static str {
        "yaml-language-server"
    }
}

pub struct MarkdownServer;

impl ServerDef for MarkdownServer {
    fn id(&self) -> &'static str {
        "markdown"
    }

    fn display_name(&self) -> &'static str {
        "Marksman"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["md", "mdx"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["markdown", "mdx"]
    }

    fn root_pattern(&self) -> RootPattern {
        GENERIC_PATTERN
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::RequirePath
    }

    fn binary_name(&self) -> &'static str {
        "marksman"
    }

    fn command_args(&self) -> &'static [&'static str] {
        &["server"]
    }

    fn install_hint(&self) -> String {
        "brew install marksman".to_string()
    }
}

// ============================================
// Shell/DevOps
// ============================================

pub struct ShellServer;

impl ServerDef for ShellServer {
    fn id(&self) -> &'static str {
        "shellscript"
    }

    fn display_name(&self) -> &'static str {
        "Bash Language Server"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["sh", "bash", "zsh"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["shellscript"]
    }

    fn root_pattern(&self) -> RootPattern {
        GENERIC_PATTERN
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::Npm {
            package: "bash-language-server",
        }
    }

    fn binary_name(&self) -> &'static str {
        "bash-language-server"
    }

    fn command_args(&self) -> &'static [&'static str] {
        &["start"]
    }
}

pub struct DockerfileServer;

impl ServerDef for DockerfileServer {
    fn id(&self) -> &'static str {
        "dockerfile"
    }

    fn display_name(&self) -> &'static str {
        "Dockerfile Language Server"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["dockerfile"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["dockerfile"]
    }

    fn root_pattern(&self) -> RootPattern {
        GENERIC_PATTERN
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::Npm {
            package: "dockerfile-language-server-nodejs",
        }
    }

    fn binary_name(&self) -> &'static str {
        "docker-langserver"
    }
}

pub struct SqlServer;

impl ServerDef for SqlServer {
    fn id(&self) -> &'static str {
        "sql"
    }

    fn display_name(&self) -> &'static str {
        "SQL Language Server"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["sql"]
    }

    fn language_ids(&self) -> &'static [&'static str] {
        &["sql"]
    }

    fn root_pattern(&self) -> RootPattern {
        GENERIC_PATTERN
    }

    fn install_method(&self) -> InstallMethod {
        InstallMethod::Npm {
            package: "sql-language-server",
        }
    }

    fn binary_name(&self) -> &'static str {
        "sql-language-server"
    }

    fn command_args(&self) -> &'static [&'static str] {
        &["up", "--method", "stdio"]
    }
}

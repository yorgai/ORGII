//! Web language server definitions: TypeScript, HTML, CSS, JSON, Vue, Svelte.

use std::path::Path;

use crate::install_pipeline::InstallMethod;
use crate::root_detection::{RootPattern, GENERIC_PATTERN, TYPESCRIPT_PATTERN};
use crate::server_defs::ServerDef;

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

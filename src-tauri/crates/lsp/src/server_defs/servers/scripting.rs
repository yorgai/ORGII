//! Scripting language server definitions: Python, Ruby, PHP, Lua, Elixir.

use std::path::Path;

use crate::install_pipeline::InstallMethod;
use crate::root_detection::{
    RootPattern, ELIXIR_PATTERN, PHP_PATTERN, PYTHON_PATTERN, RUBY_PATTERN,
};
use crate::server_defs::ServerDef;

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

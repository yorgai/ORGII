//! Miscellaneous server definitions: YAML, Markdown, Shell, Dockerfile, SQL.

use crate::install_pipeline::InstallMethod;
use crate::root_detection::{RootPattern, GENERIC_PATTERN};
use crate::server_defs::ServerDef;

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

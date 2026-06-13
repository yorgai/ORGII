//! JVM language server definitions: Java, Kotlin, Scala.

use crate::install_pipeline::InstallMethod;
use crate::root_detection::{RootPattern, JAVA_PATTERN};
use crate::server_defs::ServerDef;

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

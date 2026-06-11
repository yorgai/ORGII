//! Built-in LSP Server Definitions
//!
//! Implementations for all supported language servers, split by language family.

pub mod functional;
pub mod jvm;
pub mod misc;
pub mod native;
pub mod scripting;
pub mod systems;
pub mod web;

use crate::server_defs::ServerDef;

pub use functional::{ClojureServer, HaskellServer, OcamlServer};
pub use jvm::{JavaServer, KotlinServer, ScalaServer};
pub use misc::{DockerfileServer, MarkdownServer, ShellServer, SqlServer, YamlServer};
pub use native::{CSharpServer, SwiftServer};
pub use scripting::{ElixirServer, LuaServer, PhpServer, PythonServer, RubyServer};
pub use systems::{CppServer, GoServer, RustServer, ZigServer};
pub use web::{CssServer, HtmlServer, JsonServer, SvelteServer, TypeScriptServer, VueServer};

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

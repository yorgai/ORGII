//! Functional language server definitions: Haskell, OCaml, Clojure.

use crate::install_pipeline::InstallMethod;
use crate::root_detection::RootPattern;
use crate::server_defs::ServerDef;

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

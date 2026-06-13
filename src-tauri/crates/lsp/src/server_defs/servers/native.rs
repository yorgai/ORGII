//! Native/platform language server definitions: Swift, C#.

use crate::install_pipeline::InstallMethod;
use crate::root_detection::{RootPattern, CSHARP_PATTERN, SWIFT_PATTERN};
use crate::server_defs::ServerDef;

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

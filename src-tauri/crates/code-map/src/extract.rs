use std::path::Path;

use chrono::Utc;
use once_cell::sync::Lazy;
use regex::Regex;
use search::code::intelligence::TreeSitterFile;
use sha2::{Digest, Sha256};
use tree_sitter::Node;

use crate::paths::relative_path;
use crate::types::{
    CodeMapConfidence, CodeMapEdge, CodeMapEdgeKind, CodeMapExtractionMethod, CodeMapFileRecord,
    CodeMapLanguage, CodeMapNode, CodeMapNodeKind, CodeMapResolutionStatus, CodeMapUnresolvedRef,
    ExtractedFile,
};

static TS_FUNCTION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)").unwrap()
});
static TS_CLASS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)").unwrap()
});
static TS_INTERFACE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)").unwrap());
static TS_TYPE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)").unwrap());
static TS_CONST_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=").unwrap()
});
static PY_DEF_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*def\s+([A-Za-z_]\w*)").unwrap());
static PY_CLASS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*class\s+([A-Za-z_]\w*)").unwrap());
static GO_FUNC_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)").unwrap());
static GO_TYPE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)").unwrap());
static RUST_FN_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)").unwrap());
static RUST_TYPE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\s*(?:pub\s+)?(struct|enum|trait|mod)\s+([A-Za-z_]\w*)").unwrap());
static JVM_CLASS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\s*(?:public\s+|private\s+|protected\s+|internal\s+|final\s+|open\s+|abstract\s+|data\s+|sealed\s+)*(class|interface|enum)\s+([A-Za-z_]\w*)").unwrap()
});
static JVM_METHOD_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\s*(?:public\s+|private\s+|protected\s+|static\s+|final\s+|open\s+|override\s+|suspend\s+)*(?:fun\s+)?(?:[A-Za-z_][\w<>\[\],.?]*\s+)+([A-Za-z_]\w*)\s*\(").unwrap()
});
static C_FUNC_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\s*(?:[A-Za-z_][\w:*<>~&\s]+\s+)+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{?").unwrap()
});
static C_TYPE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\s*(?:typedef\s+)?(struct|enum|class|union)\s+([A-Za-z_]\w*)").unwrap()
});
static CSHARP_TYPE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\s*(?:public\s+|private\s+|protected\s+|internal\s+|static\s+|abstract\s+|sealed\s+)*(class|interface|struct|enum)\s+([A-Za-z_]\w*)").unwrap()
});
static PHP_FUNC_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\s*(?:public\s+|private\s+|protected\s+|static\s+)?function\s+([A-Za-z_]\w*)")
        .unwrap()
});
static PHP_CLASS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait)\s+([A-Za-z_]\w*)").unwrap()
});
static RUBY_DEF_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\s*def\s+([A-Za-z_]\w*[!?=]?)").unwrap());
static RUBY_CLASS_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\s*(class|module)\s+([A-Z]\w*)").unwrap());
static SWIFT_TYPE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\s*(?:public\s+|private\s+|internal\s+|open\s+)?(class|struct|enum|protocol)\s+([A-Za-z_]\w*)").unwrap()
});
static SWIFT_FUNC_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\s*(?:public\s+|private\s+|internal\s+|open\s+)?func\s+([A-Za-z_]\w*)").unwrap()
});
static IMPORT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"^\s*(?:import\s+|from\s+|use\s+|#include\s+|require\s+|include\s+)([\"'<]?[A-Za-z0-9_./:@+-]+)"#).unwrap()
});
static CALL_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b([A-Za-z_$][\w$]*)\s*\(").unwrap());

#[derive(Debug, Clone)]
struct SymbolMatch {
    kind: CodeMapNodeKind,
    name: String,
    start_line: u32,
    end_line: u32,
    start_column: u32,
    end_column: u32,
    signature: Option<String>,
    confidence: CodeMapConfidence,
    extraction_method: CodeMapExtractionMethod,
}

pub fn extract_file(workspace_root: &Path, path: &Path) -> Option<ExtractedFile> {
    let language = CodeMapLanguage::from_path(path)?;
    let content = std::fs::read_to_string(path).ok()?;
    let metadata = std::fs::metadata(path).ok()?;
    let relative = relative_path(workspace_root, path);
    let timestamp = Utc::now().timestamp();
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let mut unresolved_refs = Vec::new();
    let file_id = node_id(&relative, "file", "file", 1);
    let file_node = CodeMapNode {
        id: file_id.clone(),
        kind: CodeMapNodeKind::File,
        name: relative.clone(),
        qualified_name: relative.clone(),
        file_path: relative.clone(),
        language,
        start_line: 1,
        end_line: content.lines().count().max(1) as u32,
        start_column: 1,
        end_column: 1,
        signature: None,
        updated_at: timestamp,
        confidence: CodeMapConfidence::Exact,
        extraction_method: CodeMapExtractionMethod::FileSystem,
        parent_id: None,
    };
    nodes.push(file_node);

    let symbols = extract_symbols_ast(language, path, &content)
        .unwrap_or_else(|| extract_symbols_regex(language, &content));

    for symbol in symbols {
        let id = node_id(
            &relative,
            symbol.kind.as_str(),
            &symbol.name,
            symbol.start_line,
        );
        let node = CodeMapNode {
            id: id.clone(),
            kind: symbol.kind,
            name: symbol.name.clone(),
            qualified_name: format!("{}::{}", relative, symbol.name),
            file_path: relative.clone(),
            language,
            start_line: symbol.start_line,
            end_line: symbol.end_line,
            start_column: symbol.start_column,
            end_column: symbol.end_column,
            signature: symbol.signature,
            updated_at: timestamp,
            confidence: symbol.confidence,
            extraction_method: symbol.extraction_method,
            parent_id: Some(file_id.clone()),
        };
        edges.push(CodeMapEdge {
            source: file_id.clone(),
            target: id.clone(),
            kind: CodeMapEdgeKind::Contains,
            line: Some(symbol.start_line),
            column: Some(symbol.start_column),
            provenance: Some("file_symbol".to_string()),
            confidence: CodeMapConfidence::Exact,
            resolution_status: CodeMapResolutionStatus::Resolved,
        });
        nodes.push(node);
    }

    for (line_index, line) in content.lines().enumerate() {
        let line_number = (line_index + 1) as u32;
        if let Some(captures) = IMPORT_RE.captures(line) {
            let name = captures
                .get(1)
                .map(|matched| matched.as_str().trim_matches(['\'', '"', '<', '>']))
                .unwrap_or("import")
                .to_string();
            let id = node_id(&relative, "import", &name, line_number);
            nodes.push(CodeMapNode {
                id: id.clone(),
                kind: CodeMapNodeKind::Import,
                name: name.clone(),
                qualified_name: format!("{}::import::{}", relative, name),
                file_path: relative.clone(),
                language,
                start_line: line_number,
                end_line: line_number,
                start_column: 1,
                end_column: line.len() as u32 + 1,
                signature: Some(line.trim().to_string()),
                updated_at: timestamp,
                confidence: CodeMapConfidence::Medium,
                extraction_method: CodeMapExtractionMethod::Regex,
                parent_id: Some(file_id.clone()),
            });
            edges.push(CodeMapEdge {
                source: file_id.clone(),
                target: id.clone(),
                kind: CodeMapEdgeKind::Imports,
                line: Some(line_number),
                column: Some(1),
                provenance: Some("import_or_include".to_string()),
                confidence: CodeMapConfidence::Medium,
                resolution_status: CodeMapResolutionStatus::Unresolved,
            });
            unresolved_refs.push(CodeMapUnresolvedRef {
                file_path: relative.clone(),
                from_node_id: Some(file_id.clone()),
                name,
                kind: CodeMapEdgeKind::Imports,
                language,
                line: line_number,
                column: 1,
                candidates: Vec::new(),
                reason: Some("import target not resolved yet".to_string()),
            });
        }

        for captures in CALL_RE.captures_iter(line) {
            let Some(matched) = captures.get(1) else {
                continue;
            };
            let name = matched.as_str();
            if is_keyword_like_call(name) {
                continue;
            }
            unresolved_refs.push(CodeMapUnresolvedRef {
                file_path: relative.clone(),
                from_node_id: Some(file_id.clone()),
                name: name.to_string(),
                kind: CodeMapEdgeKind::Calls,
                language,
                line: line_number,
                column: matched.start() as u32 + 1,
                candidates: Vec::new(),
                reason: Some("call target not resolved yet".to_string()),
            });
        }
    }

    let record = CodeMapFileRecord {
        path: relative,
        content_hash: hash_content(content.as_bytes()),
        language,
        size: metadata.len(),
        modified_at: metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|value| value.as_secs() as i64)
            .unwrap_or(timestamp),
        indexed_at: timestamp,
        node_count: nodes.len() as u32,
        errors: Vec::new(),
        stale: false,
    };
    Some(ExtractedFile {
        record,
        nodes,
        edges,
        unresolved_refs,
    })
}

fn extract_symbols_ast(
    language: CodeMapLanguage,
    path: &Path,
    content: &str,
) -> Option<Vec<SymbolMatch>> {
    if !matches!(
        language,
        CodeMapLanguage::Rust
            | CodeMapLanguage::TypeScript
            | CodeMapLanguage::Tsx
            | CodeMapLanguage::JavaScript
            | CodeMapLanguage::Jsx
            | CodeMapLanguage::Python
    ) {
        return None;
    }
    let extension = path.extension()?.to_string_lossy();
    let file = TreeSitterFile::try_build_from_extension(content.as_bytes(), &extension).ok()?;
    let root = file.tree().root_node();
    let mut symbols = Vec::new();
    collect_ast_symbols(language, root, content.as_bytes(), &mut symbols);
    if symbols.is_empty() {
        None
    } else {
        Some(symbols)
    }
}

fn collect_ast_symbols(
    language: CodeMapLanguage,
    node: Node<'_>,
    source: &[u8],
    symbols: &mut Vec<SymbolMatch>,
) {
    if let Some(symbol) = symbol_from_ast_node(language, node, source) {
        symbols.push(symbol);
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_ast_symbols(language, child, source, symbols);
    }
}

fn symbol_from_ast_node(
    language: CodeMapLanguage,
    node: Node<'_>,
    source: &[u8],
) -> Option<SymbolMatch> {
    let node_kind = node.kind();
    let (kind, name_node) = match language {
        CodeMapLanguage::Rust => match node_kind {
            "function_item" => (CodeMapNodeKind::Function, node.child_by_field_name("name")?),
            "struct_item" => (CodeMapNodeKind::Struct, node.child_by_field_name("name")?),
            "enum_item" => (CodeMapNodeKind::Enum, node.child_by_field_name("name")?),
            "trait_item" => (CodeMapNodeKind::Trait, node.child_by_field_name("name")?),
            "mod_item" => (CodeMapNodeKind::Module, node.child_by_field_name("name")?),
            "impl_item" => return None,
            _ => return None,
        },
        CodeMapLanguage::TypeScript
        | CodeMapLanguage::Tsx
        | CodeMapLanguage::JavaScript
        | CodeMapLanguage::Jsx => match node_kind {
            "function_declaration" => {
                (CodeMapNodeKind::Function, node.child_by_field_name("name")?)
            }
            "class_declaration" => (CodeMapNodeKind::Class, node.child_by_field_name("name")?),
            "interface_declaration" => (
                CodeMapNodeKind::Interface,
                node.child_by_field_name("name")?,
            ),
            "type_alias_declaration" => (
                CodeMapNodeKind::TypeAlias,
                node.child_by_field_name("name")?,
            ),
            "method_definition" => (CodeMapNodeKind::Method, node.child_by_field_name("name")?),
            "lexical_declaration" | "variable_declaration" => {
                let declarator = find_child_kind(node, "variable_declarator")?;
                (
                    CodeMapNodeKind::Constant,
                    declarator.child_by_field_name("name")?,
                )
            }
            _ => return None,
        },
        CodeMapLanguage::Python => match node_kind {
            "function_definition" => (CodeMapNodeKind::Function, node.child_by_field_name("name")?),
            "class_definition" => (CodeMapNodeKind::Class, node.child_by_field_name("name")?),
            _ => return None,
        },
        _ => return None,
    };
    let name = name_node.utf8_text(source).ok()?.to_string();
    Some(SymbolMatch {
        kind,
        name: name.clone(),
        start_line: node.start_position().row as u32 + 1,
        end_line: node.end_position().row as u32 + 1,
        start_column: name_node.start_position().column as u32 + 1,
        end_column: name_node.end_position().column as u32 + 1,
        signature: first_line_text(node, source),
        confidence: CodeMapConfidence::High,
        extraction_method: CodeMapExtractionMethod::TreeSitter,
    })
}

fn find_child_kind<'tree>(node: Node<'tree>, kind: &str) -> Option<Node<'tree>> {
    let mut cursor = node.walk();
    let child = node
        .children(&mut cursor)
        .find(|child| child.kind() == kind);
    child
}

fn first_line_text(node: Node<'_>, source: &[u8]) -> Option<String> {
    let text = node.utf8_text(source).ok()?;
    text.lines().next().map(|line| line.trim().to_string())
}

fn extract_symbols_regex(language: CodeMapLanguage, content: &str) -> Vec<SymbolMatch> {
    let mut symbols = Vec::new();
    for (line_index, line) in content.lines().enumerate() {
        let line_number = (line_index + 1) as u32;
        if let Some((kind, name)) = detect_symbol(language, line) {
            symbols.push(SymbolMatch {
                kind,
                name: name.clone(),
                start_line: line_number,
                end_line: line_number,
                start_column: line.find(&name).map(|index| index as u32 + 1).unwrap_or(1),
                end_column: line
                    .find(&name)
                    .map(|index| index as u32 + name.len() as u32 + 1)
                    .unwrap_or(1),
                signature: Some(line.trim().to_string()),
                confidence: CodeMapConfidence::Heuristic,
                extraction_method: CodeMapExtractionMethod::Regex,
            });
        }
    }
    symbols
}

fn detect_symbol(language: CodeMapLanguage, line: &str) -> Option<(CodeMapNodeKind, String)> {
    match language {
        CodeMapLanguage::TypeScript
        | CodeMapLanguage::Tsx
        | CodeMapLanguage::JavaScript
        | CodeMapLanguage::Jsx => first_capture(&TS_FUNCTION_RE, line)
            .map(|name| (CodeMapNodeKind::Function, name))
            .or_else(|| {
                first_capture(&TS_CLASS_RE, line).map(|name| (CodeMapNodeKind::Class, name))
            })
            .or_else(|| {
                first_capture(&TS_INTERFACE_RE, line).map(|name| (CodeMapNodeKind::Interface, name))
            })
            .or_else(|| {
                first_capture(&TS_TYPE_RE, line).map(|name| (CodeMapNodeKind::TypeAlias, name))
            })
            .or_else(|| {
                first_capture(&TS_CONST_RE, line).map(|name| (CodeMapNodeKind::Constant, name))
            }),
        CodeMapLanguage::Python => first_capture(&PY_DEF_RE, line)
            .map(|name| (CodeMapNodeKind::Function, name))
            .or_else(|| {
                first_capture(&PY_CLASS_RE, line).map(|name| (CodeMapNodeKind::Class, name))
            }),
        CodeMapLanguage::Go => first_capture(&GO_FUNC_RE, line)
            .map(|name| (CodeMapNodeKind::Function, name))
            .or_else(|| {
                first_capture(&GO_TYPE_RE, line).map(|name| (CodeMapNodeKind::Struct, name))
            }),
        CodeMapLanguage::Rust => first_capture(&RUST_FN_RE, line)
            .map(|name| (CodeMapNodeKind::Function, name))
            .or_else(|| {
                RUST_TYPE_RE.captures(line).and_then(|captures| {
                    let keyword = captures.get(1)?.as_str();
                    let name = captures.get(2)?.as_str().to_string();
                    let kind = match keyword {
                        "struct" => CodeMapNodeKind::Struct,
                        "enum" => CodeMapNodeKind::Enum,
                        "trait" => CodeMapNodeKind::Trait,
                        "mod" => CodeMapNodeKind::Module,
                        _ => CodeMapNodeKind::TypeAlias,
                    };
                    Some((kind, name))
                })
            }),
        CodeMapLanguage::Java | CodeMapLanguage::Kotlin => JVM_CLASS_RE
            .captures(line)
            .and_then(|captures| {
                let keyword = captures.get(1)?.as_str();
                let name = captures.get(2)?.as_str().to_string();
                let kind = if keyword == "interface" {
                    CodeMapNodeKind::Interface
                } else if keyword == "enum" {
                    CodeMapNodeKind::Enum
                } else {
                    CodeMapNodeKind::Class
                };
                Some((kind, name))
            })
            .or_else(|| {
                first_capture(&JVM_METHOD_RE, line).map(|name| (CodeMapNodeKind::Method, name))
            }),
        CodeMapLanguage::C | CodeMapLanguage::Cpp => C_TYPE_RE
            .captures(line)
            .and_then(|captures| {
                let keyword = captures.get(1)?.as_str();
                let name = captures.get(2)?.as_str().to_string();
                let kind = if keyword == "enum" {
                    CodeMapNodeKind::Enum
                } else {
                    CodeMapNodeKind::Struct
                };
                Some((kind, name))
            })
            .or_else(|| {
                first_capture(&C_FUNC_RE, line).map(|name| (CodeMapNodeKind::Function, name))
            }),
        CodeMapLanguage::CSharp => CSHARP_TYPE_RE
            .captures(line)
            .and_then(|captures| {
                let keyword = captures.get(1)?.as_str();
                let name = captures.get(2)?.as_str().to_string();
                let kind = match keyword {
                    "interface" => CodeMapNodeKind::Interface,
                    "struct" => CodeMapNodeKind::Struct,
                    "enum" => CodeMapNodeKind::Enum,
                    _ => CodeMapNodeKind::Class,
                };
                Some((kind, name))
            })
            .or_else(|| {
                first_capture(&JVM_METHOD_RE, line).map(|name| (CodeMapNodeKind::Method, name))
            }),
        CodeMapLanguage::Php => first_capture(&PHP_CLASS_RE, line)
            .map(|name| (CodeMapNodeKind::Class, name))
            .or_else(|| {
                first_capture(&PHP_FUNC_RE, line).map(|name| (CodeMapNodeKind::Function, name))
            }),
        CodeMapLanguage::Ruby => RUBY_CLASS_RE
            .captures(line)
            .and_then(|captures| {
                let keyword = captures.get(1)?.as_str();
                let name = captures.get(2)?.as_str().to_string();
                let kind = if keyword == "module" {
                    CodeMapNodeKind::Module
                } else {
                    CodeMapNodeKind::Class
                };
                Some((kind, name))
            })
            .or_else(|| {
                first_capture(&RUBY_DEF_RE, line).map(|name| (CodeMapNodeKind::Method, name))
            }),
        CodeMapLanguage::Swift => SWIFT_TYPE_RE
            .captures(line)
            .and_then(|captures| {
                let keyword = captures.get(1)?.as_str();
                let name = captures.get(2)?.as_str().to_string();
                let kind = match keyword {
                    "struct" => CodeMapNodeKind::Struct,
                    "enum" => CodeMapNodeKind::Enum,
                    "protocol" => CodeMapNodeKind::Trait,
                    _ => CodeMapNodeKind::Class,
                };
                Some((kind, name))
            })
            .or_else(|| {
                first_capture(&SWIFT_FUNC_RE, line).map(|name| (CodeMapNodeKind::Function, name))
            }),
    }
}

fn first_capture(regex: &Regex, line: &str) -> Option<String> {
    regex
        .captures(line)
        .and_then(|captures| captures.get(1).map(|matched| matched.as_str().to_string()))
}

fn is_keyword_like_call(value: &str) -> bool {
    matches!(
        value,
        "if" | "for" | "while" | "switch" | "catch" | "return" | "function" | "class" | "struct"
    )
}

fn node_id(file_path: &str, kind: &str, name: &str, line: u32) -> String {
    let mut hasher = Sha256::new();
    hasher.update(file_path.as_bytes());
    hasher.update(kind.as_bytes());
    hasher.update(name.as_bytes());
    hasher.update(line.to_string().as_bytes());
    hex::encode(hasher.finalize())
}

fn hash_content(content: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content);
    hex::encode(hasher.finalize())
}

pub fn content_hash(content: &[u8]) -> String {
    hash_content(content)
}

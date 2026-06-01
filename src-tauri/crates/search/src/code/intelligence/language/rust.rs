//! Rust language configuration

use super::{MemoizedQuery, TSLanguageConfig};

pub static RUST: TSLanguageConfig = TSLanguageConfig {
    language_ids: &["Rust"],
    file_extensions: &["rs"],
    grammar: || tree_sitter_rust::LANGUAGE.into(),
    scope_query: MemoizedQuery::new(RUST_SCOPES),
    hoverable_query: MemoizedQuery::new(
        r#"
        [(identifier)
         (shorthand_field_identifier)
         (field_identifier)
         (type_identifier)] @hoverable
        "#,
    ),
    namespaces: &[&[
        // variables
        "const",
        "function",
        "variable",
        // types
        "struct",
        "enum",
        "union",
        "typedef",
        "interface",
        // fields
        "field",
        "enumerator",
        // namespacing
        "module",
        // misc
        "label",
        "lifetime",
    ]],
};

const RUST_SCOPES: &str = r#"
;; Scopes

[
 (function_item)
 (closure_expression)
 (block)
 (if_expression)
 (match_arm)
 (match_expression)
 (for_expression)
 (while_expression)
 (loop_expression)
 (impl_item)
 (struct_item)
 (enum_item)
] @local.scope

;; Definitions

(function_item name: (identifier) @local.definition.function)
(struct_item name: (type_identifier) @local.definition.struct)
(enum_item name: (type_identifier) @local.definition.enum)
(union_item name: (type_identifier) @local.definition.union)
(type_item name: (type_identifier) @local.definition.typedef)
(trait_item name: (type_identifier) @local.definition.interface)
(mod_item name: (identifier) @local.definition.module)

(const_item name: (identifier) @local.definition.const)
(static_item name: (identifier) @local.definition.const)

(let_declaration pattern: (identifier) @local.definition.variable)
(let_declaration pattern: (tuple_pattern (identifier) @local.definition.variable))
(parameter pattern: (identifier) @local.definition.variable)
(closure_parameters (identifier) @local.definition.variable)
(self_parameter (self) @local.definition.variable)

(field_declaration name: (field_identifier) @local.definition.field)
(enum_variant name: (identifier) @local.definition.enumerator)

(label (identifier) @local.definition.label)
(lifetime (identifier) @local.definition.lifetime)
(type_parameters (lifetime (identifier) @local.definition.lifetime))

;; Imports

(use_declaration argument: (scoped_identifier name: (identifier) @local.import))
(use_declaration argument: (identifier) @local.import)
(use_as_clause alias: (identifier) @local.import)
(use_list (identifier) @local.import)

;; References

(identifier) @local.reference
(type_identifier) @local.reference
(field_identifier) @local.reference
(shorthand_field_identifier) @local.reference
(lifetime (identifier) @local.reference)
"#;

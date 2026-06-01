//! Scope Resolution Module
//!
//! Builds scope graphs for code navigation.

mod def;
mod import;
mod reference;
mod scope;

pub use def::LocalDef;
pub use import::LocalImport;
pub use reference::Reference;
pub use scope::{LocalScope, ScopeStack};

use super::super::symbol::Symbol;
use super::{NameSpaceMethods, TSLanguageConfig, ALL_LANGUAGES};
use crate::code::text_range::TextRange;

use std::{collections::HashMap, str::FromStr};

use petgraph::{graph::Graph, visit::EdgeRef, Direction};
use serde::{Deserialize, Serialize};
use streaming_iterator::StreamingIterator;
use tracing::warn;
use tree_sitter::{Node, Query, QueryCursor};

pub type NodeIndex = petgraph::graph::NodeIndex<u32>;

/// The algorithm used to resolve scopes.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
#[non_exhaustive]
pub enum ResolutionMethod {
    /// `Generic` refers to a basic lexical scoping algorithm.
    Generic,
}

impl ResolutionMethod {
    /// Build a lexical scope-graph with a scope query and a tree-sitter tree.
    pub fn build_scope(
        &self,
        query: &Query,
        root_node: Node<'_>,
        src: &[u8],
        language: &TSLanguageConfig,
    ) -> ScopeGraph {
        match self {
            ResolutionMethod::Generic => scope_res_generic(query, root_node, src, language),
        }
    }
}

/// The type of a node in the ScopeGraph
#[derive(Serialize, Deserialize, Debug, Clone)]
pub enum NodeKind {
    /// A scope node
    Scope(LocalScope),

    /// A definition node
    Def(LocalDef),

    /// An import node
    Import(LocalImport),

    /// A reference node
    Ref(Reference),
}

impl NodeKind {
    /// Construct a scope node from a range
    pub fn scope(range: TextRange) -> Self {
        Self::Scope(LocalScope::new(range))
    }

    /// Produce the range spanned by this node
    pub fn range(&self) -> TextRange {
        match self {
            Self::Scope(l) => l.range,
            Self::Def(d) => d.range,
            Self::Ref(r) => r.range,
            Self::Import(i) => i.range,
        }
    }
}

/// Describes the relation between two nodes in the ScopeGraph
#[derive(Serialize, Deserialize, PartialEq, Eq, Copy, Clone, Debug)]
pub enum EdgeKind {
    /// The edge weight from a nested scope to its parent scope
    ScopeToScope,

    /// The edge weight from a definition to its definition scope
    DefToScope,

    /// The edge weight from an import to its definition scope
    ImportToScope,

    /// The edge weight from a reference to its definition
    RefToDef,

    /// The edge weight from a reference to its import
    RefToImport,
}

/// A graph representation of scopes and names in a single syntax tree
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScopeGraph {
    /// The raw graph
    pub graph: Graph<NodeKind, EdgeKind>,

    // The root scope index
    root_idx: NodeIndex,

    /// An index into ALL_LANGUAGES which corresponds to the language for this graph
    lang_id: usize,
}

impl ScopeGraph {
    pub fn new(range: TextRange, lang_id: usize) -> Self {
        let mut graph = Graph::new();
        let root_idx = graph.add_node(NodeKind::scope(range));
        Self {
            graph,
            root_idx,
            lang_id,
        }
    }

    pub fn get_node(&self, node_idx: NodeIndex) -> Option<&NodeKind> {
        self.graph.node_weight(node_idx)
    }

    /// Insert a local scope into the scope-graph
    pub fn insert_local_scope(&mut self, new: LocalScope) {
        if let Some(parent_scope) = self.scope_by_range(new.range, self.root_idx) {
            let new_scope = NodeKind::Scope(new);
            let new_idx = self.graph.add_node(new_scope);
            self.graph
                .add_edge(new_idx, parent_scope, EdgeKind::ScopeToScope);
        }
    }

    /// Insert a def into the scope-graph
    pub fn insert_local_def(&mut self, new: LocalDef) {
        if let Some(defining_scope) = self.scope_by_range(new.range, self.root_idx) {
            let new_def = NodeKind::Def(new);
            let new_idx = self.graph.add_node(new_def);
            self.graph
                .add_edge(new_idx, defining_scope, EdgeKind::DefToScope);
        }
    }

    /// Insert a def into the scope-graph, at the parent scope of the defining scope
    pub fn insert_hoisted_def(&mut self, new: LocalDef) {
        if let Some(defining_scope) = self.scope_by_range(new.range, self.root_idx) {
            let new_def = NodeKind::Def(new);
            let new_idx = self.graph.add_node(new_def);

            let target_scope = self.parent_scope(defining_scope).unwrap_or(defining_scope);

            self.graph
                .add_edge(new_idx, target_scope, EdgeKind::DefToScope);
        }
    }

    /// Insert a def into the scope-graph, at the root scope
    pub fn insert_global_def(&mut self, new: LocalDef) {
        let new_def = NodeKind::Def(new);
        let new_idx = self.graph.add_node(new_def);
        self.graph
            .add_edge(new_idx, self.root_idx, EdgeKind::DefToScope);
    }

    /// Insert an import into the scope-graph
    pub fn insert_local_import(&mut self, new: LocalImport) {
        if let Some(defining_scope) = self.scope_by_range(new.range, self.root_idx) {
            let new_imp = NodeKind::Import(new);
            let new_idx = self.graph.add_node(new_imp);
            self.graph
                .add_edge(new_idx, defining_scope, EdgeKind::ImportToScope);
        }
    }

    /// Insert a ref into the scope-graph
    pub fn insert_ref(&mut self, new: Reference, src: &[u8]) {
        let mut possible_defs = vec![];
        let mut possible_imports = vec![];
        if let Some(local_scope_idx) = self.scope_by_range(new.range, self.root_idx) {
            for scope in self.scope_stack(local_scope_idx) {
                for local_def in self
                    .graph
                    .edges_directed(scope, Direction::Incoming)
                    .filter(|edge| *edge.weight() == EdgeKind::DefToScope)
                    .map(|edge| edge.source())
                {
                    if let NodeKind::Def(def) = &self.graph[local_def] {
                        if new.name(src) == def.name(src) {
                            match (&def.symbol_id, &new.symbol_id) {
                                (Some(d), Some(r)) if d.namespace_idx != r.namespace_idx => {}
                                _ => {
                                    possible_defs.push(local_def);
                                }
                            };
                        }
                    }
                }

                for local_import in self
                    .graph
                    .edges_directed(scope, Direction::Incoming)
                    .filter(|edge| *edge.weight() == EdgeKind::ImportToScope)
                    .map(|edge| edge.source())
                {
                    if let NodeKind::Import(import) = &self.graph[local_import] {
                        if new.name(src) == import.name(src) {
                            possible_imports.push(local_import);
                        }
                    }
                }
            }
        }

        if !possible_defs.is_empty() || !possible_imports.is_empty() {
            let new_ref = NodeKind::Ref(new);
            let ref_idx = self.graph.add_node(new_ref);
            for def_idx in possible_defs {
                self.graph.add_edge(ref_idx, def_idx, EdgeKind::RefToDef);
            }
            for imp_idx in possible_imports {
                self.graph.add_edge(ref_idx, imp_idx, EdgeKind::RefToImport);
            }
        }
    }

    fn scope_stack(&self, start: NodeIndex) -> ScopeStack<'_> {
        ScopeStack {
            scope_graph: self,
            start: Some(start),
        }
    }

    fn scope_by_range(&self, range: TextRange, start: NodeIndex) -> Option<NodeIndex> {
        let target_range = self.graph[start].range();
        if target_range.contains(&range) {
            let child_scopes = self
                .graph
                .edges_directed(start, Direction::Incoming)
                .filter(|edge| *edge.weight() == EdgeKind::ScopeToScope)
                .map(|edge| edge.source())
                .collect::<Vec<_>>();
            for child_scope in child_scopes {
                if let Some(t) = self.scope_by_range(range, child_scope) {
                    return Some(t);
                }
            }
            return Some(start);
        }
        None
    }

    fn parent_scope(&self, start: NodeIndex) -> Option<NodeIndex> {
        if matches!(self.graph[start], NodeKind::Scope(_)) {
            return self
                .graph
                .edges_directed(start, Direction::Outgoing)
                .filter(|edge| *edge.weight() == EdgeKind::ScopeToScope)
                .map(|edge| edge.target())
                .next();
        }
        None
    }

    /// Produce a list of interesting ranges: ranges of defs and refs
    pub fn hoverable_ranges(&self) -> Box<dyn Iterator<Item = TextRange> + '_> {
        let iterator =
            self.graph
                .node_indices()
                .filter_map(|node_idx| match &self.graph[node_idx] {
                    NodeKind::Scope(_) => None,
                    NodeKind::Def(d) => Some(d.range),
                    NodeKind::Ref(r) => Some(r.range),
                    NodeKind::Import(i) => Some(i.range),
                });
        Box::new(iterator)
    }

    /// Produce possible definitions for a reference
    pub fn definitions(
        &self,
        reference_node: NodeIndex,
    ) -> Box<dyn Iterator<Item = NodeIndex> + '_> {
        let iterator = self
            .graph
            .edges_directed(reference_node, Direction::Outgoing)
            .filter(|edge| *edge.weight() == EdgeKind::RefToDef)
            .map(|edge| edge.target());
        Box::new(iterator)
    }

    /// Produce possible imports for a reference
    pub fn imports(&self, reference_node: NodeIndex) -> Box<dyn Iterator<Item = NodeIndex> + '_> {
        let iterator = self
            .graph
            .edges_directed(reference_node, Direction::Outgoing)
            .filter(|edge| *edge.weight() == EdgeKind::RefToImport)
            .map(|edge| edge.target());
        Box::new(iterator)
    }

    /// Produce possible references for a definition/import node
    pub fn references(
        &self,
        definition_node: NodeIndex,
    ) -> Box<dyn Iterator<Item = NodeIndex> + '_> {
        let iterator = self
            .graph
            .edges_directed(definition_node, Direction::Incoming)
            .filter(|edge| {
                *edge.weight() == EdgeKind::RefToDef || *edge.weight() == EdgeKind::RefToImport
            })
            .map(|edge| edge.source());
        Box::new(iterator)
    }

    pub fn node_by_range(&self, start_byte: usize, end_byte: usize) -> Option<NodeIndex> {
        self.graph
            .node_indices()
            .filter(|&idx| self.is_definition(idx) || self.is_reference(idx) || self.is_import(idx))
            .find(|&idx| {
                let node = self.graph[idx].range();
                start_byte >= node.start.byte && end_byte <= node.end.byte
            })
    }

    pub fn node_by_position(&self, line: usize, column: usize) -> Option<NodeIndex> {
        self.graph
            .node_indices()
            .filter(|&idx| self.is_definition(idx) || self.is_reference(idx))
            .find(|&idx| {
                let node = self.graph[idx].range();
                node.start.line == line
                    && node.end.line == line
                    && node.start.column <= column
                    && node.end.column >= column
            })
    }

    pub fn symbols(&self) -> Vec<Symbol> {
        let namespaces = ALL_LANGUAGES[self.lang_id].namespaces;
        self.graph
            .node_weights()
            .filter_map(|weight| match weight {
                NodeKind::Def(LocalDef {
                    range,
                    symbol_id: Some(symbol_id),
                    ..
                }) => Some(Symbol {
                    kind: symbol_id.name(namespaces).to_owned(),
                    range: *range,
                }),
                _ => None,
            })
            .collect()
    }

    pub fn symbol_name_of(&self, idx: NodeIndex) -> Option<&'static str> {
        let namespaces = ALL_LANGUAGES[self.lang_id].namespaces;
        match &self.graph[idx] {
            NodeKind::Def(d) => d.symbol_id.map(|s| s.name(namespaces)),
            NodeKind::Ref(r) => r.symbol_id.map(|s| s.name(namespaces)),
            _ => None,
        }
    }

    pub fn is_top_level(&self, idx: NodeIndex) -> bool {
        self.graph.contains_edge(idx, self.root_idx)
    }

    pub fn is_definition(&self, node_idx: NodeIndex) -> bool {
        matches!(self.graph[node_idx], NodeKind::Def(_))
    }

    pub fn is_reference(&self, node_idx: NodeIndex) -> bool {
        matches!(self.graph[node_idx], NodeKind::Ref(_))
    }

    pub fn is_scope(&self, node_idx: NodeIndex) -> bool {
        matches!(self.graph[node_idx], NodeKind::Scope(_))
    }

    pub fn is_import(&self, node_idx: NodeIndex) -> bool {
        matches!(self.graph[node_idx], NodeKind::Import(_))
    }
}

fn scope_res_generic(
    query: &Query,
    root_node: Node<'_>,
    src: &[u8],
    language: &TSLanguageConfig,
) -> ScopeGraph {
    let namespaces = language.namespaces;

    enum Scoping {
        Global,
        Hoisted,
        Local,
    }

    struct LocalDefCapture<'a> {
        index: u32,
        symbol: Option<&'a str>,
        scoping: Scoping,
    }

    struct LocalRefCapture<'a> {
        index: u32,
        symbol: Option<&'a str>,
    }

    impl FromStr for Scoping {
        type Err = String;
        fn from_str(s: &str) -> Result<Self, Self::Err> {
            match s {
                "hoist" => Ok(Self::Hoisted),
                "global" => Ok(Self::Global),
                "local" => Ok(Self::Local),
                s => Err(s.to_owned()),
            }
        }
    }

    let mut local_def_captures = Vec::<LocalDefCapture<'_>>::new();
    let mut local_import_capture_index = None;
    let mut local_ref_captures = Vec::<LocalRefCapture<'_>>::new();
    let mut local_scope_capture_index = None;

    for (i, name) in query.capture_names().iter().enumerate() {
        let i = i as u32;
        let parts: Vec<_> = name.split('.').collect();

        match parts.as_slice() {
            [scoping, "definition", sym] => {
                let index = i;
                let symbol = Some(*sym);
                let scoping = Scoping::from_str(scoping).expect("invalid scope keyword");

                let l = LocalDefCapture {
                    index,
                    symbol,
                    scoping,
                };
                local_def_captures.push(l)
            }
            [scoping, "definition"] => {
                let index = i;
                let symbol = None;
                let scoping = Scoping::from_str(scoping).expect("invalid scope keyword");

                let l = LocalDefCapture {
                    index,
                    symbol,
                    scoping,
                };
                local_def_captures.push(l)
            }
            ["local", "reference", sym] => {
                let index = i;
                let symbol = Some(*sym);

                let l = LocalRefCapture { index, symbol };
                local_ref_captures.push(l);
            }
            ["local", "reference"] => {
                let index = i;
                let symbol = None;

                let l = LocalRefCapture { index, symbol };
                local_ref_captures.push(l);
            }
            ["local", "scope"] => local_scope_capture_index = Some(i),
            ["local", "import"] => local_import_capture_index = Some(i),
            _ if !name.starts_with('_') => warn!(?name, "unrecognized query capture"),
            _ => (),
        }
    }

    let mut cursor = QueryCursor::new();
    let mut captures = cursor.captures(query, root_node, src);

    let lang_id = ALL_LANGUAGES
        .iter()
        .position(|l| l.language_ids == language.language_ids)
        .unwrap_or(0);
    let mut scope_graph = ScopeGraph::new(root_node.range().into(), lang_id);

    // Build capture map using StreamingIterator
    let mut capture_map = HashMap::<_, Vec<_>>::new();
    while let Some((match_, capture_idx)) = captures.next() {
        let capture = match_.captures[*capture_idx];
        let range: TextRange = capture.node.range().into();
        capture_map.entry(capture.index).or_default().push(range);
    }

    // Insert scopes first
    if let Some(ranges) = local_scope_capture_index.and_then(|idx| capture_map.get(&idx)) {
        for range in ranges {
            let scope = LocalScope::new(*range);
            scope_graph.insert_local_scope(scope);
        }
    }

    // Followed by imports
    if let Some(ranges) = local_import_capture_index.and_then(|idx| capture_map.get(&idx)) {
        for range in ranges {
            let import = LocalImport::new(*range);
            scope_graph.insert_local_import(import);
        }
    }

    // Followed by defs
    for LocalDefCapture {
        index,
        symbol,
        scoping,
    } in local_def_captures
    {
        if let Some(ranges) = capture_map.get(&index) {
            for range in ranges {
                let symbol_id = symbol.and_then(|s| namespaces.symbol_id_of(s));
                let local_def = LocalDef::new(*range, symbol_id);

                match scoping {
                    Scoping::Hoisted => scope_graph.insert_hoisted_def(local_def),
                    Scoping::Global => scope_graph.insert_global_def(local_def),
                    Scoping::Local => scope_graph.insert_local_def(local_def),
                };
            }
        }
    }

    // And then refs
    for LocalRefCapture { index, symbol } in local_ref_captures {
        if let Some(ranges) = capture_map.get(&index) {
            for range in ranges {
                let symbol_id = symbol.and_then(|s| namespaces.symbol_id_of(s));
                let ref_ = Reference::new(*range, symbol_id);

                scope_graph.insert_ref(ref_, src);
            }
        }
    }

    scope_graph
}

#[cfg(test)]
#[path = "tests/scope_resolution_tests.rs"]
mod tests;

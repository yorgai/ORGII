use crate::code::intelligence::scope_resolution::{
    LocalDef, LocalImport, LocalScope, Reference, ScopeGraph,
};
use crate::code::text_range::{Point, TextRange};

fn range(start_byte: usize, end_byte: usize) -> TextRange {
    TextRange::new(
        Point::new(start_byte, 0, start_byte),
        Point::new(end_byte, 0, end_byte),
    )
}

#[test]
fn new_scope_graph_has_root() {
    let sg = ScopeGraph::new(range(0, 100), 0);
    assert_eq!(sg.graph.node_count(), 1);
}

#[test]
fn insert_local_scope_adds_child() {
    let mut sg = ScopeGraph::new(range(0, 100), 0);
    sg.insert_local_scope(LocalScope::new(range(10, 50)));
    assert_eq!(sg.graph.node_count(), 2);
}

#[test]
fn insert_local_def_adds_node() {
    let mut sg = ScopeGraph::new(range(0, 100), 0);
    sg.insert_local_def(LocalDef::new(range(5, 10), None));
    assert_eq!(sg.graph.node_count(), 2);
    let def_idx = sg.graph.node_indices().find(|&idx| sg.is_definition(idx));
    assert!(def_idx.is_some());
}

#[test]
fn insert_global_def_always_at_root() {
    let mut sg = ScopeGraph::new(range(0, 100), 0);
    sg.insert_local_scope(LocalScope::new(range(10, 50)));
    sg.insert_global_def(LocalDef::new(range(15, 20), None));
    assert_eq!(sg.graph.node_count(), 3);
    let def_idx = sg
        .graph
        .node_indices()
        .find(|&idx| sg.is_definition(idx))
        .unwrap();
    assert!(sg.is_top_level(def_idx));
}

#[test]
fn insert_ref_with_matching_def() {
    let src = b"let foo = 1; foo;";
    let mut sg = ScopeGraph::new(range(0, 17), 0);
    sg.insert_local_def(LocalDef::new(range(4, 7), None));
    sg.insert_ref(Reference::new(range(13, 16), None), src);
    let ref_idx = sg.graph.node_indices().find(|&idx| sg.is_reference(idx));
    assert!(ref_idx.is_some());
    let defs: Vec<_> = sg.definitions(ref_idx.unwrap()).collect();
    assert_eq!(defs.len(), 1);
}

#[test]
fn insert_ref_no_matching_def_not_added() {
    let src = b"let foo = 1; bar;";
    let mut sg = ScopeGraph::new(range(0, 17), 0);
    sg.insert_local_def(LocalDef::new(range(4, 7), None));
    sg.insert_ref(Reference::new(range(13, 16), None), src);
    let ref_count = sg
        .graph
        .node_indices()
        .filter(|&idx| sg.is_reference(idx))
        .count();
    assert_eq!(ref_count, 0);
}

#[test]
fn hoverable_ranges_excludes_scopes() {
    let mut sg = ScopeGraph::new(range(0, 100), 0);
    sg.insert_local_scope(LocalScope::new(range(10, 50)));
    sg.insert_local_def(LocalDef::new(range(15, 20), None));
    let ranges: Vec<_> = sg.hoverable_ranges().collect();
    assert_eq!(ranges.len(), 1);
    assert_eq!(ranges[0], range(15, 20));
}

#[test]
fn node_by_range_finds_def() {
    let mut sg = ScopeGraph::new(range(0, 100), 0);
    sg.insert_local_def(LocalDef::new(range(10, 20), None));
    let found = sg.node_by_range(10, 20);
    assert!(found.is_some());
    assert!(sg.is_definition(found.unwrap()));
}

#[test]
fn node_by_range_returns_none_for_scope() {
    let sg = ScopeGraph::new(range(0, 100), 0);
    let found = sg.node_by_range(0, 100);
    assert!(found.is_none());
}

#[test]
fn is_top_level_for_root_attached_def() {
    let mut sg = ScopeGraph::new(range(0, 100), 0);
    sg.insert_local_def(LocalDef::new(range(5, 10), None));
    let def_idx = sg
        .graph
        .node_indices()
        .find(|&idx| sg.is_definition(idx))
        .unwrap();
    assert!(sg.is_top_level(def_idx));
}

#[test]
fn is_top_level_false_for_nested_def() {
    let mut sg = ScopeGraph::new(range(0, 100), 0);
    sg.insert_local_scope(LocalScope::new(range(10, 50)));
    sg.insert_local_def(LocalDef::new(range(15, 20), None));
    let def_idx = sg
        .graph
        .node_indices()
        .find(|&idx| sg.is_definition(idx))
        .unwrap();
    assert!(!sg.is_top_level(def_idx));
}

#[test]
fn references_for_definition() {
    let src = b"let x = 1; x; x;";
    let mut sg = ScopeGraph::new(range(0, 17), 0);
    sg.insert_local_def(LocalDef::new(range(4, 5), None));
    sg.insert_ref(Reference::new(range(11, 12), None), src);
    sg.insert_ref(Reference::new(range(14, 15), None), src);
    let def_idx = sg
        .graph
        .node_indices()
        .find(|&idx| sg.is_definition(idx))
        .unwrap();
    let refs: Vec<_> = sg.references(def_idx).collect();
    assert_eq!(refs.len(), 2);
}

#[test]
fn insert_hoisted_def_goes_to_parent_scope() {
    let mut sg = ScopeGraph::new(range(0, 100), 0);
    sg.insert_local_scope(LocalScope::new(range(10, 50)));
    sg.insert_hoisted_def(LocalDef::new(range(15, 20), None));
    let def_idx = sg
        .graph
        .node_indices()
        .find(|&idx| sg.is_definition(idx))
        .unwrap();
    assert!(sg.is_top_level(def_idx));
}

#[test]
fn insert_local_import_adds_node() {
    let mut sg = ScopeGraph::new(range(0, 100), 0);
    sg.insert_local_import(LocalImport::new(range(5, 15)));
    let import_count = sg
        .graph
        .node_indices()
        .filter(|&idx| sg.is_import(idx))
        .count();
    assert_eq!(import_count, 1);
}

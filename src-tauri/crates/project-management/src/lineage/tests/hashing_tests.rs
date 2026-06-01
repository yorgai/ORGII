use crate::lineage::hashing::compute_node_hash;

#[test]
fn same_content_different_whitespace_same_hash() {
    let src_a = "fn foo() {\n    let x = 1;\n}";
    let src_b = "fn foo() {\n  let  x  =  1;\n}";
    assert_eq!(
        compute_node_hash(src_a, 1, 3),
        compute_node_hash(src_b, 1, 3),
    );
}

#[test]
fn different_content_different_hash() {
    let src = "fn foo() {\n    let x = 1;\n}\nfn bar() {\n    let y = 2;\n}";
    assert_ne!(compute_node_hash(src, 1, 3), compute_node_hash(src, 4, 6),);
}

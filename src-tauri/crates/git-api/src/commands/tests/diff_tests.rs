#[test]
fn selected_parent_sha_matches_selected_index() {
    let parent_shas = [
        "1111111".to_string(),
        "2222222".to_string(),
        "3333333".to_string(),
    ];
    let selected_parent_index = Some(1usize);
    let parent_sha = selected_parent_index.and_then(|index| parent_shas.get(index).cloned());
    assert_eq!(parent_sha.as_deref(), Some("2222222"));
}

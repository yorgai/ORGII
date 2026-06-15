use crate::canonical::{AgentMetadata, ArtifactQuality};
use crate::edit_extraction::{
    artifacts_from_extracted_edit, final_diff_from_chunks, EditArtifactContext,
};

fn context(sequence_index: i64) -> EditArtifactContext {
    EditArtifactContext {
        source: "test_source".to_string(),
        source_session_id: Some("source-session".to_string()),
        session_id: "session-1".to_string(),
        source_event_id: Some(format!("event-{sequence_index}")),
        turn_id: None,
        sequence_index,
        timestamp: None,
        workspace_path: Some("/repo".to_string()),
        metadata: AgentMetadata::default(),
    }
}

fn edit(
    file_path: &str,
    old_content: Option<&str>,
    new_content: Option<&str>,
    is_deleted: bool,
) -> core_types::extracted::ExtractedEditData {
    core_types::extracted::ExtractedEditData {
        file_path: file_path.to_string(),
        file_name: file_path
            .rsplit('/')
            .next()
            .unwrap_or(file_path)
            .to_string(),
        language: "typescript".to_string(),
        content: None,
        line_count: None,
        old_content: old_content.map(str::to_string),
        new_content: new_content.map(str::to_string),
        diff: None,
        old_start_line: None,
        new_start_line: None,
        lines_added: None,
        lines_removed: None,
        is_deleted,
        apply_patch_segments: Vec::new(),
    }
}

fn modify(
    file_path: &str,
    old_content: &str,
    new_content: &str,
) -> core_types::extracted::ExtractedEditData {
    edit(file_path, Some(old_content), Some(new_content), false)
}

#[test]
fn final_diff_omits_reverted_net_zero_changes() {
    let file_path = "src/example.ts";
    let first = artifacts_from_extracted_edit(&context(0), &modify(file_path, "a\n", "b\n"));
    let second = artifacts_from_extracted_edit(&context(1), &modify(file_path, "b\n", "a\n"));
    let chunks = first
        .chunks
        .into_iter()
        .chain(second.chunks)
        .collect::<Vec<_>>();

    let final_diff = final_diff_from_chunks("test_source", "session-1", file_path, &chunks);

    assert!(final_diff.is_none());
}

#[test]
fn final_diff_uses_net_baseline_to_latest_content_numstat() {
    let file_path = "src/example.ts";
    let first = artifacts_from_extracted_edit(
        &context(0),
        &modify(file_path, "one\ntwo\nthree\n", "one\ntwo changed\nthree\n"),
    );
    let second = artifacts_from_extracted_edit(
        &context(1),
        &modify(
            file_path,
            "one\ntwo changed\nthree\n",
            "one\ntwo changed\nthree\nfour\n",
        ),
    );
    let chunks = first
        .chunks
        .into_iter()
        .chain(second.chunks)
        .collect::<Vec<_>>();

    let final_diff = final_diff_from_chunks("test_source", "session-1", file_path, &chunks)
        .expect("net final diff");

    assert_eq!(final_diff.lines_added, 2);
    assert_eq!(final_diff.lines_removed, 1);
    assert!(matches!(final_diff.quality, ArtifactQuality::Exact));
    assert!(final_diff.differs_from_summed_chunks);
    assert!(final_diff.diff.unwrap_or_default().contains("two changed"));
}

#[test]
fn final_diff_counts_new_file_from_empty_baseline() {
    let file_path = "src/new_file.ts";
    let created = artifacts_from_extracted_edit(
        &context(0),
        &edit(file_path, None, Some("one\ntwo\nthree\n"), false),
    );

    let final_diff = final_diff_from_chunks("test_source", "session-1", file_path, &created.chunks)
        .expect("new file final diff");

    assert_eq!(final_diff.lines_added, 3);
    assert_eq!(final_diff.lines_removed, 0);
    assert_eq!(final_diff.old_content.as_deref(), Some(""));
    assert_eq!(final_diff.new_content.as_deref(), Some("one\ntwo\nthree\n"));
    assert!(matches!(final_diff.quality, ArtifactQuality::Exact));
}

#[test]
fn final_diff_counts_deleted_file_to_empty_final_content() {
    let file_path = "src/deleted_file.ts";
    let deleted = artifacts_from_extracted_edit(
        &context(0),
        &edit(file_path, Some("one\ntwo\nthree\n"), None, true),
    );

    let final_diff = final_diff_from_chunks("test_source", "session-1", file_path, &deleted.chunks)
        .expect("deleted file final diff");

    assert_eq!(final_diff.lines_added, 0);
    assert_eq!(final_diff.lines_removed, 3);
    assert_eq!(final_diff.old_content.as_deref(), Some("one\ntwo\nthree\n"));
    assert_eq!(final_diff.new_content.as_deref(), Some(""));
    assert!(matches!(final_diff.quality, ArtifactQuality::Exact));
}

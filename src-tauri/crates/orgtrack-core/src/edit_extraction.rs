use chrono::Utc;
use core_types::extracted::ExtractedEditData;

use crate::canonical::{
    AgentMetadata, ArtifactQuality, SessionDiffChunkRecord, SessionEditArtifactRecord,
    SessionEditKind, SessionFinalDiffRecord,
};
use crate::privacy::ORGTRACK_SCHEMA_VERSION;
use crate::repo_sync::paths::{path_hash, record_id};

#[derive(Debug, Clone)]
pub struct EditArtifactContext {
    pub source: String,
    pub source_session_id: Option<String>,
    pub session_id: String,
    pub source_event_id: Option<String>,
    pub turn_id: Option<String>,
    pub sequence_index: i64,
    pub timestamp: Option<String>,
    pub workspace_path: Option<String>,
    pub metadata: AgentMetadata,
}

#[derive(Debug, Clone, Default)]
pub struct NormalizedEditArtifacts {
    pub edits: Vec<SessionEditArtifactRecord>,
    pub chunks: Vec<SessionDiffChunkRecord>,
}

pub fn artifacts_from_extracted_edit(
    context: &EditArtifactContext,
    edit: &ExtractedEditData,
) -> NormalizedEditArtifacts {
    let segments = if edit.apply_patch_segments.is_empty() {
        vec![edit]
    } else {
        edit.apply_patch_segments.iter().collect::<Vec<_>>()
    };
    let mut artifacts = NormalizedEditArtifacts::default();
    for (chunk_index, segment) in segments.into_iter().enumerate() {
        let file_path = if segment.file_path.is_empty() {
            edit.file_path.clone()
        } else {
            segment.file_path.clone()
        };
        if file_path.is_empty() {
            continue;
        }
        let edit_record_id = record_id(&[
            "edit",
            &context.source,
            &context.session_id,
            context.source_event_id.as_deref().unwrap_or(""),
            &context.sequence_index.to_string(),
            &chunk_index.to_string(),
            &file_path,
        ]);
        let quality = edit_quality(segment);
        let lines_added = segment.lines_added.unwrap_or(0) as i32;
        let lines_removed = segment.lines_removed.unwrap_or(0) as i32;
        let old_start_line = to_u32(segment.old_start_line);
        let new_start_line = to_u32(segment.new_start_line);
        artifacts.edits.push(SessionEditArtifactRecord {
            schema_version: ORGTRACK_SCHEMA_VERSION,
            record_id: edit_record_id.clone(),
            source: context.source.clone(),
            source_session_id: context.source_session_id.clone(),
            session_id: context.session_id.clone(),
            source_event_id: context.source_event_id.clone(),
            turn_id: context.turn_id.clone(),
            sequence_index: context.sequence_index,
            timestamp: context.timestamp.clone(),
            workspace_path: context.workspace_path.clone(),
            file_path: file_path.clone(),
            path_hash: path_hash(&file_path),
            edit_kind: edit_kind(segment),
            old_start_line,
            new_start_line,
            start_line: old_start_line.or(new_start_line),
            end_line: changed_end_line(old_start_line, new_start_line, lines_added, lines_removed),
            lines_added,
            lines_removed,
            quality: quality.clone(),
            metadata: context.metadata.clone(),
        });
        artifacts.chunks.push(SessionDiffChunkRecord {
            schema_version: ORGTRACK_SCHEMA_VERSION,
            record_id: record_id(&[
                "diff_chunk",
                &context.source,
                &context.session_id,
                context.source_event_id.as_deref().unwrap_or(""),
                &context.sequence_index.to_string(),
                &chunk_index.to_string(),
                &file_path,
            ]),
            edit_record_id,
            source: context.source.clone(),
            session_id: context.session_id.clone(),
            source_event_id: context.source_event_id.clone(),
            sequence_index: context.sequence_index,
            chunk_index: chunk_index as i64,
            file_path,
            old_start_line,
            new_start_line,
            old_content: segment.old_content.clone(),
            new_content: segment.new_content.clone(),
            diff: segment.diff.clone(),
            lines_added,
            lines_removed,
            is_deleted: segment.is_deleted,
            quality,
        });
    }
    artifacts
}

pub fn final_diff_from_chunks(
    source: &str,
    session_id: &str,
    file_path: &str,
    chunks: &[SessionDiffChunkRecord],
) -> Option<SessionFinalDiffRecord> {
    let baseline_chunk = chunks
        .iter()
        .filter(|chunk| chunk.file_path == file_path)
        .find(|chunk| chunk.old_content.is_some());
    let final_chunk = chunks
        .iter()
        .rev()
        .filter(|chunk| chunk.file_path == file_path)
        .find(|chunk| {
            chunk.new_content.is_some() || chunk.old_content.is_some() || chunk.diff.is_some()
        });
    let final_chunk = final_chunk?;
    let old_content = baseline_chunk
        .and_then(|chunk| chunk.old_content.clone())
        .or_else(|| final_chunk.old_content.clone())
        .or_else(|| final_chunk.new_content.as_ref().map(|_| String::new()));
    let new_content = if final_chunk.is_deleted {
        Some(String::new())
    } else {
        final_chunk.new_content.clone()
    };
    let diff = match (&old_content, &new_content) {
        (Some(old_content), Some(new_content)) => {
            let text_diff = similar::TextDiff::from_lines(old_content, new_content);
            let unified_diff = text_diff.unified_diff().to_string();
            if unified_diff.trim().is_empty() {
                return None;
            }
            Some(unified_diff)
        }
        _ => final_chunk.diff.clone(),
    };
    let quality = if old_content.is_some() && new_content.is_some() {
        ArtifactQuality::Exact
    } else if diff.is_some() {
        ArtifactQuality::PatchReversible
    } else {
        ArtifactQuality::Inferred
    };
    let summed_lines_added: i32 = chunks
        .iter()
        .filter(|chunk| chunk.file_path == file_path)
        .map(|chunk| chunk.lines_added)
        .sum();
    let summed_lines_removed: i32 = chunks
        .iter()
        .filter(|chunk| chunk.file_path == file_path)
        .map(|chunk| chunk.lines_removed)
        .sum();
    let final_numstat = old_content
        .as_deref()
        .zip(new_content.as_deref())
        .map(|(old_content, new_content)| {
            let diff = similar::TextDiff::from_lines(old_content, new_content);
            diff.iter_all_changes()
                .fold((0_i32, 0_i32), |(added, removed), change| {
                    match change.tag() {
                        similar::ChangeTag::Insert => (added + 1, removed),
                        similar::ChangeTag::Delete => (added, removed + 1),
                        similar::ChangeTag::Equal => (added, removed),
                    }
                })
        })
        .unwrap_or((final_chunk.lines_added, final_chunk.lines_removed));
    Some(SessionFinalDiffRecord {
        schema_version: ORGTRACK_SCHEMA_VERSION,
        record_id: record_id(&["final_diff", source, session_id, file_path]),
        source: source.to_string(),
        session_id: session_id.to_string(),
        file_path: file_path.to_string(),
        baseline_event_id: baseline_chunk.and_then(|chunk| chunk.source_event_id.clone()),
        final_event_id: final_chunk.source_event_id.clone(),
        old_content,
        new_content,
        diff,
        lines_added: final_numstat.0,
        lines_removed: final_numstat.1,
        is_deleted: final_chunk.is_deleted,
        quality,
        differs_from_summed_chunks: final_numstat.0 != summed_lines_added
            || final_numstat.1 != summed_lines_removed,
        computed_at: Utc::now().to_rfc3339(),
    })
}

fn edit_quality(edit: &ExtractedEditData) -> ArtifactQuality {
    if edit.old_content.is_some() && edit.new_content.is_some() {
        ArtifactQuality::Exact
    } else if edit.diff.is_some() || edit.old_content.is_some() || edit.new_content.is_some() {
        ArtifactQuality::PatchReversible
    } else if edit.lines_added.is_some() || edit.lines_removed.is_some() {
        ArtifactQuality::StatsOnly
    } else {
        ArtifactQuality::Inferred
    }
}

fn edit_kind(edit: &ExtractedEditData) -> SessionEditKind {
    if edit.is_deleted {
        return SessionEditKind::Delete;
    }
    if !edit.apply_patch_segments.is_empty() || edit.diff.is_some() {
        return SessionEditKind::Patch;
    }
    if edit.new_content.is_some() || edit.content.is_some() {
        return SessionEditKind::Write;
    }
    SessionEditKind::Unknown
}

fn to_u32(value: Option<usize>) -> Option<u32> {
    value.and_then(|value| u32::try_from(value).ok())
}

fn changed_end_line(
    old_start_line: Option<u32>,
    new_start_line: Option<u32>,
    lines_added: i32,
    lines_removed: i32,
) -> Option<u32> {
    let start_line = old_start_line.or(new_start_line)?;
    let changed_lines = lines_added.max(lines_removed).max(1) as u32;
    Some(start_line + changed_lines.saturating_sub(1))
}

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Default)]
struct FileChangeStats {
    files: BTreeSet<String>,
    lines_added: i32,
    lines_removed: i32,
}

use crate::canonical::{CommitLinkRecord, SessionFinalDiffRecord, SessionRecord};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreSessionSummary {
    pub session_id: String,
    pub title: String,
    pub source: String,
    pub workspace_path: Option<String>,
    pub files_changed: usize,
    pub lines_added: i32,
    pub lines_removed: i32,
    pub related_commits: usize,
    pub committed_rate_percent: usize,
    pub model: Option<String>,
    pub key_source: Option<String>,
}

pub fn session_summaries(
    sessions: Vec<SessionRecord>,
    final_diffs: Vec<SessionFinalDiffRecord>,
    commit_links: Vec<CommitLinkRecord>,
) -> Vec<CoreSessionSummary> {
    let mut stats_by_session: BTreeMap<String, FileChangeStats> = BTreeMap::new();
    for final_diff in final_diffs {
        let stats = stats_by_session.entry(final_diff.session_id).or_default();
        stats.files.insert(final_diff.file_path);
        stats.lines_added += final_diff.lines_added;
        stats.lines_removed += final_diff.lines_removed;
    }

    let mut commits_by_session: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for link in commit_links {
        for session_id in link.session_ids {
            commits_by_session
                .entry(session_id)
                .or_default()
                .insert(link.commit_sha.clone());
        }
    }

    sessions
        .into_iter()
        .map(|session| {
            let stats = stats_by_session.get(&session.session_id);
            let related_commits = commits_by_session
                .get(&session.session_id)
                .map(BTreeSet::len)
                .unwrap_or(0);
            let files_changed = stats.map(|stats| stats.files.len()).unwrap_or(0);
            CoreSessionSummary {
                session_id: session.session_id,
                title: session.title,
                source: session.source,
                workspace_path: session.workspace_path,
                files_changed,
                lines_added: stats.map(|stats| stats.lines_added).unwrap_or(0),
                lines_removed: stats.map(|stats| stats.lines_removed).unwrap_or(0),
                related_commits,
                committed_rate_percent: 0,
                model: session.metadata.model,
                key_source: session.metadata.key_source,
            }
        })
        .collect()
}

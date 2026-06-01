//! Session workspace — cc-aligned three-concept path model.
//!
//! This module defines the in-memory shape only. Load/save against
//! `agent_sessions` is owned by `session/persistence/crud.rs`.
//!
//! # Three concepts (cc-aligned)
//!
//! - [`SessionWorkspace::workspace_root`] — stable workspace identity
//!   (what the user sees in the UI). Set once at session creation,
//!   never mutated mid-session. cc analogue: `workspaceRoot` in
//!   `claude_code/bootstrap/state.ts`.
//! - [`SessionWorkspace::working_dir`] — where file-touching tools
//!   execute. Equals `workspace_root` for non-worktree sessions; for
//!   SDE worktree sessions this is the shadow checkout under
//!   `~/.orgii/agent_snapshots/<blake3>/`.
//! - [`SessionWorkspace::additional_directories`] — extra dirs granted
//!   post-creation via `/add-dir` or IDE UI. Keyed by canonical path.
//!   cc analogue: `additionalWorkingDirectories`.
//!
//! uses the collection as an **authorisation expression**
//! honoured by file tools when `restrict_to_workspace == true`. This
//! is NOT a sandbox (see session-workspace design doc §sandbox).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Source that granted an [`AdditionalDirectory`].
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DirectorySource {
    /// In-memory only; dies with the session. Default because it is
    /// the safest assumption when deserialising an entry with missing
    /// `source` — we never want to upgrade silently to a persisted
    /// scope.
    #[default]
    Session,
    /// Workspace-scoped, persisted to `<workspace_root>/.orgii/settings.local.json`.
    LocalSettings,
    /// User-scoped, persisted to `~/.orgii/settings.json`. Currently
    /// only READ by the agent (round-trips hand-edited entries); no
    /// command writes it. Kept for forward compat.
    UserSettings,
    /// Granted via a future `--add-dir` CLI launch flag. The agent
    /// does NOT read this source yet (no CLI flag exists); defined
    /// for forward compat.
    CliArg,
}

/// A single additional directory entry.
///
/// The `path` is expected to be canonicalised at insertion time by
/// the caller (see `state/commands/session/workspace.rs` when that
/// lands in PR-C). `source` is first-writer-wins: re-adding the same
/// path with a different source returns `false` from
/// [`SessionWorkspace::add_directory`] and leaves the original
/// source in place.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdditionalDirectory {
    pub path: PathBuf,
    #[serde(default)]
    pub source: DirectorySource,
}

/// Workspace abstraction used by agent_core sessions.
///
/// See the module-level docs for the meaning of each field. This
/// type is deliberately small — persistence, tool wiring, and prompt
/// rendering live in their respective subsystems and consume this
/// via the accessors (`working_dir`, `user_visible`, `effective_roots`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionWorkspace {
    pub workspace_root: PathBuf,
    pub working_dir: PathBuf,
    /// Keyed by canonical path for O(log n) dedup + stable JSON
    /// ordering (BTreeMap, not HashMap).
    #[serde(default)]
    pub additional_directories: BTreeMap<PathBuf, AdditionalDirectory>,
}

impl SessionWorkspace {
    // ── Constructors ──

    /// Non-worktree session (IDE, OS, channel). Working directory
    /// equals the workspace root.
    pub fn new(workspace_root: PathBuf) -> Self {
        Self {
            working_dir: workspace_root.clone(),
            workspace_root,
            additional_directories: BTreeMap::new(),
        }
    }

    /// SDE worktree session: `working_dir` is the shadow checkout
    /// (blake3-keyed path under `~/.orgii/agent_snapshots/`).
    pub fn new_worktree(workspace_root: PathBuf, worktree_path: PathBuf) -> Self {
        Self {
            workspace_root,
            working_dir: worktree_path,
            additional_directories: BTreeMap::new(),
        }
    }

    // ── Accessors ──

    /// User-visible workspace root path (stable identity shown in UI).
    pub fn user_visible(&self) -> &Path {
        &self.workspace_root
    }

    /// Working directory where tools execute and resolve relative paths.
    /// Equals `workspace_root` for normal sessions; differs for worktree
    /// sessions (shadow checkout).
    pub fn working_dir(&self) -> &Path {
        &self.working_dir
    }

    /// True if this session runs out of a worktree shadow rather than
    /// the user's real workspace directory.
    pub fn is_worktree(&self) -> bool {
        self.working_dir != self.workspace_root
    }

    /// Full allow-list for path-containment checks: workspace_root +
    /// working_dir (if different) + every additional dir. Order is
    /// stable (BTreeMap key order for the tail).
    pub fn effective_roots(&self) -> Vec<PathBuf> {
        let mut out = Vec::with_capacity(2 + self.additional_directories.len());
        out.push(self.workspace_root.clone());
        if self.is_worktree() {
            out.push(self.working_dir.clone());
        }
        out.extend(self.additional_directories.keys().cloned());
        out
    }

    /// Additional dirs filtered by source. Used by persistence to
    /// pick which entries should be mirrored to `settings.local.json`
    /// vs kept only on the live session row.
    pub fn additional_by_source(
        &self,
        source: DirectorySource,
    ) -> impl Iterator<Item = &AdditionalDirectory> {
        self.additional_directories
            .values()
            .filter(move |d| d.source == source)
    }

    // ── Mutators ──

    /// Insert. Returns `true` if the path was newly added, `false`
    /// if it already existed (first-writer-wins for source).
    pub fn add_directory(&mut self, dir: AdditionalDirectory) -> bool {
        use std::collections::btree_map::Entry;
        match self.additional_directories.entry(dir.path.clone()) {
            Entry::Vacant(slot) => {
                slot.insert(dir);
                true
            }
            Entry::Occupied(_) => false,
        }
    }

    /// Remove; returns the removed entry if present.
    pub fn remove_directory(&mut self, path: &Path) -> Option<AdditionalDirectory> {
        self.additional_directories.remove(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pb(s: &str) -> PathBuf {
        PathBuf::from(s)
    }

    fn session_dir(p: &str) -> AdditionalDirectory {
        AdditionalDirectory {
            path: pb(p),
            source: DirectorySource::Session,
        }
    }

    #[test]
    fn new_sets_working_dir_equal_to_workspace_root() {
        let ws = SessionWorkspace::new(pb("/proj"));
        assert_eq!(ws.user_visible(), Path::new("/proj"));
        assert_eq!(ws.working_dir(), Path::new("/proj"));
        assert!(!ws.is_worktree());
    }

    #[test]
    fn new_worktree_splits_working_dir_from_root() {
        let ws = SessionWorkspace::new_worktree(pb("/proj"), pb("/shadow/abc"));
        assert_eq!(ws.user_visible(), Path::new("/proj"));
        assert_eq!(ws.working_dir(), Path::new("/shadow/abc"));
        assert!(ws.is_worktree());
    }

    #[test]
    fn effective_roots_non_worktree_is_just_project_plus_additional() {
        let mut ws = SessionWorkspace::new(pb("/proj"));
        ws.add_directory(session_dir("/peer"));
        assert_eq!(ws.effective_roots(), vec![pb("/proj"), pb("/peer")]);
    }

    #[test]
    fn effective_roots_worktree_includes_both_paths() {
        let mut ws = SessionWorkspace::new_worktree(pb("/proj"), pb("/shadow"));
        ws.add_directory(session_dir("/peer"));
        assert_eq!(
            ws.effective_roots(),
            vec![pb("/proj"), pb("/shadow"), pb("/peer")]
        );
    }

    #[test]
    fn add_directory_is_first_writer_wins() {
        let mut ws = SessionWorkspace::new(pb("/proj"));
        let first = AdditionalDirectory {
            path: pb("/peer"),
            source: DirectorySource::Session,
        };
        let second = AdditionalDirectory {
            path: pb("/peer"),
            source: DirectorySource::LocalSettings,
        };

        assert!(ws.add_directory(first));
        assert!(!ws.add_directory(second));

        let stored = ws.additional_directories.get(Path::new("/peer")).unwrap();
        assert_eq!(stored.source, DirectorySource::Session);
    }

    #[test]
    fn additional_by_source_filters_correctly() {
        let mut ws = SessionWorkspace::new(pb("/proj"));
        ws.add_directory(session_dir("/sess"));
        ws.add_directory(AdditionalDirectory {
            path: pb("/local"),
            source: DirectorySource::LocalSettings,
        });

        let sessions: Vec<_> = ws
            .additional_by_source(DirectorySource::Session)
            .map(|d| d.path.clone())
            .collect();
        assert_eq!(sessions, vec![pb("/sess")]);

        let local: Vec<_> = ws
            .additional_by_source(DirectorySource::LocalSettings)
            .map(|d| d.path.clone())
            .collect();
        assert_eq!(local, vec![pb("/local")]);
    }

    #[test]
    fn remove_directory_returns_removed_entry() {
        let mut ws = SessionWorkspace::new(pb("/proj"));
        ws.add_directory(session_dir("/peer"));
        let removed = ws.remove_directory(Path::new("/peer"));
        assert!(removed.is_some());
        assert!(ws.additional_directories.is_empty());

        let second = ws.remove_directory(Path::new("/peer"));
        assert!(second.is_none());
    }

    #[test]
    fn serde_round_trip_preserves_map_and_sources() {
        let mut ws = SessionWorkspace::new_worktree(pb("/proj"), pb("/shadow"));
        ws.add_directory(session_dir("/a"));
        ws.add_directory(AdditionalDirectory {
            path: pb("/b"),
            source: DirectorySource::LocalSettings,
        });

        let json = serde_json::to_string(&ws).expect("serialise");
        let back: SessionWorkspace = serde_json::from_str(&json).expect("deserialise");
        assert_eq!(back, ws);
    }

    #[test]
    fn directory_source_default_is_session() {
        // Important: an entry with missing `source` field in JSON
        // must deserialise as Session (safest — never silently
        // promote to a persisted scope).
        let json = r#"{"path":"/peer"}"#;
        let dir: AdditionalDirectory = serde_json::from_str(json).expect("deserialise");
        assert_eq!(dir.source, DirectorySource::Session);
    }

    #[test]
    fn directory_source_serialises_camel_case() {
        let dir = AdditionalDirectory {
            path: pb("/x"),
            source: DirectorySource::LocalSettings,
        };
        let json = serde_json::to_string(&dir).expect("serialise");
        assert!(json.contains("\"localSettings\""), "got: {json}");
    }

    #[test]
    fn additional_dirs_json_is_empty_map_by_default() {
        // The DB default for `workspace_additional_json` is '{}' —
        // deserialising that into the map field must succeed.
        let map: BTreeMap<PathBuf, AdditionalDirectory> =
            serde_json::from_str("{}").expect("deserialise empty map");
        assert!(map.is_empty());
    }

    #[test]
    fn effective_roots_ordering_is_stable_across_inserts() {
        let mut ws = SessionWorkspace::new(pb("/proj"));
        ws.add_directory(session_dir("/z"));
        ws.add_directory(session_dir("/a"));
        ws.add_directory(session_dir("/m"));

        // BTreeMap sorts by key — deterministic output.
        assert_eq!(
            ws.effective_roots(),
            vec![pb("/proj"), pb("/a"), pb("/m"), pb("/z")]
        );
    }
}

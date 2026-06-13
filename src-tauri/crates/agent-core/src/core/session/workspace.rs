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

/// Canonicalize `path`, falling back to lexical normalization (`.`/`..`
/// resolution without filesystem access) when the path does not exist.
///
/// This is the single normalization function for every path that enters
/// or is compared against the workspace authorization set. Reuses the
/// crate-wide `normalize_lexical` from `tool_infra::file` so there is
/// exactly one lexical normalizer in the codebase.
pub fn canonicalize_or_lexical(path: &Path) -> PathBuf {
    path.canonicalize()
        .unwrap_or_else(|_| crate::foundation::tool_infra::file::normalize_lexical(path))
}

/// Canonicalize a candidate path for containment checks. Unlike
/// [`canonicalize_or_lexical`], a not-yet-existing leaf (e.g. a file
/// about to be created) resolves through its parent: canonicalize the
/// parent and re-append the filename, so symlinked parents cannot be
/// used to escape. Falls back to lexical normalization when even the
/// parent does not exist.
fn canonicalize_candidate(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return canonical;
    }
    if let (Some(parent), Some(file_name)) = (path.parent(), path.file_name()) {
        if let Ok(canonical_parent) = parent.canonicalize() {
            return canonical_parent.join(file_name);
        }
    }
    crate::foundation::tool_infra::file::normalize_lexical(path)
}

/// Source that granted an [`AdditionalDirectory`].
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DirectorySource {
    /// Runtime grant (agent `/add-dir`, channel tool, ad-hoc UI action).
    /// Persisted with the session row (`workspace_additional_json`) like
    /// every other entry — it survives restarts of the same session but
    /// is never mirrored to any settings file. Default because it is
    /// the safest assumption when deserialising an entry with missing
    /// `source`.
    #[default]
    Session,
    /// Mirrored from the IDE's multi-root workspace folders by the
    /// frontend sync layer (`useSessionWorkspaceSync`). Managed
    /// exclusively by that layer — the agent must not add or remove
    /// these.
    IdeWorkspace,
    /// Historical variant kept for serde compatibility with old session
    /// rows. The promised mirror to
    /// `<workspace_root>/.orgii/settings.local.json` was never
    /// implemented; no code path writes this source today.
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
/// `path` is normalized via [`canonicalize_or_lexical`] inside
/// [`SessionWorkspace::add_directory`] — callers may pass any spelling.
/// `source` is first-writer-wins: re-adding the same path with a
/// different source returns `false` from
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

    /// [`Self::new_worktree`] that also inherits the parent session's
    /// `additional_directories` (already canonical — copied verbatim).
    /// Used by subagent worktree isolation so a worker keeps every
    /// directory the parent was granted via `/add-dir`.
    pub fn new_worktree_inheriting(
        workspace_root: PathBuf,
        worktree_path: PathBuf,
        parent: &SessionWorkspace,
    ) -> Self {
        Self {
            workspace_root,
            working_dir: worktree_path,
            additional_directories: parent.additional_directories.clone(),
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

    /// [`Self::effective_roots`] with every root passed through
    /// [`canonicalize_or_lexical`]. Additional dirs are already
    /// canonical (normalized at insertion); `workspace_root` and
    /// `working_dir` may carry symlinked spellings from launch params,
    /// so they are normalized here.
    pub fn effective_roots_canonical(&self) -> Vec<PathBuf> {
        self.effective_roots()
            .iter()
            .map(|root| canonicalize_or_lexical(root))
            .collect()
    }

    /// THE single path-containment check for this session.
    ///
    /// `candidate` is canonicalized (falling back through its parent for
    /// not-yet-existing leaves, then lexically) and tested with
    /// `starts_with` against every canonical effective root plus
    /// `extra_allowed` (e.g. the active IDE repo). The rejection
    /// message lists every allowed root so the model can self-correct.
    pub fn is_path_allowed(
        &self,
        candidate: &Path,
        extra_allowed: &[PathBuf],
    ) -> Result<(), String> {
        let resolved = canonicalize_candidate(candidate);
        let mut roots = self.effective_roots_canonical();
        roots.extend(extra_allowed.iter().map(|p| canonicalize_or_lexical(p)));

        if roots.iter().any(|root| resolved.starts_with(root)) {
            return Ok(());
        }

        Err(format!(
            "Path '{}' is outside the session workspace. Allowed roots: {}",
            candidate.display(),
            roots
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        ))
    }

    /// Additional dirs filtered by source. Used by callers that need
    /// to distinguish runtime grants from IDE-mirrored entries (e.g.
    /// CLI launch `--add-dir` projection, IDE sync diffing).
    pub fn additional_by_source(
        &self,
        source: DirectorySource,
    ) -> impl Iterator<Item = &AdditionalDirectory> {
        self.additional_directories
            .values()
            .filter(move |d| d.source == source)
    }

    // ── Mutators ──

    /// Insert. The single write entry point for additional directories:
    /// `dir.path` is normalized via [`canonicalize_or_lexical`] before
    /// being used as the map key, so two spellings of the same directory
    /// (symlink vs real, trailing `..` etc.) collapse to one entry.
    /// Returns `true` if the path was newly added, `false` if it
    /// already existed (first-writer-wins for source).
    pub fn add_directory(&mut self, dir: AdditionalDirectory) -> bool {
        use std::collections::btree_map::Entry;
        let canonical = canonicalize_or_lexical(&dir.path);
        match self.additional_directories.entry(canonical.clone()) {
            Entry::Vacant(slot) => {
                slot.insert(AdditionalDirectory {
                    path: canonical,
                    source: dir.source,
                });
                true
            }
            Entry::Occupied(_) => false,
        }
    }

    /// Remove; returns the removed entry if present. `path` is
    /// normalized through the same [`canonicalize_or_lexical`] as
    /// [`Self::add_directory`], so any spelling of a granted directory
    /// removes it.
    pub fn remove_directory(&mut self, path: &Path) -> Option<AdditionalDirectory> {
        self.additional_directories
            .remove(&canonicalize_or_lexical(path))
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

    // ── canonicalization entry point ──

    #[cfg(unix)]
    #[test]
    fn add_directory_canonicalizes_symlinked_spelling() {
        let tmp = tempfile::TempDir::new().unwrap();
        let real = tmp.path().join("real");
        std::fs::create_dir(&real).unwrap();
        let link = tmp.path().join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        let mut ws = SessionWorkspace::new(pb("/proj"));
        assert!(ws.add_directory(AdditionalDirectory {
            path: link.clone(),
            source: DirectorySource::Session,
        }));

        let canonical_real = real.canonicalize().unwrap();
        assert!(
            ws.additional_directories.contains_key(&canonical_real),
            "expected canonical key {canonical_real:?}, got {:?}",
            ws.additional_directories.keys().collect::<Vec<_>>()
        );
        // Re-adding the real spelling is a duplicate, not a second entry.
        assert!(!ws.add_directory(AdditionalDirectory {
            path: real,
            source: DirectorySource::Session,
        }));
        assert_eq!(ws.additional_directories.len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn remove_directory_accepts_alternate_spelling() {
        let tmp = tempfile::TempDir::new().unwrap();
        let real = tmp.path().join("real");
        std::fs::create_dir(&real).unwrap();
        let link = tmp.path().join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        let mut ws = SessionWorkspace::new(pb("/proj"));
        ws.add_directory(AdditionalDirectory {
            path: real,
            source: DirectorySource::Session,
        });
        // Remove via the symlink spelling — must hit the same entry.
        assert!(ws.remove_directory(&link).is_some());
        assert!(ws.additional_directories.is_empty());
    }

    #[test]
    fn add_directory_normalizes_lexically_when_path_missing() {
        let mut ws = SessionWorkspace::new(pb("/proj"));
        ws.add_directory(session_dir("/nonexistent/a/../b"));
        assert!(ws
            .additional_directories
            .contains_key(Path::new("/nonexistent/b")));
        assert!(ws.remove_directory(Path::new("/nonexistent/b/.")).is_some());
    }

    // ── is_path_allowed ──

    #[test]
    fn is_path_allowed_accepts_paths_under_any_root() {
        let workspace = tempfile::TempDir::new().unwrap();
        let extra = tempfile::TempDir::new().unwrap();
        let mut ws = SessionWorkspace::new(workspace.path().to_path_buf());
        ws.add_directory(AdditionalDirectory {
            path: extra.path().to_path_buf(),
            source: DirectorySource::Session,
        });

        std::fs::write(workspace.path().join("a.txt"), "x").unwrap();
        std::fs::write(extra.path().join("b.txt"), "x").unwrap();

        assert!(ws
            .is_path_allowed(&workspace.path().join("a.txt"), &[])
            .is_ok());
        assert!(ws.is_path_allowed(&extra.path().join("b.txt"), &[]).is_ok());
        // Not-yet-existing leaf resolves through its parent.
        assert!(ws
            .is_path_allowed(&extra.path().join("new.txt"), &[])
            .is_ok());
    }

    #[test]
    fn is_path_allowed_rejection_lists_all_roots() {
        let workspace = tempfile::TempDir::new().unwrap();
        let extra = tempfile::TempDir::new().unwrap();
        let outside = tempfile::TempDir::new().unwrap();
        let mut ws = SessionWorkspace::new(workspace.path().to_path_buf());
        ws.add_directory(AdditionalDirectory {
            path: extra.path().to_path_buf(),
            source: DirectorySource::Session,
        });

        let err = ws
            .is_path_allowed(&outside.path().join("secret.txt"), &[])
            .unwrap_err();
        let canonical_ws = workspace.path().canonicalize().unwrap();
        let canonical_extra = extra.path().canonicalize().unwrap();
        assert!(
            err.contains(&canonical_ws.display().to_string()),
            "missing workspace root in: {err}"
        );
        assert!(
            err.contains(&canonical_extra.display().to_string()),
            "missing extra root in: {err}"
        );
    }

    #[test]
    fn is_path_allowed_honors_extra_allowed_argument() {
        let workspace = tempfile::TempDir::new().unwrap();
        let active_repo = tempfile::TempDir::new().unwrap();
        let ws = SessionWorkspace::new(workspace.path().to_path_buf());

        assert!(ws.is_path_allowed(active_repo.path(), &[]).is_err());
        assert!(ws
            .is_path_allowed(active_repo.path(), &[active_repo.path().to_path_buf()])
            .is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn is_path_allowed_rejects_symlink_escape() {
        let workspace = tempfile::TempDir::new().unwrap();
        let outside = tempfile::TempDir::new().unwrap();
        let secret = outside.path().join("secret.txt");
        std::fs::write(&secret, "x").unwrap();
        let link = workspace.path().join("escape.txt");
        std::os::unix::fs::symlink(&secret, &link).unwrap();

        let ws = SessionWorkspace::new(workspace.path().to_path_buf());
        assert!(ws.is_path_allowed(&link, &[]).is_err());
    }

    // ── worktree inheritance ──

    #[test]
    fn new_worktree_inheriting_copies_parent_extras() {
        let mut parent = SessionWorkspace::new(pb("/proj"));
        parent.add_directory(session_dir("/peer"));
        parent.add_directory(AdditionalDirectory {
            path: pb("/ide"),
            source: DirectorySource::IdeWorkspace,
        });

        let child = SessionWorkspace::new_worktree_inheriting(pb("/proj"), pb("/shadow"), &parent);
        assert!(child.is_worktree());
        assert_eq!(
            child.effective_roots(),
            vec![pb("/proj"), pb("/shadow"), pb("/ide"), pb("/peer")]
        );
        assert_eq!(
            child
                .additional_directories
                .get(Path::new("/ide"))
                .unwrap()
                .source,
            DirectorySource::IdeWorkspace
        );
    }

    #[test]
    fn ide_workspace_source_serialises_camel_case() {
        let dir = AdditionalDirectory {
            path: pb("/x"),
            source: DirectorySource::IdeWorkspace,
        };
        let json = serde_json::to_string(&dir).expect("serialise");
        assert!(json.contains("\"ideWorkspace\""), "got: {json}");
    }
}

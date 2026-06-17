use crate::canonical::{
    ActivityRecord, CommitLinkRecord, FileChangeRecord, ScanCheckpoint,
    SessionCheckpointFileStateRecord, SessionCheckpointRecord, SessionDiffChunkRecord,
    SessionEditArtifactRecord, SessionFinalDiffRecord, SessionRecord,
};

pub trait RecordStore {
    fn upsert_session(&self, record: &SessionRecord) -> Result<(), String>;
    fn append_activity(&self, record: &ActivityRecord) -> Result<(), String>;
    fn upsert_file_change(&self, record: &FileChangeRecord) -> Result<(), String>;
    fn upsert_commit_link(&self, record: &CommitLinkRecord) -> Result<(), String>;
    fn upsert_edit_artifact(&self, record: &SessionEditArtifactRecord) -> Result<(), String>;
    fn upsert_diff_chunk(&self, record: &SessionDiffChunkRecord) -> Result<(), String>;
    fn upsert_final_diff(&self, record: &SessionFinalDiffRecord) -> Result<(), String>;
    fn upsert_session_checkpoint(&self, record: &SessionCheckpointRecord) -> Result<(), String>;
    fn upsert_checkpoint_file_state(
        &self,
        record: &SessionCheckpointFileStateRecord,
    ) -> Result<(), String>;
    fn delete_session_artifacts(&self, source: &str, session_id: &str) -> Result<(), String>;
    fn delete_session_derived_artifacts(
        &self,
        source: &str,
        session_id: &str,
    ) -> Result<(), String>;
    fn list_commit_links(&self) -> Result<Vec<CommitLinkRecord>, String>;
    fn list_edit_artifacts(
        &self,
        source: Option<&str>,
        session_id: Option<&str>,
    ) -> Result<Vec<SessionEditArtifactRecord>, String>;
    fn list_diff_chunks(
        &self,
        source: Option<&str>,
        session_id: Option<&str>,
    ) -> Result<Vec<SessionDiffChunkRecord>, String>;
    fn list_final_diffs(
        &self,
        source: Option<&str>,
        session_id: Option<&str>,
    ) -> Result<Vec<SessionFinalDiffRecord>, String>;
    fn list_session_checkpoints(
        &self,
        source: Option<&str>,
        session_id: Option<&str>,
    ) -> Result<Vec<SessionCheckpointRecord>, String>;
    fn list_checkpoint_file_states(
        &self,
        checkpoint_id: &str,
    ) -> Result<Vec<SessionCheckpointFileStateRecord>, String>;
    fn get_checkpoint(&self, source: &str) -> Result<Option<ScanCheckpoint>, String>;
    fn put_checkpoint(&self, checkpoint: &ScanCheckpoint) -> Result<(), String>;
    fn list_sessions(&self, workspace_path: Option<&str>) -> Result<Vec<SessionRecord>, String>;
    fn list_file_changes(
        &self,
        workspace_path: Option<&str>,
    ) -> Result<Vec<FileChangeRecord>, String>;
}

#[cfg(feature = "sqlite")]
pub mod sqlite;

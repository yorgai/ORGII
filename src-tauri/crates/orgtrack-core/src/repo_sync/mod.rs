pub mod paths;
pub mod types;

use std::path::Path;

use crate::store::RecordStore;

pub fn sync_repo_from_store<S: RecordStore>(
    store: &S,
    repo_path: &Path,
) -> Result<types::OrgtrackIndex, String> {
    let records = store.list_file_changes(None)?;
    crate::projectors::session_blame::build_orgtrack_index_from_file_changes(repo_path, records)
}

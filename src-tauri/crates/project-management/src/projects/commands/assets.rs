//! Project asset commands: save / delete / list / resolve.
//!
//! Assets are binary blobs (images embedded in work item bodies,
//! project covers, attachments). They never live in the database —
//! the file system is the storage, keyed by stable `project_id`
//! under `~/.orgii/projects/assets/{project_id}/`. The slug-keyed
//! command surface stays identical to the legacy one so the
//! frontend's markdown-image plumbing keeps working unchanged.
//!
//! The base64 round-trip on `project_save_asset` is unfortunate but
//! unavoidable: Tauri's IPC layer can't carry raw `Vec<u8>` cleanly
//! through the v1 invoke channel. We decode at the command edge and
//! hand a slice to the IO layer so the on-disk path never sees
//! base64.

use base64::Engine;

use super::super::io;

/// Save a binary asset under `project_slug`. The frontend uploads
/// base64 (Tauri v1 IPC limitation); we decode once at the boundary
/// and hand raw bytes to the IO layer, which writes via tmp + rename
/// for crash-safe atomicity. Returns the relative path
/// (`assets/{filename}`) the frontend embeds in markdown.
#[tauri::command]
pub async fn project_save_asset(
    project_slug: String,
    filename: String,
    base64_data: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let data = base64::engine::general_purpose::STANDARD
            .decode(&base64_data)
            .map_err(|err| format!("Invalid base64 data: {}", err))?;
        io::save_asset(&project_slug, &filename, &data)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Delete an asset by `(project_slug, filename)`. Errors if the
/// asset doesn't exist so the caller can show a meaningful message
/// instead of a silent no-op.
#[tauri::command]
pub async fn project_delete_asset(project_slug: String, filename: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || io::delete_asset(&project_slug, &filename))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

/// List every asset filename for `project_slug`, lexicographically
/// sorted. Half-written `.tmp` files (left behind by an interrupted
/// `save_asset`) are filtered out so the UI never tries to render
/// them.
#[tauri::command]
pub async fn project_list_assets(project_slug: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || io::list_assets(&project_slug))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

/// Resolve the absolute filesystem path for an asset so the
/// frontend can pass it to Tauri's `convertFileSrc` for use as an
/// `<img>` source. Validation rejects path-traversal attempts at
/// the IO layer; the command is a transparent wrapper.
#[tauri::command]
pub async fn project_resolve_asset_path(
    project_slug: String,
    filename: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || io::resolve_asset_path(&project_slug, &filename))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

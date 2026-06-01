//! Project org CRUD against the `project_orgs` table.

use std::path::Path;

use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use super::helpers::{conn, map_db, now_ms, to_iso8601};
use crate::projects::types::{
    ConfigureProjectOrgGitFolderSyncRequest, CreateProjectOrgRequest, ProjectOrg,
};

const LOCAL_ORG_SOURCE: &str = "local";
const NO_SYNC_PROVIDER: &str = "none";
const GIT_FOLDER_SYNC_PROVIDER: &str = "git_folder";
const DEFAULT_ORG_KEY_PREFIX: &str = "ORG";
const DEFAULT_ORG_ID_PREFIX: &str = "org";

pub fn read_project_orgs() -> Result<Vec<ProjectOrg>, String> {
    let connection = conn()?;
    let mut stmt = map_db(connection.prepare(
        "SELECT id, name, slug, org_key, source, sync_provider, sync_config_json,
                sync_connection_id, external_org_id, created_at, updated_at
         FROM project_orgs
         ORDER BY updated_at DESC, created_at DESC, name ASC",
    ))?;
    let rows = map_db(stmt.query_map([], row_to_project_org))?;
    let mut orgs = Vec::new();
    for entry in rows {
        orgs.push(map_db(entry)?);
    }
    Ok(orgs)
}

pub fn read_project_org(org_id: &str) -> Result<ProjectOrg, String> {
    let connection = conn()?;
    map_db(
        connection
            .query_row(
                "SELECT id, name, slug, org_key, source, sync_provider, sync_config_json,
                        sync_connection_id, external_org_id, created_at, updated_at
                 FROM project_orgs
                 WHERE id = ?1",
                params![org_id],
                row_to_project_org,
            )
            .optional(),
    )?
    .ok_or_else(|| format!("org not found: {}", org_id))
}

pub fn create_project_org(request: &CreateProjectOrgRequest) -> Result<ProjectOrg, String> {
    let name = request.name.trim();
    if name.is_empty() {
        return Err("Org name is required".to_string());
    }

    let slug = normalize_slug(name);
    if slug.is_empty() {
        return Err("Org name must include at least one alphanumeric character".to_string());
    }

    let connection = conn()?;
    let exists: bool = map_db(
        connection
            .query_row(
                "SELECT 1 FROM project_orgs WHERE slug = ?1 OR org_key = ?2",
                params![&slug, org_key_from_slug(&slug)],
                |_| Ok(true),
            )
            .optional(),
    )?
    .unwrap_or(false);
    if exists {
        return Err(format!("An org named '{}' already exists", name));
    }

    let now = now_ms();
    let org = ProjectOrg {
        id: format!("{}-{}", DEFAULT_ORG_ID_PREFIX, slug),
        name: name.to_string(),
        slug: slug.clone(),
        org_key: org_key_from_slug(&slug),
        source: LOCAL_ORG_SOURCE.to_string(),
        sync_provider: NO_SYNC_PROVIDER.to_string(),
        sync_config_json: None,
        sync_connection_id: None,
        external_org_id: None,
        created_at: to_iso8601(now),
        updated_at: to_iso8601(now),
    };

    map_db(connection.execute(
        "INSERT INTO project_orgs (
            id, name, slug, org_key, source, sync_provider, sync_config_json,
            sync_connection_id, external_org_id, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            org.id,
            org.name,
            org.slug,
            org.org_key,
            org.source,
            org.sync_provider,
            org.sync_config_json,
            org.sync_connection_id,
            org.external_org_id,
            now,
            now,
        ],
    ))?;

    Ok(org)
}

#[derive(Debug, Serialize)]
struct GitFolderSyncConfig<'a> {
    folder_path: &'a str,
}

pub fn configure_project_org_git_folder_sync(
    request: &ConfigureProjectOrgGitFolderSyncRequest,
) -> Result<ProjectOrg, String> {
    let org_id = request.org_id.trim();
    if org_id.is_empty() {
        return Err("Org ID is required".to_string());
    }

    let folder_path = request.folder_path.trim();
    if folder_path.is_empty() {
        return Err("Git folder path is required".to_string());
    }

    let path = Path::new(folder_path);
    if !path.is_dir() {
        return Err(format!("Git folder does not exist: {}", folder_path));
    }

    let git_metadata_path = path.join(".git");
    if !git_metadata_path.is_dir() && !git_metadata_path.is_file() {
        return Err(format!("Folder is not a Git working tree: {}", folder_path));
    }

    let sync_config_json = serde_json::to_string(&GitFolderSyncConfig { folder_path })
        .map_err(|err| format!("Failed to encode Git folder sync config: {}", err))?;
    let now = now_ms();
    let connection = conn()?;
    let updated = map_db(connection.execute(
        "UPDATE project_orgs
            SET sync_provider = ?1,
                sync_config_json = ?2,
                sync_connection_id = NULL,
                external_org_id = NULL,
                updated_at = ?3
          WHERE id = ?4",
        params![GIT_FOLDER_SYNC_PROVIDER, sync_config_json, now, org_id],
    ))?;
    if updated == 0 {
        return Err(format!("org not found: {}", org_id));
    }

    read_project_org(org_id)
}

fn row_to_project_org(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectOrg> {
    let created_at_ms: i64 = row.get(9)?;
    let updated_at_ms: i64 = row.get(10)?;
    Ok(ProjectOrg {
        id: row.get(0)?,
        name: row.get(1)?,
        slug: row.get(2)?,
        org_key: row.get(3)?,
        source: row.get(4)?,
        sync_provider: row.get(5)?,
        sync_config_json: row.get(6)?,
        sync_connection_id: row.get(7)?,
        external_org_id: row.get(8)?,
        created_at: to_iso8601(created_at_ms),
        updated_at: to_iso8601(updated_at_ms),
    })
}

fn normalize_slug(value: &str) -> String {
    let mut slug = String::new();
    let mut last_was_separator = false;
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
            last_was_separator = false;
        } else if !last_was_separator && !slug.is_empty() {
            slug.push('-');
            last_was_separator = true;
        }
    }
    slug.trim_matches('-').to_string()
}

fn org_key_from_slug(slug: &str) -> String {
    let mut key = String::new();
    for character in slug.chars() {
        if character.is_ascii_alphanumeric() {
            key.push(character.to_ascii_uppercase());
            if key.len() == 8 {
                break;
            }
        }
    }
    if key.is_empty() {
        DEFAULT_ORG_KEY_PREFIX.to_string()
    } else {
        key
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use test_helpers::test_env;

    #[test]
    fn read_project_orgs_includes_default_personal_org() {
        let _sandbox = test_env::sandbox();
        let orgs = read_project_orgs().expect("read orgs");
        assert!(orgs.iter().any(|org| org.id == "personal-org"));
    }

    #[test]
    fn create_project_org_round_trips() {
        let _sandbox = test_env::sandbox();
        let org = create_project_org(&CreateProjectOrgRequest {
            name: "Platform Team".to_string(),
        })
        .expect("create org");

        assert_eq!(org.id, "org-platform-team");
        assert_eq!(org.source, LOCAL_ORG_SOURCE);

        let orgs = read_project_orgs().expect("read orgs");
        assert!(orgs.iter().any(|entry| entry.id == org.id));
    }

    #[test]
    fn configure_project_org_git_folder_sync_round_trips() {
        let sandbox = test_env::sandbox();
        let org = create_project_org(&CreateProjectOrgRequest {
            name: "Platform Team".to_string(),
        })
        .expect("create org");
        let repo_path = sandbox.path().join("repo");
        fs::create_dir_all(repo_path.join(".git")).expect("create git folder");

        let configured =
            configure_project_org_git_folder_sync(&ConfigureProjectOrgGitFolderSyncRequest {
                org_id: org.id.clone(),
                folder_path: repo_path.to_string_lossy().to_string(),
            })
            .expect("configure git folder sync");

        assert_eq!(configured.id, org.id);
        assert_eq!(configured.sync_provider, GIT_FOLDER_SYNC_PROVIDER);
        let config: serde_json::Value = serde_json::from_str(
            configured
                .sync_config_json
                .as_deref()
                .expect("sync config json"),
        )
        .expect("parse config");
        assert_eq!(config["folder_path"], repo_path.to_string_lossy().as_ref());
    }
}

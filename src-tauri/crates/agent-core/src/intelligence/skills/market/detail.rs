//! ClawHub skill detail endpoint (metadata + SKILL.md fetch in parallel).

use crate::utils::http_retry::send_with_retry;

use super::http::{build_http_client, CLAWHUB_BASE_URL, CLAWHUB_SKILLS_PATH};
use super::types::{HubSkillDetail, HubSkillOwner, HubSkillStats};

/// Fetch full skill detail from ClawHub including stats, owner, and SKILL.md.
///
/// Calls two endpoints in parallel:
/// - `GET /api/v1/skills/{slug}` for metadata
/// - `GET /api/v1/skills/{slug}/file?path=SKILL.md` for readme content
#[tauri::command]
pub async fn skills_hub_detail(slug: String) -> Result<HubSkillDetail, String> {
    if slug.trim().is_empty() {
        return Err("Skill slug is required".to_string());
    }

    let client = build_http_client()?;

    let detail_url = format!("{CLAWHUB_BASE_URL}{CLAWHUB_SKILLS_PATH}/{slug}");
    let file_url = format!("{CLAWHUB_BASE_URL}{CLAWHUB_SKILLS_PATH}/{slug}/file");

    let (detail_resp, file_resp) = tokio::join!(
        send_with_retry(
            &client,
            |c| c.get(&detail_url).header("Accept", "application/json"),
            "ClawHub skill detail",
        ),
        send_with_retry(
            &client,
            |c| {
                c.get(&file_url)
                    .query(&[("path", "SKILL.md")])
                    .header("Accept", "text/plain, text/markdown, */*")
            },
            "ClawHub SKILL.md fetch",
        ),
    );

    let detail_resp = detail_resp?;

    if !detail_resp.status().is_success() {
        return Err(format!(
            "ClawHub skill detail returned status {}",
            detail_resp.status()
        ));
    }

    let body: serde_json::Value = detail_resp
        .json()
        .await
        .map_err(|err| format!("Failed to parse skill detail: {err}"))?;

    let skill_obj = body.get("skill").and_then(|v| v.as_object());
    let latest_version_obj = body.get("latestVersion").and_then(|v| v.as_object());
    let owner_obj = body.get("owner").and_then(|v| v.as_object());

    let detail_slug = skill_obj
        .and_then(|s| s.get("slug"))
        .and_then(|v| v.as_str())
        .unwrap_or(&slug)
        .to_string();

    let name = skill_obj
        .and_then(|s| s.get("displayName"))
        .and_then(|v| v.as_str())
        .unwrap_or(&slug)
        .to_string();

    let description = skill_obj
        .and_then(|s| s.get("summary"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let version = latest_version_obj
        .and_then(|v| v.get("version"))
        .and_then(|v| v.as_str())
        .or_else(|| {
            skill_obj
                .and_then(|s| s.get("tags"))
                .and_then(|t| t.get("latest"))
                .and_then(|v| v.as_str())
        })
        .unwrap_or("")
        .to_string();

    let stats = skill_obj
        .and_then(|s| s.get("stats"))
        .and_then(|v| serde_json::from_value::<HubSkillStats>(v.clone()).ok());

    let owner = owner_obj.map(|owner| HubSkillOwner {
        handle: owner
            .get("handle")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        display_name: owner
            .get("displayName")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        image: owner
            .get("image")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    });

    let created_at = skill_obj
        .and_then(|s| s.get("createdAt"))
        .and_then(|v| v.as_u64());

    let updated_at = skill_obj
        .and_then(|s| s.get("updatedAt"))
        .and_then(|v| v.as_u64());

    let changelog = latest_version_obj
        .and_then(|v| v.get("changelog"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let skill_md = match file_resp {
        Ok(resp) if resp.status().is_success() => match resp.text().await {
            Ok(text) => {
                let trimmed_empty = text.trim().is_empty();
                if trimmed_empty {
                    tracing::warn!(
                        "[skills_market] SKILL.md fetch returned empty body for slug={}",
                        detail_slug
                    );
                    None
                } else {
                    Some(text)
                }
            }
            Err(err) => {
                tracing::warn!(
                    "[skills_market] SKILL.md body read failed for slug={}: {}",
                    detail_slug,
                    err
                );
                None
            }
        },
        Ok(resp) => {
            tracing::warn!(
                "[skills_market] SKILL.md fetch returned HTTP {} for slug={}",
                resp.status(),
                detail_slug
            );
            None
        }
        Err(err) => {
            tracing::warn!(
                "[skills_market] SKILL.md fetch transport error for slug={}: {}",
                detail_slug,
                err
            );
            None
        }
    };

    Ok(HubSkillDetail {
        slug: detail_slug,
        name,
        description,
        version,
        stats,
        owner,
        created_at,
        updated_at,
        changelog,
        skill_md,
    })
}

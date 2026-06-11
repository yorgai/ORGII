use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use reqwest::Client;
use zip::ZipArchive;

use crate::utils::http_retry::send_with_retry;

const AI_RESEARCH_SKILLS_URL: &str =
    "https://github.com/Orchestra-Research/AI-Research-SKILLs/archive/refs/heads/main.zip";
const AI_RESEARCH_ROOT_PREFIX: &str = "AI-Research-SKILLs-main/";

pub fn ai_research_skills_dir() -> PathBuf {
    app_paths::orgii_root()
        .join("prebuilt-skill-sources")
        .join("ai-research")
}

pub fn source_dir_path(source_dir: &str) -> PathBuf {
    match source_dir {
        "builtin://ai-research-skills" => ai_research_skills_dir(),
        other => PathBuf::from(other),
    }
}

pub async fn ensure_source_dirs(source_dirs: &[String]) -> Result<(), String> {
    if source_dirs
        .iter()
        .any(|source| source == "builtin://ai-research-skills")
    {
        ensure_ai_research_skills().await?;
    }
    Ok(())
}

async fn ensure_ai_research_skills() -> Result<(), String> {
    let destination = ai_research_skills_dir();
    if destination
        .join("0-autoresearch-skill")
        .join("SKILL.md")
        .exists()
    {
        return Ok(());
    }

    let client = Client::builder()
        .user_agent("orgii-ai-research-skills/1.0")
        .build()
        .map_err(|err| format!("Failed to build HTTP client: {err}"))?;
    let response = send_with_retry(
        &client,
        |http_client| http_client.get(AI_RESEARCH_SKILLS_URL),
        "AI Researcher skills download",
    )
    .await?;

    if !response.status().is_success() {
        return Err(format!(
            "AI Researcher skills download returned HTTP {}",
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("Failed to read AI Researcher skills archive: {err}"))?;

    let staging = destination.with_extension("download");
    if staging.exists() {
        fs::remove_dir_all(&staging)
            .map_err(|err| format!("Failed to clear AI Researcher staging directory: {err}"))?;
    }
    fs::create_dir_all(&staging)
        .map_err(|err| format!("Failed to create AI Researcher staging directory: {err}"))?;

    unpack_ai_research_archive(&bytes, &staging)?;

    if destination.exists() {
        fs::remove_dir_all(&destination)
            .map_err(|err| format!("Failed to replace AI Researcher skills directory: {err}"))?;
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create AI Researcher skills parent: {err}"))?;
    }
    fs::rename(&staging, &destination)
        .map_err(|err| format!("Failed to publish AI Researcher skills: {err}"))?;

    Ok(())
}

fn unpack_ai_research_archive(bytes: &[u8], destination: &Path) -> Result<(), String> {
    let reader = Cursor::new(bytes);
    let mut archive = ZipArchive::new(reader)
        .map_err(|err| format!("Failed to open AI Researcher skills archive: {err}"))?;

    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|err| format!("Failed to read AI Researcher archive entry: {err}"))?;
        let name = file.name().to_string();
        let Some(relative_name) = name.strip_prefix(AI_RESEARCH_ROOT_PREFIX) else {
            continue;
        };
        if relative_name.is_empty() {
            continue;
        }
        let Some(safe_path) = file.enclosed_name().and_then(|path| {
            path.strip_prefix(AI_RESEARCH_ROOT_PREFIX)
                .ok()
                .map(Path::to_path_buf)
        }) else {
            continue;
        };
        let out_path = destination.join(safe_path);
        if file.is_dir() {
            fs::create_dir_all(&out_path)
                .map_err(|err| format!("Failed to create AI Researcher skill directory: {err}"))?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("Failed to create AI Researcher skill parent: {err}"))?;
        }
        let mut out_file = fs::File::create(&out_path)
            .map_err(|err| format!("Failed to write AI Researcher skill file: {err}"))?;
        std::io::copy(&mut file, &mut out_file)
            .map_err(|err| format!("Failed to copy AI Researcher skill file: {err}"))?;
    }

    Ok(())
}

#[cfg(test)]
#[path = "source_dirs_tests.rs"]
mod tests;

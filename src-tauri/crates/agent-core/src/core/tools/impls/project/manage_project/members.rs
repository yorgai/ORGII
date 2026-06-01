//! Team-member action handlers (`list_members`, `list_contributors`).
//!
//! Members live in the global project store and are scoped to a project
//! id. `list_contributors` runs `git shortlog` against every repo listed
//! in the project's `linked_repos`, merges the result with existing
//! rows, and returns the updated roster.

use crate::tools::traits::ToolError;
use project_management::projects::io as projects_io;
use project_management::projects::types::MemberEntry;

pub(super) fn list_members(slug: &str) -> Result<String, ToolError> {
    let members_file = projects_io::read_members(slug).map_err(ToolError::ExecutionFailed)?;
    if members_file.members.is_empty() {
        return Ok(format!(
            "No team members found for project `{}`. Use `list_contributors` to discover contributors from the project's linked git repositories.",
            slug
        ));
    }
    let mut output = format!(
        "Team members for `{}` ({}):\n\n",
        slug,
        members_file.members.len()
    );
    for member in &members_file.members {
        append_member_line(&mut output, member);
    }
    Ok(output)
}

pub(super) fn list_contributors(slug: &str) -> Result<String, ToolError> {
    let sync_result =
        projects_io::sync_members_from_git(slug).map_err(ToolError::ExecutionFailed)?;
    let members_file = projects_io::read_members(slug).map_err(ToolError::ExecutionFailed)?;
    let mut output = format!(
        "Synced git contributors for `{}`: {} added, {} updated.\nTeam members ({}):\n\n",
        slug,
        sync_result.added,
        sync_result.updated,
        members_file.members.len()
    );
    for member in &members_file.members {
        append_member_line(&mut output, member);
    }
    Ok(output)
}

fn append_member_line(output: &mut String, member: &MemberEntry) {
    let status = if member.active { "" } else { " [inactive]" };
    output.push_str(&format!("- {} (`{}`)", member.name, member.id));
    if let Some(ref email) = member.email {
        output.push_str(&format!(" <{}>", email));
    }
    if let Some(ref gh) = member.github_username {
        output.push_str(&format!(" @{}", gh));
    }
    if let Some(ref date) = member.last_commit_date {
        output.push_str(&format!(" (last commit: {})", date));
    }
    output.push_str(status);
    output.push('\n');
}

//! HTTP Server with OpenAPI Documentation
//!
//! Axum server with Swagger UI at /swagger-ui

use axum::Router;
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use super::routes::create_routes;
use super::types::*;

// ============================================
// OpenAPI Documentation
// ============================================

#[derive(OpenApi)]
#[openapi(
    paths(
        // Status
        crate::routes::status::get_status,
        crate::routes::status::get_ahead_behind,
        crate::routes::status::get_default_branch,
        crate::routes::status::get_local_commits,
        // Branches
        crate::routes::branches::get_branches,
        crate::routes::branches::get_current_branch_name,
        crate::routes::branches::create_branch,
        crate::routes::branches::delete_branch,
        crate::routes::branches::rename_branch,
        crate::routes::branches::checkout,
        // Commits
        crate::routes::commits::get_commits,
        crate::routes::commits::commit,
        crate::routes::commits::amend_commit,
        // Remotes
        crate::routes::remotes::get_remotes,
        crate::routes::remotes::add_remote,
        crate::routes::remotes::update_remote,
        crate::routes::remotes::delete_remote,
        crate::routes::remotes::push,
        crate::routes::remotes::pull,
        crate::routes::remotes::fetch,
        // Staging
        crate::routes::staging::stage_files,
        crate::routes::staging::unstage_files,
        crate::routes::staging::discard_changes,
        // Stash
        crate::routes::stash::stash_list,
        crate::routes::stash::stash_push,
        crate::routes::stash::stash_apply,
        crate::routes::stash::stash_drop,
        // Files & Diff
        crate::routes::diff::get_file_content,
        crate::routes::diff::get_file_diff,
        crate::routes::diff::get_batch_file_diffs,
        crate::routes::diff::get_staged_diff,
        crate::routes::diff::get_diff_summary,
        crate::routes::diff::get_commit_diff,
        crate::routes::diff::get_blame,
        // Merge
        crate::routes::merge::merge,
        crate::routes::merge::merge_abort,
        crate::routes::merge::merge_continue,
        // Rebase
        crate::routes::merge::rebase,
        crate::routes::merge::rebase_abort,
        crate::routes::merge::rebase_continue,
        // Cherry-pick
        crate::routes::merge::cherry_pick,
        crate::routes::merge::cherry_pick_abort,
        crate::routes::merge::cherry_pick_continue,
        // Revert
        crate::routes::merge::revert,
        crate::routes::merge::revert_abort,
        // Reset
        crate::routes::merge::reset,
    ),
    components(
        schemas(
            // Status types
            GitStatus,
            GitStatusResponse,
            AheadBehind,
            AheadBehindResponse,
            WorkingDirectory,
            WorkingDirectoryFile,
            // Branch types
            GitBranchInfo,
            GitBranchesData,
            BranchesResponse,
            CurrentBranchResponse,
            GitCurrentBranchName,
            CurrentBranchNameResponse,
            CreateBranchRequest,
            CheckoutRequest,
            // Commit types
            GitCommitInfo,
            GitCommitAuthor,
            GitCommitsData,
            CommitsResponse,
            CommitRequest,
            CommitInfoResponse,
            AmendCommitRequest,
            // Remote types
            GitRemoteInfo,
            GitRemotesData,
            RemotesResponse,
            RemoteInfoResponse,
            AddRemoteRequest,
            UpdateRemoteRequest,
            GitFetchResult,
            FetchRequest,
            GitPushResult,
            PushRequest,
            GitPullResult,
            PullRequest,
            // Staging types
            StageFilesRequest,
            DiscardChangesRequest,
            // Stash types
            StashEntry,
            GitStashListData,
            StashListResponse,
            GitStashResult,
            StashResultResponse,
            StashPushRequest,
            StashApplyRequest,
            // File types
            GitFileContentResult,
            FileContentResponse,
            // Diff types
            DiffLine,
            GitDiffHunk,
            GitDiffStats,
            FileDiffResult,
            FileDiffResponse,
            BatchFileDiffResult,
            BatchFileDiffResponse,
            BatchFileDiffRequest,
            CommitDiffResult,
            CommitDiffResponse,
            // Blame types
            GitBlameLineInfo,
            GitBlameResult,
            BlameResponse,
            // Merge types
            MergeRequest,
            GitMergeResult,
            MergeResultResponse,
            // Rebase types
            RebaseRequest,
            GitRebaseResult,
            RebaseResultResponse,
            // Cherry-pick types
            CherryPickRequest,
            GitCherryPickResult,
            CherryPickResultResponse,
            // Revert types
            RevertRequest,
            GitRevertResult,
            RevertResultResponse,
            // Reset types
            ResetRequest,
            GitResetResult,
            ResetResultResponse,
            // Error type
            ApiError,
        )
    ),
    tags(
        (name = "status", description = "Git status operations"),
        (name = "branches", description = "Branch operations"),
        (name = "commits", description = "Commit operations"),
        (name = "remotes", description = "Remote operations"),
        (name = "staging", description = "Staging operations"),
        (name = "stash", description = "Stash operations"),
        (name = "files", description = "File content operations"),
        (name = "diff", description = "Diff operations"),
        (name = "blame", description = "Git blame operations"),
        (name = "merge", description = "Merge operations"),
        (name = "rebase", description = "Rebase operations"),
        (name = "cherry-pick", description = "Cherry-pick operations"),
        (name = "revert", description = "Revert operations"),
        (name = "reset", description = "Reset operations"),
    ),
    info(
        title = "Orgii Git API",
        version = "1.0.0",
        description = "REST API for Git operations with real-time updates. All endpoints require a repo_id parameter which can be the repository name or UUID.",
    )
)]
struct ApiDoc;

// ============================================
// Server
// ============================================

pub async fn start_server() -> Result<(), Box<dyn std::error::Error>> {
    let addr = SocketAddr::from(([127, 0, 0, 1], 3847));

    // Create CORS layer (allow frontend on any localhost port)
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Create app with routes and Swagger UI
    let app = Router::new()
        .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", ApiDoc::openapi()))
        .merge(create_routes())
        .layer(cors);

    println!("🚀 Git API server starting on http://{}", addr);
    println!("📚 Swagger UI available at http://{}/swagger-ui", addr);

    // Start server
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

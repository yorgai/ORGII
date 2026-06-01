/**
 * Git Contexts
 *
 * Contexts for git operations and status tracking.
 */

// Single-repo git status (with deferred loading support)
export * from "./GitStatusContext";

// Multi-repo git status (singleton provider for repo lists)
export * from "./MultiRepoGitStatusContext";

/**
 * GitHub REST integration wire types (connections, repos, branches, PRs).
 *
 * Kept separate from archived commercial HTTP modules so Integrations and
 * clone flows only depend on this module and Tauri-local GitHub helpers.
 */

// ============================================
// GitHub Integration Types
// ============================================

export interface GitHubConnection {
  id: string;
  github_id: number;
  account: string;
  account_type: string;
  is_organization: boolean;
  access: string;
  repos_count: number;
  is_active: boolean;
  connected_at: string;
}

export interface GitHubRepo {
  id: string;
  full_name: string;
  name: string;
  owner: string;
  default_branch: string;
  is_private: boolean;
  description: string | null;
  language: string | null;
}

export interface GitHubBranch {
  name: string;
  sha: string;
  protected: boolean;
  is_default: boolean;
}

export interface CreatePullRequestRequest {
  connection_id: string;
  repo_full_name: string;
  title: string;
  body: string;
  head_branch: string;
  base_branch: string;
  draft?: boolean;
}

export interface PullRequestResponse {
  number: number;
  url: string;
  html_url: string;
  state: string;
  title: string;
  head_branch: string;
  base_branch: string;
  created_at: string;
}

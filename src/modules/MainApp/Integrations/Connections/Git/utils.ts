import type { GitHubConnection } from "@src/api/http/github/types";

/**
 * Build the GitHub App installation settings URL for a connection.
 * Orgs use /organizations/{account}/settings/installations/{id},
 * personal accounts use /settings/installations/{id}.
 */
export function getGitHubManageUrl(connection: GitHubConnection): string {
  const installationId = connection.github_id;
  if (connection.is_organization) {
    return `https://github.com/organizations/${connection.account}/settings/installations/${installationId}`;
  }
  return `https://github.com/settings/installations/${installationId}`;
}

export const SERVICE_TYPES = [
  { type: "smithery", labelKey: "services.smithery" },
] as const;

export const STORY_SYNC_ADAPTER_TYPES = [
  { type: "linear", labelKey: "projectConnections.linear" },
  { type: "github_issues", labelKey: "projectConnections.githubIssues" },
] as const;

// Git-credential providers (host the user's repo-clone / PR auth).
// First entry is GitHub; GitLab and Bitbucket will follow.
export const GIT_ADAPTER_TYPES = [
  { type: "github", labelKey: "gitConnections.github" },
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number]["type"];
export type ProjectSyncAdapterType =
  (typeof STORY_SYNC_ADAPTER_TYPES)[number]["type"];
export type GitAdapterType = (typeof GIT_ADAPTER_TYPES)[number]["type"];

// Auth methods used by both project-sync adapters (Linear / GitHub Issues)
// and the new Git-credential adapters (GitHub). SCAN discovers an existing
// credential on the host machine; SSH registers a discovered ~/.ssh keypair
// rather than storing a token. Currently SCAN/SSH are only consumed by the
// Git category; the project-sync category still uses PAT + OAUTH only.
export const STORY_SYNC_AUTH_METHODS = {
  PAT: "pat",
  OAUTH: "oauth",
  SCAN: "scan",
  SSH: "ssh",
} as const;

export type ProjectSyncAuthMethod =
  (typeof STORY_SYNC_AUTH_METHODS)[keyof typeof STORY_SYNC_AUTH_METHODS];

export type WizardCategory = "git" | "channels" | "services" | "projects";

export const SERVICE_CONFIG: Record<
  ServiceType,
  { labelKey: string; placeholderKey: string; descriptionKey: string }
> = {
  smithery: {
    labelKey: "services.smitheryApiKey",
    placeholderKey: "services.smitheryApiKeyPlaceholder",
    descriptionKey: "services.smitheryApiKeyDesc",
  },
};

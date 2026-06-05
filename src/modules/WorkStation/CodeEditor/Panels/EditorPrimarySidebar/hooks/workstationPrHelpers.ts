const WORKSTATION_PR_STORAGE_PREFIX = "orgii.workstation.pr";

export interface WorkstationPrRecord {
  url: string;
  status?: string;
  updatedAt: number;
}

export interface WorkstationPrEligibilityInput {
  branch?: string;
  defaultBranch: string;
  hasUpstream: boolean;
  uncommittedCount: number;
}

export function buildWorkstationPrStorageKey(
  repoPath: string,
  branch: string
): string {
  return `${WORKSTATION_PR_STORAGE_PREFIX}:${repoPath}:${branch}`;
}

export function getStoredWorkstationPr(
  repoPath: string,
  branch: string
): WorkstationPrRecord | null {
  if (!repoPath || !branch) return null;
  try {
    const raw = localStorage.getItem(
      buildWorkstationPrStorageKey(repoPath, branch)
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkstationPrRecord;
    if (!parsed?.url) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setStoredWorkstationPr(
  repoPath: string,
  branch: string,
  record: Pick<WorkstationPrRecord, "url" | "status">
): void {
  if (!repoPath || !branch || !record.url) return;
  const payload: WorkstationPrRecord = {
    url: record.url,
    status: record.status,
    updatedAt: Date.now(),
  };
  localStorage.setItem(
    buildWorkstationPrStorageKey(repoPath, branch),
    JSON.stringify(payload)
  );
}

export function isWorkstationPrEligible(
  input: WorkstationPrEligibilityInput
): boolean {
  const { branch, defaultBranch, hasUpstream, uncommittedCount } = input;
  if (!branch || !hasUpstream) return false;
  if (branch === defaultBranch) return false;
  if (uncommittedCount > 0) return false;
  return true;
}

export function shouldAutoCreateWorkstationPr(options: {
  autoCreatePr: boolean;
  eligible: boolean;
  prUrl?: string;
  isCreating: boolean;
}): boolean {
  const { autoCreatePr, eligible, prUrl, isCreating } = options;
  return autoCreatePr && eligible && !prUrl && !isCreating;
}

export function formatWorkstationPrTitle(
  branch: string,
  commitMessage?: string
): string {
  const trimmedCommit = commitMessage?.trim();
  if (trimmedCommit) {
    const firstLine = trimmedCommit.split("\n")[0]?.trim();
    if (firstLine) return firstLine;
  }
  return branch;
}

export function normalizePullRequestStatus(
  state?: string | null
): string | undefined {
  if (!state) return undefined;
  const normalized = state.toLowerCase();
  if (
    normalized === "open" ||
    normalized === "merged" ||
    normalized === "closed" ||
    normalized === "draft"
  ) {
    return normalized;
  }
  return state;
}

import type {
  ExtractedGitArtifactData,
  SessionEvent,
} from "@src/engines/SessionCore/core/types";

const GITHUB_PULL_REQUEST_URL_PATTERN =
  /https?:\/\/github\.com\/([^\s/]+)\/([^\s/]+)\/pull\/(\d+)(?:[^\s<>"'`)\]}]*)?/gi;
const GITHUB_COMMIT_URL_PATTERN =
  /https?:\/\/github\.com\/([^\s/]+)\/([^\s/]+)\/commit\/([0-9a-f]{7,40})(?:[^\s<>"'`)\]}]*)?/gi;
const ASSISTANT_COMMIT_LINE_PATTERN =
  /^\s*(?:[-*•]\s*)?`?([0-9a-f]{7,40})`?\s+([a-z][a-z0-9-]*(?:\([^)]+\))?!?:\s+[^\n]+)$/gim;
const ASSISTANT_SHA_DASH_SUBJECT_PATTERN =
  /^\s*(?:[-*•]\s*)?(?:[A-Za-z][A-Za-z\s-]{0,32}:\s*)?`?([0-9a-f]{7,40})`?\s*(?:—|–|-)\s*([a-z][a-z0-9-]*(?:\([^)]+\))?!?:\s+[^\n]+)$/gim;
const ASSISTANT_CONTEXTUAL_COMMIT_SHA_PATTERN =
  /\b(?:commit(?:ted|s)?|commit\s+(?:created|sha|tip)|branch\s+tip|synced\s+at)\b[^\n]{0,120}?`?([0-9a-f]{7,40})`?/gi;
const BARE_GIT_SHA_PATTERN = /(?<![#0-9a-f-])([0-9a-f]{7,40})(?![0-9a-f-])/gi;
const ASSISTANT_COMMIT_SUBJECT_LINE_PATTERN =
  /^\s*(?:[-*•]\s*)?`?([a-z][a-z0-9-]*(?:\([^)]+\))?!?:\s+[^`\n]+?)`?\s*$/i;

function shortSha(sha: string): string {
  return sha.length <= 12 ? sha : sha.slice(0, 7);
}

function findNearestCommitSubjectBefore(
  text: string,
  index: number
): string | undefined {
  const before = text.slice(0, index).split("\n").slice(-6).reverse();
  for (const line of before) {
    const match = ASSISTANT_COMMIT_SUBJECT_LINE_PATTERN.exec(line.trim());
    ASSISTANT_COMMIT_SUBJECT_LINE_PATTERN.lastIndex = 0;
    const subject = match?.[1]?.trim();
    if (subject) return subject;
  }
  return undefined;
}

export function getGitArtifactDedupeKey(
  artifact: ExtractedGitArtifactData
): string | null {
  if (artifact.url) return `${artifact.kind}:url:${artifact.url}`;
  if (artifact.kind === "commit" && artifact.sha) {
    return `commit:sha:${artifact.sha.toLowerCase()}`;
  }
  if (
    artifact.kind === "pullRequest" &&
    artifact.repoFullName &&
    artifact.prNumber
  ) {
    return `pullRequest:${artifact.repoFullName}#${artifact.prNumber}`;
  }
  return null;
}

export function parseGitArtifactsFromText(
  text: string | undefined
): ExtractedGitArtifactData[] {
  if (!text) return [];

  const artifacts: ExtractedGitArtifactData[] = [];
  const seenKeys = new Set<string>();
  const pushArtifact = (artifact: ExtractedGitArtifactData) => {
    const key = getGitArtifactDedupeKey(artifact);
    if (!key || seenKeys.has(key)) return;
    seenKeys.add(key);
    artifacts.push(artifact);
  };

  for (const match of text.matchAll(GITHUB_PULL_REQUEST_URL_PATTERN)) {
    const owner = match[1];
    const repo = match[2];
    const prNumber = Number(match[3]);
    if (!owner || !repo || !Number.isFinite(prNumber)) continue;
    const repoFullName = `${owner}/${repo}`;
    pushArtifact({
      kind: "pullRequest",
      url: `https://github.com/${repoFullName}/pull/${prNumber}`,
      repoFullName,
      prNumber,
    });
  }

  for (const match of text.matchAll(GITHUB_COMMIT_URL_PATTERN)) {
    const owner = match[1];
    const repo = match[2];
    const sha = match[3]?.toLowerCase();
    if (!owner || !repo || !sha) continue;
    const repoFullName = `${owner}/${repo}`;
    pushArtifact({
      kind: "commit",
      url: `https://github.com/${repoFullName}/commit/${sha}`,
      repoFullName,
      sha,
      shortSha: shortSha(sha),
    });
  }

  for (const match of text.matchAll(ASSISTANT_SHA_DASH_SUBJECT_PATTERN)) {
    const sha = match[1]?.toLowerCase();
    const subject = match[2]?.trim();
    if (!sha || !subject) continue;
    pushArtifact({
      kind: "commit",
      sha,
      shortSha: shortSha(sha),
      subject,
    });
  }

  for (const match of text.matchAll(ASSISTANT_COMMIT_LINE_PATTERN)) {
    const sha = match[1]?.toLowerCase();
    const subject = match[2]?.trim();
    if (!sha || !subject) continue;
    pushArtifact({
      kind: "commit",
      sha,
      shortSha: shortSha(sha),
      subject,
    });
  }

  for (const match of text.matchAll(ASSISTANT_CONTEXTUAL_COMMIT_SHA_PATTERN)) {
    const sha = match[1]?.toLowerCase();
    if (!sha) continue;
    pushArtifact({
      kind: "commit",
      sha,
      shortSha: shortSha(sha),
      subject: findNearestCommitSubjectBefore(text, match.index ?? 0),
    });
  }

  for (const match of text.matchAll(BARE_GIT_SHA_PATTERN)) {
    const sha = match[1]?.toLowerCase();
    if (!sha) continue;
    pushArtifact({
      kind: "commit",
      sha,
      shortSha: shortSha(sha),
    });
  }

  return artifacts;
}

export function getGitArtifactsFromEvent(
  event: SessionEvent
): ExtractedGitArtifactData[] {
  if (event.extracted?.kind === "shell") {
    if (event.displayStatus === "running" || event.displayStatus === "failed") {
      return [];
    }
    if (event.extracted.isFailure) return [];
    return event.extracted.gitArtifacts ?? [];
  }

  if (event.extracted?.kind === "message" && !event.extracted.isUser) {
    return parseGitArtifactsFromText(
      event.extracted.content ?? event.displayText
    );
  }

  if (event.source === "assistant" && event.displayText) {
    return parseGitArtifactsFromText(event.displayText);
  }

  return [];
}

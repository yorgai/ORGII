/**
 * submissionsArtifacts
 *
 * Pure helpers that turn a session event stream into a flat list of
 * `SubmissionArtifact` records (commits + PRs), each tagged with a repo
 * context and an origin (`created` vs `mentioned`).
 *
 * Extracted from `SessionReplay/index.tsx` so the new `useSubmissionsData`
 * hook can consume them without dragging the whole host component along.
 *
 * Non-canonical UI extraction. Final AI Blame commit attribution still
 * comes from Rust Orgtrack summaries; the artifacts surfaced here only
 * power clickable replay references in the Submissions sidebar.
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { getGitArtifactsFromEvent } from "@src/shared/git/sessionGitArtifacts";

import type {
  SubmissionArtifact,
  SubmissionArtifactOrigin,
} from "./SubmissionsContent";

export interface SubmissionRepoContext {
  repoId?: string;
  repoPath?: string;
}

function hasRepoContext(context: SubmissionRepoContext | null): boolean {
  return Boolean(context?.repoId || context?.repoPath);
}

function inferSubmissionArtifactOrigin(
  event: SessionEvent,
  artifactKind: SubmissionArtifact["kind"]
): SubmissionArtifactOrigin {
  if (event.extracted?.kind !== "shell") return "mentioned";
  const command = event.extracted.command.toLowerCase();
  if (
    artifactKind === "commit" &&
    /(^|[;&|()\s])git\s+commit\b/.test(command)
  ) {
    return "created";
  }
  if (
    artifactKind === "pullRequest" &&
    /(^|[;&|()\s])gh\s+pr\s+create\b/.test(command)
  ) {
    return "created";
  }
  return "mentioned";
}

export function collectSubmissionArtifacts(
  events: readonly SessionEvent[],
  fallbackRepoContext: SubmissionRepoContext
): SubmissionArtifact[] {
  const artifacts: SubmissionArtifact[] = [];
  const lockedRepoContext = hasRepoContext(fallbackRepoContext)
    ? fallbackRepoContext
    : null;
  let nearestRepoContext: SubmissionRepoContext | null = lockedRepoContext;

  for (const event of events) {
    if (!lockedRepoContext && (event.repoId || event.repoPath)) {
      nearestRepoContext = {
        repoId: event.repoId ?? event.repoPath,
        repoPath: event.repoPath,
      };
    }

    const artifactRepoContext = lockedRepoContext ?? nearestRepoContext;
    artifacts.push(
      ...getGitArtifactsFromEvent(event).map((artifact) => ({
        ...artifact,
        repoId: artifactRepoContext?.repoId,
        repoPath: artifactRepoContext?.repoPath,
        origin: inferSubmissionArtifactOrigin(event, artifact.kind),
        eventId: event.id,
      }))
    );
  }
  return artifacts;
}

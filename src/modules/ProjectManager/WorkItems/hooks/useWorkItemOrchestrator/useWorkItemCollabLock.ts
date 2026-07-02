/**
 * Collab execution-lock awareness for the work item orchestrator
 * (design §16.6 / §16.9).
 *
 * A shared work item is a native local row under a collab-aliased project org
 * (design §16.2). This hook resolves whether the CURRENT work item belongs to
 * such an org and, if so, who holds the server-arbitrated execution lock so
 * the "start agent" affordance can disable instead of double-starting.
 *
 * The lock itself is arbitrated by the server RPCs (see collabWorkItemLock.ts);
 * the holder (`executionLock.lockedByMemberId`) syncs down inside the work-item
 * payload, so read paths stay purely local.
 */
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";

import { projectApi } from "@src/api/http/project";
import type { WorkItemExecutionLock } from "@src/api/http/project";
import { resolveLockHolder } from "@src/engines/ChatPanel/panels/CollabOrgPanelView/collabWorkItemLinks";
import {
  acquireCollabWorkItemLock,
  releaseCollabWorkItemLock,
} from "@src/features/TeamCollaboration/collabWorkItemLock";
import { createLogger } from "@src/hooks/logger";
import {
  collabMembersAtom,
  collabOrgsAtom,
} from "@src/store/collaboration/collabOrgsAtom";

const logger = createLogger("useWorkItemCollabLock");

/**
 * Raised by `acquireLock` when the work item's collab membership could not
 * be resolved (readProject failed both in the resolve effect and in the
 * acquire-time retry). The caller must NOT start an agent on it: proceeding
 * would run WITHOUT server arbitration on a work item that may well be
 * collab-synced, silently double-starting against a teammate.
 */
export class CollabMembershipUnresolvedError extends Error {
  constructor(projectSlug: string) {
    super(`collab membership unresolved for project ${projectSlug}`);
    this.name = "CollabMembershipUnresolvedError";
  }
}

export function isCollabMembershipUnresolvedError(
  error: unknown
): error is CollabMembershipUnresolvedError {
  return error instanceof CollabMembershipUnresolvedError;
}

/**
 * Result of resolving the work item's owning project org. "unresolved" is a
 * first-class state (readProject pending or failed): it must never be
 * conflated with "resolved: not collab", or a transient read failure lets an
 * agent start without server arbitration.
 */
type CollabOrgResolution =
  | { status: "unresolved" }
  | { status: "resolved"; projectOrgId: string | null };

const UNRESOLVED: CollabOrgResolution = { status: "unresolved" };

export interface UseWorkItemCollabLockOptions {
  projectSlug?: string | null;
  shortId?: string | null;
  /** Global work item id (== `orgii_work_items.id`), used as the lock key. */
  workItemId?: string | null;
  executionLock?: WorkItemExecutionLock | null;
}

export interface WorkItemCollabLock {
  /** True when the lock is held by a different collab member than us. */
  isLockedByOther: boolean;
  /** Display name of the other holder (falls back to the raw id). */
  lockHolderName: string | null;
  /** Whether the work item is under a collab-synced org at all. */
  isCollabWorkItem: boolean;
  /**
   * Acquire the server lock before starting. Resolves `false` for non-collab
   * work items (proceed locally). Rejects with `ORGII_CONFLICT` when a
   * teammate holds the lock, and with `CollabMembershipUnresolvedError` when
   * collab membership cannot be resolved (the caller must block the start —
   * see the error's doc).
   */
  acquireLock: () => Promise<boolean>;
  /** Release the server lock when the session terminates (best-effort). */
  releaseLock: () => Promise<void>;
}

export function useWorkItemCollabLock(
  options: UseWorkItemCollabLockOptions
): WorkItemCollabLock {
  const { projectSlug, shortId, workItemId, executionLock } = options;
  const orgs = useAtomValue(collabOrgsAtom);
  const members = useAtomValue(collabMembersAtom);
  const [resolution, setResolution] = useState<CollabOrgResolution>(UNRESOLVED);

  // Resolve the project's org id once per project so we can decide whether
  // this work item is collab-synced. Only sets state after the await /
  // through a microtask, so the effect never mutates state synchronously
  // (react-hooks/set-state-in-effect). A readProject FAILURE keeps the
  // "unresolved" state — it must not degrade to "resolved: not collab", or
  // acquireLock would skip server arbitration on a transient error;
  // acquireLock retries the read instead.
  useEffect(() => {
    let cancelled = false;
    if (!projectSlug) {
      // No project ⇒ standalone work item ⇒ provably not collab-synced.
      queueMicrotask(() => {
        if (!cancelled) {
          setResolution({ status: "resolved", projectOrgId: null });
        }
      });
      return () => {
        cancelled = true;
      };
    }
    queueMicrotask(() => {
      if (!cancelled) setResolution(UNRESOLVED);
    });
    void (async () => {
      try {
        const project = await projectApi.readProject(projectSlug);
        if (!cancelled) {
          setResolution({
            status: "resolved",
            projectOrgId: project.meta.org_id,
          });
        }
      } catch (error) {
        logger.warn("failed to resolve project org for collab lock", error);
        // Stay unresolved: acquireLock retries and blocks when it cannot
        // prove the work item is not collab-synced.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectSlug]);

  const projectOrgId =
    resolution.status === "resolved" ? resolution.projectOrgId : null;

  const collabOrg = useMemo(
    () =>
      projectOrgId
        ? orgs.find((org) => (org.projectOrgId ?? org.id) === projectOrgId)
        : undefined,
    [orgs, projectOrgId]
  );

  const orgMembers = useMemo(
    () => members.filter((member) => member.orgId === collabOrg?.id),
    [members, collabOrg?.id]
  );

  const holder = useMemo(
    () =>
      resolveLockHolder(
        executionLock?.lockedByMemberId,
        collabOrg?.localMemberId,
        orgMembers
      ),
    [executionLock?.lockedByMemberId, collabOrg?.localMemberId, orgMembers]
  );

  const acquireLock = useMemo(
    () => async (): Promise<boolean> => {
      if (!projectSlug || !workItemId) return false;
      let effectiveProjectOrgId: string | null;
      if (resolution.status === "resolved") {
        effectiveProjectOrgId = resolution.projectOrgId;
      } else {
        // The resolve effect failed (or has not finished): retry inline. If
        // the project org STILL cannot be read we must block the start —
        // only a provably-not-collab work item may run without arbitration.
        try {
          const project = await projectApi.readProject(projectSlug);
          effectiveProjectOrgId = project.meta.org_id;
          setResolution({
            status: "resolved",
            projectOrgId: project.meta.org_id,
          });
        } catch (error) {
          logger.warn(
            "collab membership still unresolved at acquire time",
            error
          );
          throw new CollabMembershipUnresolvedError(projectSlug);
        }
      }
      const resolvedOrg = effectiveProjectOrgId
        ? orgs.find(
            (org) => (org.projectOrgId ?? org.id) === effectiveProjectOrgId
          )
        : undefined;
      if (!resolvedOrg) return false;
      return acquireCollabWorkItemLock(projectSlug, workItemId, {
        activeShortId: shortId ?? undefined,
      });
    },
    [orgs, projectSlug, resolution, workItemId, shortId]
  );

  const releaseLock = useMemo(
    () => async (): Promise<void> => {
      // Best-effort by design: releaseCollabWorkItemLock no-ops for
      // non-collab work items and swallows failures, so it is safe to call
      // even while the org resolution is still pending.
      if (!projectSlug || !workItemId) return;
      await releaseCollabWorkItemLock(projectSlug, workItemId);
    },
    [projectSlug, workItemId]
  );

  return {
    isLockedByOther: holder.heldByOther,
    lockHolderName: holder.holderName,
    isCollabWorkItem: Boolean(collabOrg),
    acquireLock,
    releaseLock,
  };
}

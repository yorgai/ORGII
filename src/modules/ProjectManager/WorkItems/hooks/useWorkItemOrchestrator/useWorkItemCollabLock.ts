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
   * teammate holds the lock.
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
  const [projectOrgId, setProjectOrgId] = useState<string | null>(null);

  // Resolve the project's org id once per project so we can decide whether
  // this work item is collab-synced. Only sets state after the await, so the
  // effect never mutates state synchronously (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!projectSlug) {
      queueMicrotask(() => setProjectOrgId(null));
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const project = await projectApi.readProject(projectSlug);
        if (!cancelled) setProjectOrgId(project.meta.org_id);
      } catch (error) {
        logger.warn("failed to resolve project org for collab lock", error);
        if (!cancelled) setProjectOrgId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectSlug]);

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
      if (!collabOrg || !projectSlug || !workItemId) return false;
      return acquireCollabWorkItemLock(projectSlug, workItemId, {
        activeShortId: shortId ?? undefined,
      });
    },
    [collabOrg, projectSlug, workItemId, shortId]
  );

  const releaseLock = useMemo(
    () => async (): Promise<void> => {
      if (!collabOrg || !projectSlug || !workItemId) return;
      await releaseCollabWorkItemLock(projectSlug, workItemId);
    },
    [collabOrg, projectSlug, workItemId]
  );

  return {
    isLockedByOther: holder.heldByOther,
    lockHolderName: holder.holderName,
    isCollabWorkItem: Boolean(collabOrg),
    acquireLock,
    releaseLock,
  };
}

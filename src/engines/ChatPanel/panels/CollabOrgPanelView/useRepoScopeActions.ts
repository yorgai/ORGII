import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getSyncProfile } from "@src/features/TeamCollaboration/collabSyncUtils";
import {
  resolveRepoScopeKey,
  resolveRepoScopeKeys,
} from "@src/features/TeamCollaboration/repoScopeResolver";
import { supabaseSyncClient } from "@src/features/TeamCollaboration/sync/supabaseSyncClient";
import {
  collabMembersAtom,
  collabOrgsAtom,
  collabRepoJoinRequestsAtom,
} from "@src/store/collaboration/collabOrgsAtom";
import {
  COLLAB_REPO_JOIN_STATUS,
  COLLAB_ROLE,
} from "@src/store/collaboration/types";
import type {
  CollabOrgRecord,
  CollabRepoJoinRequestRecord,
} from "@src/store/collaboration/types";

interface UseRepoScopeActionsParams {
  org: CollabOrgRecord | undefined;
}

export function useRepoScopeActions({ org }: UseRepoScopeActionsParams) {
  const { t } = useTranslation("navigation");
  const members = useAtomValue(collabMembersAtom);
  const repoJoinRequests = useAtomValue(collabRepoJoinRequestsAtom);
  const setRepoJoinRequests = useSetAtom(collabRepoJoinRequestsAtom);
  const setOrgs = useSetAtom(collabOrgsAtom);

  const [submittingJoin, setSubmittingJoin] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinSubmitted, setJoinSubmitted] = useState(false);
  const [reviewingRequestId, setReviewingRequestId] = useState<string | null>(
    null
  );
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [savingScopes, setSavingScopes] = useState(false);
  const [scopesError, setScopesError] = useState<string | null>(null);
  const [scopesSaved, setScopesSaved] = useState(false);

  const currentMember = useMemo(
    () =>
      members.find(
        (member) =>
          member.orgId === org?.id &&
          member.id === org?.localMemberId &&
          !member.removedAt
      ),
    [members, org?.id, org?.localMemberId]
  );

  const isAdmin = currentMember?.role === COLLAB_ROLE.ADMIN;

  const orgJoinRequests = useMemo(
    () =>
      repoJoinRequests
        .filter((request) => request.orgId === org?.id)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [org?.id, repoJoinRequests]
  );

  const pendingJoinRequests = useMemo(
    () =>
      orgJoinRequests.filter(
        (request) => request.status === COLLAB_REPO_JOIN_STATUS.PENDING
      ),
    [orgJoinRequests]
  );

  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      if (member.removedAt) continue;
      map.set(member.id, member.displayName);
    }
    return map;
  }, [members]);

  const handleRequestRepoJoin = useCallback(
    async (repoPath: string) => {
      if (!org || !currentMember || !repoPath.trim()) return;
      const profile = getSyncProfile(org);
      if (!profile) return;
      setSubmittingJoin(true);
      setJoinError(null);
      setJoinSubmitted(false);
      try {
        // Scope key v2 (design §8.3): normalize to the git remote key (or
        // the normalized path when the repo has no remote) BEFORE
        // request_repo_join — the approve RPC stores it verbatim.
        await supabaseSyncClient.requestRepoJoin({
          ...profile,
          orgId: org.id,
          repoPath: await resolveRepoScopeKey(repoPath),
          requesterMemberId: currentMember.id,
        });
        setJoinSubmitted(true);
      } catch (err) {
        setJoinError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmittingJoin(false);
      }
    },
    [currentMember, org]
  );

  const handleReviewRepoJoin = useCallback(
    async (request: CollabRepoJoinRequestRecord, approve: boolean) => {
      if (!org || !currentMember) return;
      const profile = getSyncProfile(org);
      if (!profile) return;
      setReviewingRequestId(request.requestId);
      setReviewError(null);
      try {
        await supabaseSyncClient.reviewRepoJoin({
          ...profile,
          orgId: org.id,
          requestId: request.requestId,
          approve,
        });
        setRepoJoinRequests((current) =>
          current.map((item) =>
            item.requestId === request.requestId
              ? {
                  ...item,
                  status: approve
                    ? COLLAB_REPO_JOIN_STATUS.APPROVED
                    : COLLAB_REPO_JOIN_STATUS.REJECTED,
                  reviewerMemberId: currentMember.id,
                  reviewedAt: new Date().toISOString(),
                }
              : item
          )
        );
        if (approve) {
          setOrgs((current) =>
            current.map((item) =>
              item.id === org.id
                ? {
                    ...item,
                    repoScopes: Array.from(
                      new Set([...(item.repoScopes ?? []), request.repoPath])
                    ),
                  }
                : item
            )
          );
        }
      } catch (err) {
        setReviewError(err instanceof Error ? err.message : String(err));
      } finally {
        setReviewingRequestId(null);
      }
    },
    [currentMember, org, setOrgs, setRepoJoinRequests]
  );

  const handleSaveRepoScopes = useCallback(
    async (repoScopes: string[]) => {
      if (!org || !currentMember) return;
      const profile = getSyncProfile(org);
      if (!profile) return;
      setSavingScopes(true);
      setScopesError(null);
      setScopesSaved(false);
      try {
        // Same normalization as the join path (design §8.3): admin-entered
        // paths become remote keys when resolvable, deduped after
        // resolution. Existing remote-style keys pass through unchanged.
        const normalized = await resolveRepoScopeKeys(
          repoScopes
            .map((path) => path.trim())
            .filter((path) => path.length > 0)
        );
        await supabaseSyncClient.updateOrgRepoScopes({
          ...profile,
          orgId: org.id,
          repoScopes: normalized,
        });
        setOrgs((current) =>
          current.map((item) =>
            item.id === org.id ? { ...item, repoScopes: normalized } : item
          )
        );
        setScopesSaved(true);
        window.setTimeout(() => setScopesSaved(false), 1500);
      } catch (err) {
        setScopesError(err instanceof Error ? err.message : String(err));
      } finally {
        setSavingScopes(false);
      }
    },
    [currentMember, org, setOrgs]
  );

  return {
    t,
    org,
    currentMember,
    isAdmin,
    orgJoinRequests,
    pendingJoinRequests,
    memberNameById,
    submittingJoin,
    joinError,
    joinSubmitted,
    reviewingRequestId,
    reviewError,
    savingScopes,
    scopesError,
    scopesSaved,
    handleRequestRepoJoin,
    handleReviewRepoJoin,
    handleSaveRepoScopes,
  };
}

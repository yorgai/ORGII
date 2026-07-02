import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  collabMembersAtom,
  collabSessionAccessSettingsAtom,
} from "@src/store/collaboration/collabOrgsAtom";
import { buildCollabSessionShareLink } from "@src/store/collaboration/protocol";
import {
  COLLAB_SESSION_REPLAY_LEVEL,
  COLLAB_SESSION_VISIBILITY,
} from "@src/store/collaboration/types";
import type {
  CollabOrgRecord,
  CollabSessionAccessMode,
  CollabSessionAccessSettings,
  CollabSessionVisibility,
} from "@src/store/collaboration/types";
import type { Session } from "@src/store/session/sessionAtom/types";

import {
  createDefaultAccessSettings,
  getEffectiveAccessMode,
  getSessionVisibility,
  getSyncProfile,
} from "../../collabSyncUtils";
import type { CollabSessionShareRecord } from "../../sync/CollabSyncBackend";
import { supabaseSyncClient } from "../../sync/supabaseSyncClient";

/** Sentinel for "no per-session override — follow the member default". */
export const SHARE_OVERRIDE_INHERIT = "inherit" as const;

export type ShareOverrideValue =
  | typeof SHARE_OVERRIDE_INHERIT
  | CollabSessionAccessMode;

function isShareActive(share: CollabSessionShareRecord): boolean {
  if (share.revokedAt) return false;
  if (share.expiresAt && Date.parse(share.expiresAt) <= Date.now()) {
    return false;
  }
  return true;
}

/**
 * One org section of the session share dialog (design §6.3): per-session
 * override + visibility live in the local settings atom (the sync engine
 * re-publishes on change); directed/link shares go straight to the M4a share
 * RPCs. Shares are granted at 'replay' level — a deliberate share means
 * "watch this session", and the server's resolve path only honors replay
 * link shares anyway.
 */
export function useSessionShareOrgSectionModel({
  session,
  org,
}: {
  session: Session;
  org: CollabOrgRecord;
}) {
  const members = useAtomValue(collabMembersAtom);
  const [accessSettingsList, setAccessSettingsList] = useAtom(
    collabSessionAccessSettingsAtom
  );
  const [shares, setShares] = useState<CollabSessionShareRecord[]>([]);
  const [sharesError, setSharesError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  /** Plaintext link of the share created in THIS dialog session — shown once. */
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [createdLinkCopied, setCreatedLinkCopied] = useState(false);

  const profile = useMemo(() => getSyncProfile(org), [org]);
  const localMemberId = org.localMemberId;
  const sessionRowId = localMemberId
    ? `${org.id}:${localMemberId}:${session.session_id}`
    : null;

  const settings = useMemo<CollabSessionAccessSettings>(
    () =>
      accessSettingsList.find(
        (candidate) =>
          candidate.orgId === org.id && candidate.memberId === localMemberId
      ) ?? createDefaultAccessSettings(org.id, localMemberId ?? ""),
    [accessSettingsList, localMemberId, org.id]
  );

  const effectiveMode = getEffectiveAccessMode(session, settings);
  const overrideValue: ShareOverrideValue =
    settings.sessionOverrides?.[session.session_id] ?? SHARE_OVERRIDE_INHERIT;
  const visibility = getSessionVisibility(session, settings);

  const updateSettings = useCallback(
    (
      mutate: (
        current: CollabSessionAccessSettings
      ) => CollabSessionAccessSettings
    ) => {
      if (!localMemberId) return;
      setAccessSettingsList((current) => {
        const existingIndex = current.findIndex(
          (candidate) =>
            candidate.orgId === org.id && candidate.memberId === localMemberId
        );
        const base =
          existingIndex >= 0
            ? current[existingIndex]
            : createDefaultAccessSettings(org.id, localMemberId);
        const nextSettings = {
          ...mutate(base),
          updatedAt: new Date().toISOString(),
        };
        if (existingIndex < 0) return [nextSettings, ...current];
        const next = [...current];
        next[existingIndex] = nextSettings;
        return next;
      });
    },
    [localMemberId, org.id, setAccessSettingsList]
  );

  const handleSelectOverride = useCallback(
    (value: ShareOverrideValue) => {
      updateSettings((current) => {
        const sessionOverrides = { ...current.sessionOverrides };
        if (value === SHARE_OVERRIDE_INHERIT) {
          delete sessionOverrides[session.session_id];
        } else {
          sessionOverrides[session.session_id] = value;
        }
        return { ...current, sessionOverrides };
      });
    },
    [session.session_id, updateSettings]
  );

  const handleSelectVisibility = useCallback(
    (value: CollabSessionVisibility) => {
      updateSettings((current) => {
        const sessionVisibility = { ...current.sessionVisibility };
        if (value === COLLAB_SESSION_VISIBILITY.ORG) {
          delete sessionVisibility[session.session_id];
        } else {
          sessionVisibility[session.session_id] = value;
        }
        return { ...current, sessionVisibility };
      });
    },
    [session.session_id, updateSettings]
  );

  const refreshShares = useCallback(async () => {
    if (!profile || !sessionRowId) return;
    try {
      const rows = await supabaseSyncClient.listSessionShares({
        ...profile,
        orgId: org.id,
        sessionRowId,
      });
      setShares(rows.filter(isShareActive));
      setSharesError(null);
    } catch (error) {
      // Most common cause: the session row does not exist server-side yet
      // (never pushed). The dialog stays usable — override/visibility are
      // local — and share actions surface the same error on demand.
      setShares([]);
      setSharesError(error instanceof Error ? error.message : String(error));
    }
  }, [org.id, profile, sessionRowId]);

  useEffect(() => {
    void refreshShares();
  }, [refreshShares]);

  const activeGranteeIds = useMemo(
    () =>
      new Set(
        shares
          .map((share) => share.granteeMemberId)
          .filter((id): id is string => Boolean(id))
      ),
    [shares]
  );

  // Roster for the directed multi-select: org members minus self, removed
  // members and members that already hold an active grant.
  const grantableMembers = useMemo(
    () =>
      members.filter(
        (member) =>
          member.orgId === org.id &&
          !member.removedAt &&
          member.id !== localMemberId &&
          !activeGranteeIds.has(member.id)
      ),
    [activeGranteeIds, localMemberId, members, org.id]
  );

  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      if (member.orgId === org.id) map.set(member.id, member.displayName);
    }
    return map;
  }, [members, org.id]);

  const handleToggleMember = useCallback((memberId: string) => {
    setSelectedMemberIds((current) =>
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId]
    );
  }, []);

  const handleCreateDirectedShares = useCallback(async () => {
    if (!profile || !sessionRowId || selectedMemberIds.length === 0) return;
    setBusy(true);
    try {
      for (const granteeMemberId of selectedMemberIds) {
        await supabaseSyncClient.createSessionShare({
          ...profile,
          orgId: org.id,
          sessionRowId,
          granteeMemberId,
          level: COLLAB_SESSION_REPLAY_LEVEL.REPLAY,
        });
      }
      setSelectedMemberIds([]);
      setSharesError(null);
      await refreshShares();
    } catch (error) {
      setSharesError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [org.id, profile, refreshShares, selectedMemberIds, sessionRowId]);

  const handleCreateLinkShare = useCallback(async () => {
    if (!profile || !sessionRowId || !org.supabaseUrl) return;
    setBusy(true);
    try {
      const { shareToken } = await supabaseSyncClient.createSessionShare({
        ...profile,
        orgId: org.id,
        sessionRowId,
        level: COLLAB_SESSION_REPLAY_LEVEL.REPLAY,
      });
      if (!shareToken) throw new Error("Share token missing");
      const link = buildCollabSessionShareLink({
        supabaseUrl: org.supabaseUrl,
        anonKey: org.supabaseAnonKey,
        orgId: org.id,
        shareToken,
      });
      // The plaintext exists only here (design §6.2): copy immediately and
      // keep it visible until the dialog closes — it cannot be re-derived.
      setCreatedLink(link);
      try {
        await navigator.clipboard.writeText(link);
        setCreatedLinkCopied(true);
      } catch {
        setCreatedLinkCopied(false);
      }
      setSharesError(null);
      await refreshShares();
    } catch (error) {
      setSharesError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [
    org.id,
    org.supabaseAnonKey,
    org.supabaseUrl,
    profile,
    refreshShares,
    sessionRowId,
  ]);

  const handleRevokeShare = useCallback(
    async (shareId: string) => {
      if (!profile) return;
      setBusy(true);
      try {
        await supabaseSyncClient.revokeSessionShare({
          ...profile,
          orgId: org.id,
          shareId,
        });
        setSharesError(null);
        await refreshShares();
      } catch (error) {
        setSharesError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [org.id, profile, refreshShares]
  );

  return {
    effectiveMode,
    overrideValue,
    visibility,
    shares,
    sharesError,
    busy,
    grantableMembers,
    memberNameById,
    selectedMemberIds,
    createdLink,
    createdLinkCopied,
    canShare: Boolean(profile && sessionRowId),
    handleSelectOverride,
    handleSelectVisibility,
    handleToggleMember,
    handleCreateDirectedShares,
    handleCreateLinkShare,
    handleRevokeShare,
  };
}

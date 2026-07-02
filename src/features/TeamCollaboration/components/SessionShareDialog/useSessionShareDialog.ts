import { useAtomValue } from "jotai";
import { useCallback, useMemo, useState } from "react";

import { collabOrgsAtom } from "@src/store/collaboration/collabOrgsAtom";
import type { CollabOrgRecord } from "@src/store/collaboration/types";
import type { Session } from "@src/store/session/sessionAtom/types";

import { getShareCapableOrgsForSession } from "../../collabSyncUtils";

export interface UseSessionShareDialogResult {
  /** Session the dialog is open for; null = closed. */
  shareDialogSession: Session | null;
  /** Share-capable orgs for the open session (dialog sections). */
  shareDialogOrgs: CollabOrgRecord[];
  /**
   * Menu-item gate (design §6.3): ≥1 usable supabase org whose repoScopes
   * contain the session's repo — and the session is the owner's own.
   */
  isShareEligible: (session: Session) => boolean;
  openShareSettings: (session: Session) => void;
  closeShareSettings: () => void;
}

/**
 * Per-surface state for the owner-side SessionShareDialog. Each mount
 * surface (sidebar context menu, chat panel header menu) owns one instance,
 * mirroring the RenameModal / LinkSessionToWorkItemModal idiom.
 */
export function useSessionShareDialog(): UseSessionShareDialogResult {
  const orgs = useAtomValue(collabOrgsAtom);
  const [shareDialogSession, setShareDialogSession] = useState<Session | null>(
    null
  );

  const isShareEligible = useCallback(
    (session: Session) =>
      getShareCapableOrgsForSession(session, orgs).length > 0,
    [orgs]
  );

  const shareDialogOrgs = useMemo(
    () =>
      shareDialogSession
        ? getShareCapableOrgsForSession(shareDialogSession, orgs)
        : [],
    [orgs, shareDialogSession]
  );

  const openShareSettings = useCallback((session: Session) => {
    setShareDialogSession(session);
  }, []);

  const closeShareSettings = useCallback(() => {
    setShareDialogSession(null);
  }, []);

  return {
    shareDialogSession,
    shareDialogOrgs,
    isShareEligible,
    openShareSettings,
    closeShareSettings,
  };
}

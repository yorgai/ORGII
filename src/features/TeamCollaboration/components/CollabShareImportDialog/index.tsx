/**
 * CollabShareImportDialog — consumer side of the share deep link (design
 * §6.4): confirmation dialog → resolveSessionShare(token) → read-only import
 * through the shared segments importer → openSession.
 *
 * Guests (no matching org locally) are first-class here: the token IS the
 * credential, the imported copy lands as an `external_history` session with
 * no `orgId` (sidebar Personal area) and no org records are created. For a
 * combined share+invite link the share is consumed first; the invite then
 * powers the "join this org" CTA that routes into the existing pendingInvite
 * flow.
 *
 * The pending atom itself is the dialog state: it stays set while the
 * confirmation is open and is consumed (cleared) exactly once on close, so a
 * re-render can never replay the hand-off. All per-link results are keyed by
 * the share token, so a newer link invalidates stale resolve/import state.
 */
import Modal from "@/src/scaffold/ModalSystem";
import { useAtomValue, useSetAtom } from "jotai";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { useSessionView } from "@src/hooks/ui/tabs/useSessionView";
import { collabPendingInviteAtom } from "@src/store/collaboration/collabPendingInviteAtom";
import {
  collabPendingShareAtom,
  consumeCollabPendingShareAtom,
} from "@src/store/collaboration/collabPendingShareAtom";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";
import {
  CHAT_PANEL_SURFACE_KIND,
  chatPanelNavigateAtom,
} from "@src/store/ui/chatPanelAtom";

import { importRemoteSession } from "../../engine/collabSyncEngineHelpers";
import { supabaseSyncClient } from "../../sync/supabaseSyncClient";

interface ResolveState {
  token: string;
  session: RemoteTeammateSessionMetadata | null;
  failed: boolean;
}

interface ImportState {
  token: string;
  status: "importing" | "imported" | "failed";
}

const CollabShareImportDialog: React.FC = () => {
  const { t } = useTranslation("navigation");
  const { openSession } = useSessionView();
  const share = useAtomValue(collabPendingShareAtom);
  const consumePendingShare = useSetAtom(consumeCollabPendingShareAtom);
  const setPendingInvite = useSetAtom(collabPendingInviteAtom);
  const navigateChatPanel = useSetAtom(chatPanelNavigateAtom);

  const [resolveState, setResolveState] = useState<ResolveState | null>(null);
  const [importState, setImportState] = useState<ImportState | null>(null);

  const missingCoordinates = Boolean(
    share && (!share.supabaseUrl || !share.anonKey)
  );

  // Resolve the token to the session projection (title/owner shown in the
  // confirmation — the org NAME is unknowable for guests by design). State
  // updates only happen in the async callback, keyed by token.
  useEffect(() => {
    if (!share || !share.supabaseUrl || !share.anonKey) return;
    const { supabaseUrl, anonKey, shareToken } = share;
    let cancelled = false;
    supabaseSyncClient
      .resolveSessionShare({ supabaseUrl, anonKey, shareToken })
      .then((session) => {
        if (!cancelled) {
          setResolveState({ token: shareToken, session, failed: false });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolveState({ token: shareToken, session: null, failed: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [share]);

  const resolved =
    share && resolveState?.token === share.shareToken ? resolveState : null;
  const currentImport =
    share && importState?.token === share.shareToken ? importState : null;

  const hasError = Boolean(
    missingCoordinates || resolved?.failed || currentImport?.status === "failed"
  );
  const isImported = currentImport?.status === "imported";
  const isImporting = currentImport?.status === "importing";
  const isReady = Boolean(resolved?.session) && !hasError && !currentImport;

  const handleClose = useCallback(() => {
    // One-shot consume: clears the atom so nothing can replay this link.
    consumePendingShare();
  }, [consumePendingShare]);

  const handleImport = useCallback(async () => {
    if (!share || !share.supabaseUrl || !share.anonKey || !resolved?.session) {
      return;
    }
    const token = share.shareToken;
    setImportState({ token, status: "importing" });
    try {
      const result = await importRemoteSession({
        client: supabaseSyncClient,
        // Ticket tier: no member identity, no org secret — the share token
        // authenticates every segments fetch.
        profile: { supabaseUrl: share.supabaseUrl, anonKey: share.anonKey },
        orgId: resolved.session.orgId,
        remoteSession: resolved.session,
        shareToken: token,
      });
      if (!result) {
        setImportState({ token, status: "failed" });
        return;
      }
      openSession(
        result.localSessionId,
        resolved.session.title,
        resolved.session.repoPath
      );
      if (share.inviteCode) {
        // Combined link: keep the dialog open for the join CTA.
        setImportState({ token, status: "imported" });
      } else {
        handleClose();
      }
    } catch {
      setImportState({ token, status: "failed" });
    }
  }, [handleClose, openSession, resolved, share]);

  const handleJoinOrg = useCallback(() => {
    if (!share?.inviteCode) return;
    // Same hand-off the join deep link uses: prefill the JOIN form.
    setPendingInvite({
      supabaseUrl: share.supabaseUrl,
      anonKey: share.anonKey,
      inviteCode: share.inviteCode,
    });
    navigateChatPanel({ kind: CHAT_PANEL_SURFACE_KIND.NEW_COLLAB_ORG });
    handleClose();
  }, [handleClose, navigateChatPanel, setPendingInvite, share]);

  return (
    <Modal
      visible={share !== null}
      title={t("collaboration.share.incomingTitle")}
      onCancel={handleClose}
      footer={null}
      width={440}
    >
      <div
        className="flex flex-col gap-3"
        data-testid="collab-share-import-dialog"
      >
        {!resolved && !hasError ? (
          <div className="text-[12px] text-text-3">
            {t("collaboration.share.incomingResolving")}
          </div>
        ) : null}

        {hasError ? (
          <div className="rounded-lg bg-danger-1 px-3 py-2 text-[12px] text-danger-6">
            {t("collaboration.share.incomingError")}
          </div>
        ) : null}

        {resolved?.session && !hasError ? (
          <div className="rounded-xl border border-border-2 bg-bg-2 px-3 py-3">
            <div className="text-[13px] font-semibold text-text-1">
              {resolved.session.title}
            </div>
            <div className="mt-1 text-[12px] text-text-3">
              {t("collaboration.share.incomingOwner")}:{" "}
              {resolved.session.ownerDisplayName}
            </div>
            {resolved.session.repoPath ? (
              <div className="mt-0.5 truncate text-[11px] text-text-4">
                {resolved.session.repoPath}
              </div>
            ) : null}
          </div>
        ) : null}

        {isImported ? (
          <div className="rounded-lg bg-fill-1 px-3 py-2 text-[12px] text-text-3">
            {t("collaboration.share.incomingImported")}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button htmlType="button" variant="secondary" onClick={handleClose}>
            {t("collaboration.share.incomingDismiss")}
          </Button>
          {isImported && share?.inviteCode ? (
            <Button htmlType="button" variant="primary" onClick={handleJoinOrg}>
              {t("collaboration.share.incomingJoinCta")}
            </Button>
          ) : (
            <Button
              htmlType="button"
              variant="primary"
              loading={isImporting}
              disabled={!isReady}
              onClick={() => void handleImport()}
              data-testid="collab-share-import-confirm"
            >
              {t("collaboration.share.incomingImport")}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default CollabShareImportDialog;

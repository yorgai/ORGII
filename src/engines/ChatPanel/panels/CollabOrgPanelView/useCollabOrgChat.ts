import type { TFunction } from "i18next";
import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getSyncProfile } from "@src/features/TeamCollaboration/collabSyncUtils";
import { supabaseSyncClient } from "@src/features/TeamCollaboration/sync/supabaseSyncClient";
import { collabChatMessagesAtom } from "@src/store/collaboration/collabOrgsAtom";
import { COLLAB_IDENTITY_KIND } from "@src/store/collaboration/types";
import type {
  CollabChatMessageRecord,
  CollabMemberRecord,
  CollabOrgRecord,
} from "@src/store/collaboration/types";

import { CHAT_HISTORY_LIMIT } from "./constants";
import { createLocalChatMessageId, upsertChatMessage } from "./utils";

interface UseCollabOrgChatParams {
  org: CollabOrgRecord | undefined;
  orgMembers: CollabMemberRecord[];
  currentMember: CollabMemberRecord | undefined;
  t: TFunction<"navigation">;
}

export function useCollabOrgChat({
  org,
  orgMembers,
  currentMember,
  t,
}: UseCollabOrgChatParams) {
  const [chatMessages, setChatMessages] = useAtom(collabChatMessagesAtom);
  const [draftMessage, setDraftMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const syncProfile = useMemo(() => (org ? getSyncProfile(org) : null), [org]);

  useEffect(() => {
    if (!org || !syncProfile) return;
    let cancelled = false;
    supabaseSyncClient
      .listChatMessages({
        ...syncProfile,
        orgId: org.id,
        limit: CHAT_HISTORY_LIMIT,
      })
      .then((messages) => {
        if (cancelled) return;
        setChatMessages((current) =>
          messages.reduce(upsertChatMessage, current)
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setChatError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [org, setChatMessages, syncProfile]);

  const handleSendMessage = useCallback(async () => {
    const body = draftMessage.trim();
    if (!body || !org || sending) return;
    setSending(true);
    setChatError(null);
    try {
      if (syncProfile && currentMember) {
        const message = await supabaseSyncClient.postChatMessage({
          ...syncProfile,
          orgId: org.id,
          memberId: currentMember.id,
          authorDisplayName: currentMember.displayName,
          authorIdentityKind: currentMember.identityKind,
          body,
        });
        setChatMessages((current) => upsertChatMessage(current, message));
      } else {
        const author =
          currentMember ??
          orgMembers.find(
            (member) => member.identityKind === COLLAB_IDENTITY_KIND.HUMAN
          ) ??
          orgMembers[0];
        const message: CollabChatMessageRecord = {
          id: createLocalChatMessageId(org.id),
          orgId: org.id,
          authorMemberId: author?.id ?? "local-human",
          authorDisplayName:
            author?.displayName ?? t("collaboration.localHuman"),
          authorIdentityKind:
            author?.identityKind ?? COLLAB_IDENTITY_KIND.HUMAN,
          body,
          createdAt: new Date().toISOString(),
        };
        setChatMessages((current) => upsertChatMessage(current, message));
      }
      setDraftMessage("");
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  }, [
    currentMember,
    draftMessage,
    org,
    orgMembers,
    sending,
    setChatMessages,
    syncProfile,
    t,
  ]);

  return {
    chatMessages,
    draftMessage,
    setDraftMessage,
    sending,
    chatError,
    handleSendMessage,
  };
}

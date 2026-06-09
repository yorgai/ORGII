import { useSetAtom } from "jotai";
import { useLayoutEffect, useMemo, useRef } from "react";

import {
  type ChatPanelHeaderContribution,
  type ChatPanelHeaderSlots,
  chatPanelHeaderSlotsAtom,
  normalizeChatPanelHeaderContribution,
} from "./chatPanelHeaderSlots";

interface UsePublishChatPanelHeaderOptions {
  content: ChatPanelHeaderContribution;
  enabled?: boolean;
}

export function usePublishChatPanelHeader({
  content,
  enabled = true,
}: UsePublishChatPanelHeaderOptions): void {
  const setHeader = useSetAtom(chatPanelHeaderSlotsAtom);
  const normalizedContent = useMemo(
    () => normalizeChatPanelHeaderContribution(content),
    [content]
  );
  const ownedContentRef = useRef<ChatPanelHeaderSlots | null>(null);

  useLayoutEffect(() => {
    if (!enabled) {
      setHeader((previous) =>
        previous === ownedContentRef.current ? null : previous
      );
      ownedContentRef.current = null;
      return;
    }

    ownedContentRef.current = normalizedContent;
    setHeader(normalizedContent);
  }, [enabled, normalizedContent, setHeader]);

  useLayoutEffect(() => {
    return () => {
      setHeader((previous) =>
        previous === ownedContentRef.current ? null : previous
      );
      ownedContentRef.current = null;
    };
  }, [setHeader]);
}

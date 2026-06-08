/**
 * AllSessionsSearchPalette
 *
 * Spotlight palette for full-text search across all cached sessions.
 * Results show the best-matched snippet per session with a click-to-navigate
 * action. Uses FTS5 via `cache_search_all_sessions`.
 */
import { useAtomValue } from "jotai";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { rpc } from "@src/api/tauri/rpc";
import type { CrossSessionSearchHit } from "@src/api/tauri/rpc/schemas/sessionCore";
import { useDebouncedCallback } from "@src/hooks/perf";
import { useSessionView } from "@src/hooks/ui/tabs/useSessionView";
import { sessionMapAtom } from "@src/store/session/sessionAtom";

import type { BasePaletteProps } from "../../shared";
import { PaletteBody, SpotlightShell } from "../../shell";
import type { SpotlightItem } from "../../types";
import { useSelectorKernel } from "../core";

// ============ PROPS ============

export interface AllSessionsSearchPaletteProps extends BasePaletteProps {}

// ============ COMPONENT ============

export const AllSessionsSearchPalette: React.FC<
  AllSessionsSearchPaletteProps
> = ({ isOpen, onClose }) => {
  const { t } = useTranslation("sessions");
  const { openSession } = useSessionView();
  const sessionMap = useAtomValue(sessionMapAtom);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CrossSessionSearchHit[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const prevIsOpenRef = useRef(isOpen);

  const debouncedSearch = useDebouncedCallback((q: string) => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    setIsLoading(true);
    rpc.sessionCore.cache
      .searchAllSessions({ query: q, limit: 30 })
      .then((results) => setHits(results))
      .catch(() => setHits([]))
      .finally(() => setIsLoading(false));
  }, 200);

  // Reset state when palette closes. Using a ref comparison avoids calling
  // setState synchronously inside an effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (prevIsOpenRef.current && !isOpen) {
      debouncedSearch.cancel();
      setTimeout(() => {
        setQuery("");
        setHits([]);
      }, 0);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, debouncedSearch]);

  useEffect(() => {
    debouncedSearch(query);
  }, [query, debouncedSearch]);

  const handleNavigate = useCallback(
    (sessionId: string, sessionName: string, repoPath: string) => {
      openSession(sessionId, sessionName, repoPath);
      onClose();
    },
    [openSession, onClose]
  );

  const items: SpotlightItem[] = hits.map((hit) => {
    const session = sessionMap.get(hit.sessionId);
    const sessionName = session?.name ?? t("chat.session", "Session");
    const cleanSnippet = hit.snippet.replace(/<\/?mark>/g, "");
    return {
      id: hit.sessionId,
      label: sessionName,
      description: cleanSnippet,
      onClick: () =>
        handleNavigate(hit.sessionId, sessionName, session?.repoPath ?? ""),
    };
  });

  const kernel = useSelectorKernel({
    isOpen,
    onClose,
    items,
    externalSearchQuery: query,
    externalSetSearchQuery: setQuery,
  });

  return (
    <SpotlightShell isOpen={isOpen} onClose={onClose}>
      <PaletteBody
        kernel={kernel}
        items={items}
        searchQuery={query}
        placeholder={t(
          "chat.searchAllSessionsPlaceholder",
          "Search across all sessions…"
        )}
        inputVariant="simple"
        isLoading={isLoading}
        containerHeight={360}
      />
    </SpotlightShell>
  );
};

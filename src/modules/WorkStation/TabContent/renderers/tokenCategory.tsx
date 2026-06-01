/**
 * Renderer wrapper for `token-category` tabs.
 *
 * `TokenManagerPanel` takes `category` + `repoPath` only, both of
 * which are present (category in `tab.data`, repoPath in
 * `currentRepoAtom`). It is therefore safe to mount standalone.
 */
import { useAtomValue } from "jotai";
import React, { memo } from "react";

import TokenManagerPanel from "@src/modules/WorkStation/Browser/Panels/BrowserMainPane/content/TokenManagerContent";
import { currentRepoAtom } from "@src/store/repo";

import type { UnifiedTabContentProps } from "../types";

const TokenCategoryTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => {
    const currentRepo = useAtomValue(currentRepoAtom);
    const repoPath = currentRepo?.path ?? currentRepo?.fs_uri ?? "";
    const category = String(tab.data.category ?? "");
    return <TokenManagerPanel category={category} repoPath={repoPath} />;
  }
);

TokenCategoryTabRenderer.displayName = "TokenCategoryTabRenderer";

export default TokenCategoryTabRenderer;

/**
 * Renderer wrapper for `lint-scan` tabs.
 *
 * `LintScanContent` needs a `repoPath` prop. We resolve it from
 * `currentRepoAtom` so the wrapper can run outside the editor host —
 * which matches how the live editor renderer derives it today. The
 * dispatcher itself is not yet wired in (Phase 2), so this is a
 * preparatory adapter.
 */
import { useAtomValue } from "jotai";
import React, { memo } from "react";

import LintScanContent from "@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/LintScanContent";
import { currentRepoAtom } from "@src/store/repo";

import type { UnifiedTabContentProps } from "../types";

const LintScanTabRenderer: React.FC<UnifiedTabContentProps> = memo(() => {
  const currentRepo = useAtomValue(currentRepoAtom);
  const repoPath = currentRepo?.path ?? currentRepo?.fs_uri ?? "";
  return <LintScanContent repoPath={repoPath} />;
});

LintScanTabRenderer.displayName = "LintScanTabRenderer";

export default LintScanTabRenderer;

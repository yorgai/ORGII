/**
 * Editor & Workspace Settings Section
 *
 * Two URL-addressable tabs:
 *   - `editor` (default): terminal, language servers, external IDE
 *   - `index`           : code search indexing + embedding model
 *
 * The `index` tab body lives in `IndexingSection` and is lazy-loaded so
 * its tantivy/usearch refresh doesn't run when the user is on the
 * Editor tab.
 */
import React, { Suspense, lazy } from "react";

import { Placeholder } from "@src/modules/shared/layouts/blocks";

import ExternalIdeSection from "./components/ExternalIdeSection";
import LanguageServersSection from "./components/LanguageServersSection";
import TerminalSection from "./components/TerminalSettingsSection";

const IndexingSection = lazy(
  () => import("@src/modules/MainApp/Settings/sections/IndexingSection")
);

export const EDITOR_TAB_KEYS = {
  EDITOR: "editor",
  INDEX: "index",
} as const;

export type EditorTabKey =
  (typeof EDITOR_TAB_KEYS)[keyof typeof EDITOR_TAB_KEYS];

interface EditorSectionProps {
  activeTab?: string;
}

const EditorSection: React.FC<EditorSectionProps> = ({ activeTab }) => {
  if (activeTab === EDITOR_TAB_KEYS.INDEX) {
    return (
      <Suspense
        fallback={<Placeholder variant="loading" placement="detail-panel" />}
      >
        <IndexingSection />
      </Suspense>
    );
  }

  return (
    <>
      <ExternalIdeSection />
      <TerminalSection />
      <LanguageServersSection />
    </>
  );
};

export default EditorSection;

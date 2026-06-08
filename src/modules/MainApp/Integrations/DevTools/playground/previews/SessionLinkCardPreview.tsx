/**
 * SessionLinkCardPreview
 *
 * DevTools playground preview for SessionLinkCard. Renders 4 mock cards covering
 * all PR status variants: open, merged, draft, and closed.
 */
import SessionLinkCard from "@src/engines/ChatPanel/blocks/ToolCallBlock/cards/SessionLinkCard";
import type { SessionLinkCardData } from "@src/engines/ChatPanel/blocks/ToolCallBlock/cards/SessionLinkCard";

import {
  type ModeControlProps,
  useModeTabsDefinition,
  usePlaygroundVariantTabs,
} from "../hooks";
import {
  PlaygroundPreviewMainArea,
  PlaygroundSidebarHeader,
  PlaygroundSidebarShell,
} from "../panels";

const MOCK_SESSION_LINK_CARDS: SessionLinkCardData[] = [
  {
    prUrl: "https://github.com/cognition/cognition-website/pull/167",
    prStatus: "open",
    repoFullName: "cognition/cognition-website",
    prNumber: 167,
    prTitle: "Migrate all gradient text to #317CFF",
    sourceBranch: "devin/USA-938-1765942251",
    targetBranch: "main",
    filesChanged: 6,
    additions: 21,
    deletions: 123,
  },
  {
    prUrl: "https://github.com/cognition/devin-website/pull/357",
    prStatus: "merged",
    repoFullName: "cognition/devin-website",
    prNumber: 357,
    prTitle: "Migrate all gradient text to #317CFF",
    sourceBranch: "devin/USA-938-1765942252",
    targetBranch: "main",
    filesChanged: 2,
    additions: 4,
    deletions: 8,
  },
  {
    prUrl: "https://github.com/cognition/devin-website/pull/358",
    prStatus: "draft",
    repoFullName: "cognition/devin-website",
    prNumber: 358,
    prTitle: "WIP: Add new onboarding flow",
    sourceBranch: "feature/onboarding",
    targetBranch: "main",
    filesChanged: 12,
    additions: 340,
    deletions: 12,
  },
  {
    prUrl: "https://github.com/cognition/cognition-website/pull/160",
    prStatus: "closed",
    repoFullName: "cognition/cognition-website",
    prNumber: 160,
    prTitle: "Revert: Remove dark mode toggle",
    sourceBranch: "revert/dark-mode",
    targetBranch: "main",
    filesChanged: 3,
    additions: 8,
    deletions: 45,
  },
];

function SessionLinkCardPreviewContent() {
  return (
    <div className="tool-event-preview-shell tool-event-preview-shell--chat">
      <div className="tool-event-preview-shell__content tool-event-preview-shell__content--chat">
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-0 py-4">
          {MOCK_SESSION_LINK_CARDS.map((card) => (
            <SessionLinkCard key={card.prNumber} card={card} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SessionLinkCardPreview({
  mode,
  onModeChange,
}: ModeControlProps) {
  const modeTabs = useModeTabsDefinition();
  const variantTabs = usePlaygroundVariantTabs(false);

  return (
    <div className="tool-event-single relative min-h-0 flex-1">
      <div className="tool-event-single-with-sidebar gap-2">
        <PlaygroundSidebarShell>
          <PlaygroundSidebarHeader
            mode={mode}
            onModeChange={onModeChange}
            modeTabs={modeTabs}
            variantTabs={variantTabs}
            selectedVariant="chat"
            onVariantChange={() => {}}
            onReset={() => {}}
          />
        </PlaygroundSidebarShell>

        <PlaygroundPreviewMainArea
          jsonVisible={false}
          overrideClassName=""
          overrideStyles={{}}
          jsonInput=""
          onJsonChange={() => {}}
          jsonPlaceholder=""
          renderPreviewContent={SessionLinkCardPreviewContent}
        />
      </div>
    </div>
  );
}

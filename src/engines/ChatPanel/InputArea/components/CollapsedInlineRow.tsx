/**
 * CollapsedInlineRow
 *
 * Horizontal row of pill-shaped buttons — one per active ComposerStack section
 * (queue, processes, file changes). Always visible when any section has data.
 * Clicking a pill expands that section's card above.
 *
 * Also renders scroll-nav action pills (scroll to bottom, follow agent)
 * immediately after the section pills.
 *
 * Each pill shows icon + numeric count only. gap-1 between pills.
 */
import { ArrowDown } from "lucide-react";
import React, { memo } from "react";

import { KeyboardShortcutTooltipContent } from "@src/components/KeyboardShortcut";
import Tooltip from "@src/components/Tooltip";

import type { ScrollNavState } from "../../ChatHistory";
import StackPill from "./StackPill";

export interface InlineSection {
  key: string;
  icon: React.ReactNode;
  count: number;
  active: boolean;
  onExpand: () => void;
  /** When set, renders this text instead of the numeric count. */
  label?: string;
  /** "primary" renders in primary-6 — used for question/permission/modeswitch pills */
  variant?: "default" | "primary";
  /** When true, only the icon is shown (no count or label). */
  iconOnly?: boolean;
  /** Optional custom content rendered after the leading icon. */
  content?: React.ReactNode;
  /** Stable selector for rendered UI E2E coverage. */
  testId?: string;
}

export interface CollapsedInlineRowProps {
  sections: InlineSection[];
  scrollNav?: ScrollNavState | null;
}

const CollapsedInlineRow: React.FC<CollapsedInlineRowProps> = memo(
  ({ sections, scrollNav }) => {
    const showScrollToBottom = scrollNav?.showScrollToBottom ?? false;
    const showFollowAgent = scrollNav?.showFollowAgent ?? false;
    const hasTrailing = showScrollToBottom || showFollowAgent;

    if (sections.length === 0 && !hasTrailing) return null;

    return (
      <div className="flex items-center gap-1 px-0.5">
        {sections.map((section) => (
          <StackPill
            key={section.key}
            icon={section.icon}
            count={section.count}
            active={section.active}
            onClick={section.onExpand}
            label={section.label}
            variant={section.variant}
            iconOnly={section.iconOnly}
            content={section.content}
            testId={section.testId}
          />
        ))}

        {hasTrailing && (
          <div className="flex items-center gap-1">
            {showFollowAgent && (
              <Tooltip
                content={
                  <KeyboardShortcutTooltipContent
                    label={scrollNav!.followAgentTooltipLabel}
                    shortcut={scrollNav!.followAgentShortcut || undefined}
                  />
                }
                position="top"
                mouseEnterDelay={250}
                framedPanel
              >
                <span className="inline-flex">
                  <StackPill
                    count={0}
                    active={false}
                    onClick={scrollNav!.onFollowAgent}
                    label={scrollNav!.followAgentLabel}
                    ariaLabel={scrollNav!.followAgentTooltipLabel}
                  />
                </span>
              </Tooltip>
            )}
            {showScrollToBottom && (
              <StackPill
                icon={<ArrowDown size={13} />}
                count={0}
                active={false}
                onClick={scrollNav!.onScrollToBottom}
                iconOnly
              />
            )}
          </div>
        )}
      </div>
    );
  }
);

CollapsedInlineRow.displayName = "CollapsedInlineRow";

export default CollapsedInlineRow;

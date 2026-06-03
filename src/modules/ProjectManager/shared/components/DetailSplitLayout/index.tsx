/**
 * DetailSplitLayout Component
 *
 * Reusable layout for detail/creation panels in Project Manager.
 * Provides:
 *   - Header with breadcrumb or title, optional nav + actions (shared tokens)
 *   - Split panel: left content area + right sidebar (280px)
 *   - Optional footer
 *
 * Used by:
 *   - WorkItemDetail (view/edit)
 *   - CreateProjectView (create)
 *   - CreateWorkItemView (create)
 */
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import {
  HEADER_CLASSES,
  HEADER_ICON_SIZE,
} from "@src/config/workstation/tokens";
import { usePublishWorkstationTabHeader } from "@src/hooks/workStation";
import { PANEL_FOOTER_TOKENS } from "@src/modules/shared/layouts/blocks";

// ============================================
// Types
// ============================================

export interface DetailSplitLayoutProps {
  /** Title shown in the header (used when no breadcrumb is provided) */
  title: string;
  /** Optional breadcrumb segments displayed before the title (e.g. ["Repo", "New Project"]) */
  breadcrumb?: React.ReactNode[];
  /** Remove the default bottom border from the local header row. */
  borderlessHeader?: boolean;
  /** Optional navigation callback (renders prev/next arrows) */
  onNavigate?: (direction: "prev" | "next") => void;
  /** Whether previous navigation is available */
  hasPrev?: boolean;
  /** Whether next navigation is available */
  hasNext?: boolean;
  /** Optional extra actions rendered in the header (e.g. delete button) */
  headerActions?: React.ReactNode;
  /** Optional full-width content rendered above the detail body. */
  topContent?: React.ReactNode;
  /** Left panel content (main content area) */
  leftContent: React.ReactNode;
  /** Right panel content (properties sidebar) */
  rightContent?: React.ReactNode;
  /** Optional footer (e.g. Cancel / Create buttons) */
  footer?: React.ReactNode;
  /** Publish header content into the global WorkstationTabHeader instead of rendering an inline row. */
  publishHeaderToWorkstation?: boolean;
}

// ============================================
// Component
// ============================================

const DetailSplitLayout: React.FC<DetailSplitLayoutProps> = ({
  title,
  breadcrumb,
  borderlessHeader = false,
  onNavigate,
  hasPrev = false,
  hasNext = false,
  headerActions,
  topContent,
  leftContent,
  rightContent,
  footer,
  publishHeaderToWorkstation = false,
}) => {
  const { t } = useTranslation();

  const headerContent = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-0.5">
        {breadcrumb && breadcrumb.length > 0 ? (
          breadcrumb.map((segment, index) => {
            const isLeaf = index === breadcrumb.length - 1;
            return (
              <React.Fragment key={index}>
                {index > 0 && (
                  <ChevronRight
                    size={14}
                    strokeWidth={1.75}
                    className="mx-1 flex-shrink-0 text-fill-4"
                  />
                )}
                {typeof segment === "string" || typeof segment === "number" ? (
                  <span
                    className={
                      isLeaf
                        ? "min-w-0 truncate text-[12px] font-medium text-text-1"
                        : "whitespace-nowrap text-[12px] text-text-2"
                    }
                  >
                    {segment}
                  </span>
                ) : (
                  <div className="min-w-0 shrink-0">{segment}</div>
                )}
              </React.Fragment>
            );
          })
        ) : (
          <span className="min-w-0 truncate text-[12px] font-medium text-text-1">
            {title}
          </span>
        )}
      </div>

      <div className="flex flex-shrink-0 items-center gap-px">
        {headerActions}
        {headerActions && onNavigate && (
          <div
            className="pointer-events-none mx-1.5 h-4 w-px shrink-0 bg-border-2"
            role="separator"
            aria-hidden
          />
        )}
        {onNavigate && (
          <>
            <Button
              htmlType="button"
              variant="tertiary"
              size="small"
              iconOnly
              onClick={() => onNavigate("prev")}
              disabled={!hasPrev}
              title={t("actions.previous")}
              icon={<ChevronUp size={HEADER_ICON_SIZE.sm} />}
            />
            <Button
              htmlType="button"
              variant="tertiary"
              size="small"
              iconOnly
              onClick={() => onNavigate("next")}
              disabled={!hasNext}
              title={t("actions.next")}
              icon={<ChevronDown size={HEADER_ICON_SIZE.sm} />}
            />
          </>
        )}
      </div>
    </>
  );

  usePublishWorkstationTabHeader({
    host: "project",
    content: headerContent,
    enabled: publishHeaderToWorkstation,
  });

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
      {!publishHeaderToWorkstation && (
        <div
          className={
            borderlessHeader
              ? HEADER_CLASSES.pageHeader.replace(
                  "border-b border-border-2",
                  ""
                )
              : HEADER_CLASSES.pageHeader
          }
        >
          {headerContent}
        </div>
      )}

      {topContent && (
        <div className="shrink-0 border-b border-border-2">{topContent}</div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={`min-w-0 flex-1 overflow-hidden ${rightContent ? "border-r border-border-2" : ""}`}
        >
          {leftContent}
        </div>

        {rightContent && (
          <div className="w-[280px] min-w-[250px] max-w-[300px] shrink-0">
            {rightContent}
          </div>
        )}
      </div>

      {footer && (
        <div className={`${PANEL_FOOTER_TOKENS.container} justify-end`}>
          {footer}
        </div>
      )}
    </div>
  );
};

export default DetailSplitLayout;

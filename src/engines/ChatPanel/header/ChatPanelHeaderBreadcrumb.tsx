import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { DROPDOWN_ITEM } from "@src/components/Dropdown/tokens";

export interface ChatPanelHeaderBreadcrumbItem {
  key: string;
  label: ReactNode;
  subtitle?: ReactNode;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

interface ChatPanelHeaderBreadcrumbProps {
  items: readonly ChatPanelHeaderBreadcrumbItem[];
  trailing?: ReactNode;
  currentItemKey?: string;
  dataTestId?: string;
}

const SEGMENT_BASE_CLASS =
  "flex h-7 min-w-0 max-w-full cursor-default items-center gap-1 rounded-lg px-1.5 text-[13px] text-text-1 transition-colors hover:bg-surface-hover";

function getSegmentClass(isCurrent: boolean): string {
  return `${SEGMENT_BASE_CLASS} ${isCurrent ? "font-semibold" : "font-normal"}`;
}

function ChatPanelHeaderBreadcrumbSegment({
  item,
  isCurrent,
}: {
  item: ChatPanelHeaderBreadcrumbItem;
  isCurrent: boolean;
}) {
  const segmentClass = getSegmentClass(isCurrent);
  const content = (
    <span className="flex min-w-0 flex-col leading-tight">
      <span className="min-w-0 truncate">{item.label}</span>
      {item.subtitle ? (
        <span className="min-w-0 truncate text-[11px] font-normal text-text-3">
          {item.subtitle}
        </span>
      ) : null}
    </span>
  );

  if (item.onClick) {
    return (
      <button
        type="button"
        className={`${segmentClass} cursor-pointer`}
        onClick={item.onClick}
      >
        {content}
      </button>
    );
  }

  return <span className={segmentClass}>{content}</span>;
}

export function ChatPanelHeaderBreadcrumb({
  items,
  trailing,
  currentItemKey,
  dataTestId = "chat-panel-header-breadcrumb",
}: ChatPanelHeaderBreadcrumbProps): React.ReactNode {
  return (
    <span
      className="flex h-9 min-w-0 shrink items-center gap-1"
      data-testid={dataTestId}
    >
      {items.map((item, index) => {
        const isCurrent = currentItemKey
          ? item.key === currentItemKey
          : index === items.length - 1;
        return (
          <span key={item.key} className="flex min-w-0 items-center gap-1">
            {index > 0 ? (
              <ChevronRight
                size={DROPDOWN_ITEM.iconSize}
                strokeWidth={1.75}
                className="flex-shrink-0 text-fill-4"
              />
            ) : null}
            <ChatPanelHeaderBreadcrumbSegment
              item={item}
              isCurrent={isCurrent}
            />
          </span>
        );
      })}
      {trailing ? <span className="ml-1 shrink-0">{trailing}</span> : null}
    </span>
  );
}

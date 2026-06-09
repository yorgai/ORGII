/**
 * SpotlightSearchBar Component
 *
 * Search bar with action/value pills and a contextual input placeholder.
 * Backspace removes segments.
 */
import { Search } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import { ICONS } from "../config";
import type { PathSegment } from "../types";

// ============ PROPS ============

export interface SpotlightSearchBarProps {
  /** Ref for the input element */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Current search query */
  searchQuery: string;
  /** Handler for search query changes */
  onSearchQueryChange: (value: string) => void;
  /** Handler for keyboard events */
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Placeholder text */
  placeholder: string;
  /** Whether data is loading */
  isLoading?: boolean;
  /** Whether countdown is active */
  isCountingDown?: boolean;
  /** The navigation path (breadcrumb) */
  path: PathSegment[];
  /** Handler to remove a specific segment */
  onRemoveSegment?: (index: number) => void;
  /** Whether to hide the close button on the action segment */
  hideActionClose?: boolean;
  /** Whether to hide the trailing text input after path pills */
  hideInput?: boolean;
}

// ============ COMPONENT ============

export const SpotlightSearchBar: React.FC<SpotlightSearchBarProps> = ({
  inputRef,
  searchQuery,
  onSearchQueryChange,
  onKeyDown,
  placeholder,
  isLoading: _isLoading = false,
  isCountingDown = false,
  path,
  onRemoveSegment,
  hideActionClose = false,
  hideInput = false,
}) => {
  const { t } = useTranslation();

  const hasPills = path.length > 0;
  const displayIcon = ICONS.search;
  const IconComponent = typeof displayIcon === "string" ? null : displayIcon;

  const getSegmentLabel = (segment: PathSegment): string => {
    const data = segment.data as
      | { labelKey?: string; pillLabelKey?: string }
      | undefined;
    if (data?.pillLabelKey) return t(data.pillLabelKey);
    if (data?.labelKey) return t(data.labelKey);
    return segment.label;
  };

  const handlePillRemove = (
    index: number,
    event?: React.MouseEvent<HTMLElement>
  ) => {
    event?.preventDefault();
    event?.stopPropagation();
    onRemoveSegment?.(index);
  };

  const handleResetSearch = () => {
    onSearchQueryChange("");
    inputRef.current?.focus();
  };

  const renderCloseIcon = (onClick: () => void) => {
    const CloseIcon = ICONS.close;
    return (
      <button
        type="button"
        className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-primary-6 opacity-70 transition-opacity hover:opacity-100"
        aria-label={t("common:actions.close")}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
      >
        <CloseIcon size={13} strokeWidth={2.4} />
      </button>
    );
  };

  const renderPillIcon = (segment: PathSegment) => {
    if (typeof segment.icon === "function") {
      return React.createElement(
        segment.icon as React.ComponentType<{
          size?: number;
          className?: string;
        }>,
        {
          size: 14,
          className: "text-primary-6",
        }
      );
    }

    if (typeof segment.icon === "string") {
      return <i className={`${segment.icon} text-[14px] text-primary-6`} />;
    }

    return null;
  };

  return (
    <div className="spotlight-search-bar flex h-[56px] min-h-[56px] items-center gap-2 px-4">
      {!hasPills && (
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center">
          {IconComponent ? (
            <IconComponent size={18} className="text-text-2" />
          ) : typeof displayIcon === "string" ? (
            <i className={`${displayIcon} text-[18px] text-text-2`} />
          ) : (
            <Search className="text-text-2" size={18} />
          )}
        </div>
      )}

      {hasPills && (
        <div className="flex min-w-0 flex-shrink-0 items-center gap-2 text-[16px] text-text-1">
          {path.map((segment, index) => {
            const canRemove =
              !!onRemoveSegment &&
              (segment.type !== "action" || !hideActionClose);
            const label = getSegmentLabel(segment);
            return (
              <div
                key={`${segment.type}-${segment.id}`}
                className={`flex items-center gap-1 rounded-full bg-primary-1 px-2.5 py-1 text-primary-6 ${canRemove ? "cursor-pointer" : ""}`}
                onClick={
                  canRemove
                    ? (event) => handlePillRemove(index, event)
                    : undefined
                }
                title={label}
              >
                {renderPillIcon(segment)}
                <span className="max-w-[220px] truncate text-[16px] leading-5">
                  {label}
                </span>
                {canRemove &&
                  !isCountingDown &&
                  renderCloseIcon(() => handlePillRemove(index))}
              </div>
            );
          })}
        </div>
      )}

      {!hideInput && (
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-[16px] text-text-1 placeholder:text-text-1 focus:outline-none"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-spotlight-input="true"
        />
      )}

      {!hideInput && searchQuery && !isCountingDown && (
        <button
          type="button"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-text-3 transition-colors hover:bg-fill-2 hover:text-text-1"
          aria-label={t("common:actions.clearSearch")}
          onClick={handleResetSearch}
        >
          {React.createElement(ICONS.close, { size: 14 })}
        </button>
      )}
    </div>
  );
};

export default SpotlightSearchBar;

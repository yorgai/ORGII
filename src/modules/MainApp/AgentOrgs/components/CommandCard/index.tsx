/**
 * CommandCard Component
 *
 * Inline-style command card with:
 * 1. Inline title style (natural language with dropdowns/inputs)
 * 2. Two content styles:
 *    - Inline: Natural language sentences with inline dropdowns
 *    - Input box: TipTap-based for command-line inputs
 */
import cn from "classnames";
import { ChevronDown, ChevronUp, GitBranch, X } from "lucide-react";
import React, { useCallback, useMemo } from "react";

import type { ActionInput } from "../../data";
import { renderActionIcon } from "../../iconHelper";
import type { DropdownOption } from "../../types/workflow";
import { DEFAULT_TEMPLATE, INLINE_ACTION_CONFIGS } from "./configs";
import type { CommandCardProps } from "./types";

// ============================================
// Component
// ============================================

const CommandCard: React.FC<CommandCardProps> = ({
  definition,
  instance,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp = true,
  canMoveDown = true,
  isDragging,
  spotlightData,
  onClick,
}) => {
  // Determine background color based on card type and branch context
  const getBackgroundColor = (): string => {
    // IF cards always use primary with opacity (dark mode friendly)
    if (definition.type === "if") {
      return "bg-[color-mix(in_srgb,var(--color-primary-6)_10%,transparent)]";
    }
    // Loop cards always use warning with opacity (dark mode friendly)
    if (definition.type === "loop") {
      return "bg-[color-mix(in_srgb,var(--color-warning-6)_10%,transparent)]";
    }
    // Regular cards use different colors based on branch context
    const branchType = instance.branchType;
    if (branchType === "if-true") {
      return "bg-[color-mix(in_srgb,var(--color-success-6)_10%,transparent)]";
    }
    if (branchType === "if-false") {
      return "bg-[color-mix(in_srgb,var(--color-danger-6)_10%,transparent)]";
    }
    // Regular cards in loop body or at root level use fill-2
    return "bg-fill-2";
  };
  // Get value from instance data by key (index or name)
  const getValue = useCallback(
    (key: string | number): unknown => {
      if (typeof key === "number") {
        return instance.data[key] ?? definition.inputs?.[key]?.defaultValue;
      }
      // Find input by label match
      const inputIndex = definition.inputs?.findIndex(
        (input: ActionInput) =>
          input.label?.toLowerCase().replace(/\s+/g, "") === key.toLowerCase()
      );
      if (inputIndex !== undefined && inputIndex >= 0) {
        return (
          instance.data[inputIndex] ??
          definition.inputs?.[inputIndex]?.defaultValue
        );
      }
      return undefined;
    },
    [instance.data, definition.inputs]
  );

  // Get unit for a field
  const getUnit = useCallback(
    (key: string | number): string | undefined => {
      if (typeof key === "number") {
        return definition.inputs?.[key]?.unit;
      }
      const input = definition.inputs?.find(
        (inp: ActionInput) =>
          inp.label?.toLowerCase().replace(/\s+/g, "") === key.toLowerCase()
      );
      return input?.unit;
    },
    [definition.inputs]
  );

  // Handle value change
  const handleChange = useCallback(
    (key: string | number, value: unknown) => {
      let index: number;
      if (typeof key === "number") {
        index = key;
      } else {
        const foundIndex = definition.inputs?.findIndex(
          (input: ActionInput) =>
            input.label?.toLowerCase().replace(/\s+/g, "") === key.toLowerCase()
        );
        index = foundIndex ?? 0;
      }
      onUpdate({ ...instance.data, [index]: value });
    },
    [definition.inputs, instance.data, onUpdate]
  );

  // Build repo options
  const repoOptions: DropdownOption[] = useMemo(() => {
    if (!spotlightData?.repos) return [];
    return spotlightData.repos.map((repo) => ({
      label: repo.name,
      value: repo.id,
      icon: GitBranch as React.ComponentType<{
        size?: number;
        className?: string;
      }>,
      extra: repo,
    }));
  }, [spotlightData]);

  // Get the inline config for this action
  const inlineConfig =
    INLINE_ACTION_CONFIGS[definition.id] ||
    INLINE_ACTION_CONFIGS[definition.type] ||
    DEFAULT_TEMPLATE;

  // Template props
  const templateProps = {
    getValue,
    getUnit,
    onChange: handleChange,
    title: definition.title,
    repoOptions,
    spotlightData,
  };

  const bgColor = getBackgroundColor();

  return (
    <div
      className={cn(
        "group relative flex w-full flex-col rounded-xl transition-all hover:shadow-sm",
        bgColor,
        isDragging && "shadow-lg ring-2 ring-primary-6",
        onClick && "cursor-pointer"
      )}
      onClick={onClick}
    >
      {/* Header Row - Icon + Title/Inline + Action Buttons */}
      <div className="flex items-center gap-2 px-3 py-3">
        {/* Icon */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
          {renderActionIcon(definition.icon, {
            size: 14,
            className: "text-text-1",
          })}
        </div>

        {/* Title or Inline Template (if showInlineInHeader) */}
        {inlineConfig.showInlineInHeader ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-[15px]">
            {inlineConfig.template(templateProps)}
          </div>
        ) : (
          <div className="flex-1 text-[15px] font-semibold text-text-1">
            {definition.title}
          </div>
        )}

        {/* Action buttons */}
        <div className="invisible ml-auto flex shrink-0 items-center gap-0.5 group-hover:visible">
          {onMoveUp && (
            <button
              onClick={(event) => {
                event.stopPropagation();
                onMoveUp();
              }}
              disabled={!canMoveUp}
              className="flex h-7 w-7 items-center justify-center rounded-full text-text-2 transition-colors hover:bg-fill-2 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronUp size={16} />
            </button>
          )}
          {onMoveDown && (
            <button
              onClick={(event) => {
                event.stopPropagation();
                onMoveDown();
              }}
              disabled={!canMoveDown}
              className="flex h-7 w-7 items-center justify-center rounded-full text-text-2 transition-colors hover:bg-fill-2 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronDown size={16} />
            </button>
          )}
          <button
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
            className="flex h-7 w-7 items-center justify-center rounded-full text-text-2 transition-colors hover:bg-red-500/10 hover:text-red-500"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Inline Content Row (if template exists and NOT shown in header) */}
      {inlineConfig.template && !inlineConfig.showInlineInHeader && (
        <div className="flex flex-wrap items-center gap-1.5 pb-5 pl-5 pr-3 pt-2 text-[14px]">
          {inlineConfig.template(templateProps)}
        </div>
      )}
    </div>
  );
};

export default CommandCard;

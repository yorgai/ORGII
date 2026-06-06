/**
 * ContextInfoButton
 *
 * Circular progress ring in the chat input toolbar. Click opens a popover
 * showing context fill, a segmented breakdown bar, and per-category rows.
 *
 * Data strategy:
 *   - `liveBreakdown` arrives from Rust after the first `agent:complete`.
 *   - `rulesTokens` is always live (from `policies_list`).
 *   - Categories with no live data are hidden — no mock/placeholder values.
 */
import { Sparkles, X } from "lucide-react";
import React, { memo, useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { AppViewService } from "@src/services/app";

import ContextBreakdownBar from "./ContextBreakdownBar";
import ContextCategoryRow from "./ContextCategoryRow";
import ProgressRing from "./ProgressRing";
import {
  DANGER_THRESHOLD,
  type PanelCategory,
  WARNING_THRESHOLD,
} from "./contextInfoTypes";
import { useContextPanel } from "./useContextPanel";
import { formatTokenCount, useContextUsageInfo } from "./useContextUsageInfo";

export interface ContextInfoButtonProps {
  repoPath?: string;
  /**
   * "toolbar" — icon-only button (used in the right toolbar cluster).
   * "corner"  — icon + label pill anchored to the editor's bottom-right.
   */
  variant?: "toolbar" | "corner";
  /**
   * When true, the corner variant omits the text label and shows only the
   * progress ring. Use when horizontal space is tight (inline/compact row).
   */
  compact?: boolean;
}

const ContextInfoButton: React.FC<ContextInfoButtonProps> = memo(
  ({ repoPath, variant = "toolbar", compact = false }) => {
    const { t } = useTranslation();
    const {
      clampedPercentage,
      tokenLabel,
      rules,
      isPreview,
      maxTokens,
      liveBreakdown,
      rulesTokens,
    } = useContextUsageInfo(repoPath);

    const { panelPos, triggerRef, panelRef, toggle, close } = useContextPanel();
    const [hoveredKey, setHoveredKey] = useState<string | null>(null);

    // Build category list from live Rust data only.
    // Rules are always live; all other categories only appear after
    // the first agent:complete populates liveBreakdown.
    const categories: PanelCategory[] = useMemo(() => {
      const live = liveBreakdown;
      const all: PanelCategory[] = [
        {
          key: "systemPrompt",
          labelKey: "contextInfo.categories.systemPrompt",
          tokens: live?.systemPromptTokens ?? 0,
          hex: "#9ca3af",
        },
        {
          key: "tools",
          labelKey: "contextInfo.categories.tools",
          tokens: live?.toolsTokens ?? 0,
          hex: "#a78bfa",
        },
        {
          key: "rules",
          labelKey: "contextInfo.categories.rules",
          tokens: rulesTokens,
          hex: "#34d399",
        },
        {
          key: "skills",
          labelKey: "contextInfo.categories.skills",
          tokens: live?.skillsTokens ?? 0,
          hex: "#fbbf24",
        },
        {
          key: "mcp",
          labelKey: "contextInfo.categories.mcp",
          tokens: live?.mcpTokens ?? 0,
          hex: "#e879f9",
        },
        {
          key: "subagents",
          labelKey: "contextInfo.categories.subagents",
          tokens: live?.subagentTokens ?? 0,
          hex: "#60a5fa",
        },
        {
          key: "summarized",
          labelKey: "contextInfo.categories.summarized",
          tokens: live?.summaryTokens ?? 0,
          hex: "#f87171",
        },
        {
          key: "conversation",
          labelKey: "contextInfo.categories.conversation",
          tokens: live?.conversationTokens ?? 0,
          hex: "#fb923c",
        },
      ];
      return all.filter((cat) => cat.tokens > 0);
    }, [liveBreakdown, rulesTokens]);

    const isWarning =
      clampedPercentage >= WARNING_THRESHOLD &&
      clampedPercentage < DANGER_THRESHOLD;
    const isDanger = clampedPercentage >= DANGER_THRESHOLD;
    const showNewSessionCta =
      !isPreview && clampedPercentage >= WARNING_THRESHOLD;
    const fillLabel = isPreview
      ? t("contextInfo.estimatedFill", { pct: clampedPercentage.toFixed(0) })
      : `${clampedPercentage.toFixed(0)}% ${t("contextInfo.full")}`;

    const handleMouseEnter = useCallback(
      (key: string) => () => setHoveredKey(key),
      []
    );
    const handleMouseLeave = useCallback(() => setHoveredKey(null), []);

    const handleStartNewSession = useCallback(() => {
      close();
      void AppViewService.createAgentStationSession();
    }, [close]);

    const ringTone = isDanger ? "danger" : isWarning ? "warning" : "neutral";
    const cornerLabelClass = isDanger
      ? "text-danger-6"
      : isWarning
        ? "text-warning-6"
        : "text-text-1";

    return (
      <>
        {variant === "corner" ? (
          <button
            ref={triggerRef}
            data-testid="context-info-button"
            className={`flex h-[28px] shrink-0 items-center gap-1.5 rounded-full text-text-3 transition-colors duration-200 hover:bg-fill-2 ${compact ? "w-[28px] justify-center px-0" : "px-2"}`}
            onClick={toggle}
            aria-label={t("contextInfo.ariaLabel")}
            aria-expanded={panelPos !== null}
          >
            <ProgressRing percentage={clampedPercentage} tone={ringTone} />
            {!compact && (
              <span
                className={`text-[12px] tabular-nums leading-none ${cornerLabelClass}`}
              >
                {clampedPercentage.toFixed(0)}%
              </span>
            )}
          </button>
        ) : (
          <button
            ref={triggerRef}
            data-testid="context-info-button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-3 transition-colors duration-150 hover:bg-fill-2 hover:text-text-2"
            onClick={toggle}
            aria-label={t("contextInfo.ariaLabel")}
            aria-expanded={panelPos !== null}
          >
            <ProgressRing percentage={clampedPercentage} tone={ringTone} />
          </button>
        )}

        {panelPos &&
          createPortal(
            <div
              ref={panelRef}
              data-testid="context-info-panel"
              className="fixed z-[99999] w-[320px] overflow-hidden rounded-xl border border-border-2 bg-bg-2 shadow-2xl"
              style={{ bottom: panelPos.bottom, right: panelPos.right }}
            >
              {/* Header */}
              <div className="px-4 pb-3 pt-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-text-1">
                    {t("contextInfo.title")}
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[12px] font-semibold tabular-nums ${isDanger ? "text-danger-6" : isWarning ? "text-warning-6" : "text-text-1"}`}
                    >
                      {fillLabel}
                    </span>
                    <button
                      type="button"
                      onClick={close}
                      className="flex h-5 w-5 items-center justify-center rounded text-text-3 transition-colors hover:bg-fill-2 hover:text-text-2"
                      aria-label={t("common:actions.close")}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>

                <p className="mt-0.5 text-[11px] text-text-3">{tokenLabel}</p>

                <div className="mt-3">
                  <ContextBreakdownBar
                    categories={categories}
                    maxTokens={maxTokens}
                    hoveredKey={hoveredKey}
                  />
                </div>
              </div>

              {/* Category rows — only rendered when there is live data */}
              {categories.length > 0 && (
                <div className="px-4 py-2">
                  <div className="flex flex-col">
                    {categories.map((cat) => (
                      <ContextCategoryRow
                        key={cat.key}
                        categoryKey={cat.key}
                        label={t(cat.labelKey)}
                        tokens={cat.tokens}
                        hex={cat.hex}
                        isHovered={hoveredKey === cat.key}
                        onMouseEnter={handleMouseEnter(cat.key)}
                        onMouseLeave={handleMouseLeave}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Rules list */}
              {rules.length > 0 && (
                <div className="px-4 py-2.5">
                  <p className="mb-1.5 text-[11px] font-medium text-text-3">
                    {t("contextInfo.activeRules")}
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {rules.map((rule) => (
                      <div
                        key={rule.name}
                        data-testid="context-info-rule"
                        data-rule-name={rule.name}
                        data-rule-source={rule.source}
                        className="flex items-center justify-between rounded px-1 py-0.5 hover:bg-fill-2"
                      >
                        <span className="truncate text-[11px] text-text-2">
                          {rule.name}
                        </span>
                        {rule.estimatedTokens > 0 && (
                          <span className="ml-2 shrink-0 text-[11px] tabular-nums text-text-3">
                            ~{formatTokenCount(rule.estimatedTokens)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* New-session CTA when context is filling up */}
              {showNewSessionCta && (
                <div className="border-t border-border-2 px-4 py-3">
                  <p
                    className={`mb-2 text-[11px] leading-snug ${isDanger ? "text-danger-6" : "text-warning-6"}`}
                  >
                    {isDanger
                      ? t("contextInfo.dangerHint")
                      : t("contextInfo.warningHint")}
                  </p>
                  <button
                    type="button"
                    onClick={handleStartNewSession}
                    className={`flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                      isDanger
                        ? "hover:bg-danger-7 bg-danger-6 text-white"
                        : "bg-fill-2 text-text-1 hover:bg-fill-3"
                    }`}
                  >
                    <Sparkles size={12} />
                    {t("contextInfo.startNewSession")}
                  </button>
                </div>
              )}

              {/* Preview note */}
              {isPreview && (
                <div className="px-4 py-2">
                  <p className="text-[10px] text-text-4">
                    {t("contextInfo.previewNote")}
                  </p>
                </div>
              )}
            </div>,
            document.body
          )}
      </>
    );
  }
);

ContextInfoButton.displayName = "ContextInfoButton";

export default ContextInfoButton;

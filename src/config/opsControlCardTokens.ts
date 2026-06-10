/**
 * Shared shell + frame classes for Ops Control horizontal cards and overlays.
 */
import { INPUT_AREA } from "@src/config/inputAreaTokens";

export const OPS_CONTROL_CARD_SHELL =
  `rounded-[10px] ${INPUT_AREA.borderClass} ` +
  "transition-[border-color,box-shadow] duration-150 ease-in-out " +
  "[&:not(:focus-visible):hover]:border-border-3 " +
  "focus-visible:border-primary-6 focus-visible:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-primary-6)_15%,transparent)] " +
  "focus-visible:outline-none";

export const OPS_CONTROL_SESSION_CARD_CLASS = `${OPS_CONTROL_CARD_SHELL} flex h-[96px] w-[240px] shrink-0 flex-col justify-between px-4 py-3 text-left`;

export const OPS_CONTROL_GIT_SUGGESTION_CARD_CLASS = `${OPS_CONTROL_CARD_SHELL} flex h-[96px] w-[240px] shrink-0 flex-col justify-between px-3 py-2.5 text-left`;

export const OPS_CONTROL_AGENT_CARD_CLASS = `${OPS_CONTROL_CARD_SHELL} flex h-[76px] w-[160px] shrink-0 flex-col justify-between px-3 py-2.5 text-left`;

export function opsControlAddCardClass(size: "session" | "agent"): string {
  const dimensions =
    size === "session" ? "h-[96px] w-[240px]" : "h-[76px] w-[160px]";
  return `${OPS_CONTROL_CARD_SHELL} flex ${dimensions} shrink-0 items-center justify-center text-text-3`;
}

export const OPS_CONTROL_NEW_SESSION_CARD_CLASS =
  opsControlAddCardClass("session");

export const OPS_CONTROL_SESSION_CREATOR_MAX_WIDTH_CLASS = "max-w-[900px]";
export const OPS_CONTROL_SESSION_CREATOR_MIN_HEIGHT_CLASS = "min-h-[180px]";

export const OPS_CONTROL_SESSION_CREATOR_FLOW_CLASS = `mx-auto flex w-full ${OPS_CONTROL_SESSION_CREATOR_MAX_WIDTH_CLASS} ${OPS_CONTROL_SESSION_CREATOR_MIN_HEIGHT_CLASS} flex-col`;

export const OPS_CONTROL_SESSION_CREATOR_OVERLAY_CLASS =
  "pointer-events-none absolute inset-x-0 bottom-0 top-0 z-50 flex items-end bg-gradient-to-t from-bg-1/90 via-bg-1/55 to-transparent px-2 pb-2 pt-12";

export const OPS_CONTROL_SESSION_CREATOR_SURFACE_CLASS = `mx-auto w-full ${OPS_CONTROL_SESSION_CREATOR_MAX_WIDTH_CLASS} pointer-events-auto`;

export const OPS_CONTROL_SESSION_PREVIEW_OVERLAY_CLASS =
  "pointer-events-none absolute inset-x-0 bottom-0 top-0 z-[60] flex items-end px-2 pb-2 pt-1";

export const OPS_CONTROL_SESSION_PREVIEW_SURFACE_CLASS = `pointer-events-auto mx-auto flex h-full max-h-[600px] w-full ${OPS_CONTROL_SESSION_CREATOR_MAX_WIDTH_CLASS} flex-col overflow-hidden rounded-[12px] border border-border-2 bg-bg-2 shadow-2xl`;

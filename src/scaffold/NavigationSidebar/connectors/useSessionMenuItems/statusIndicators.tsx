import type { ReactNode } from "react";

export type StatusDotTone = "default" | "unread" | "asking";

export function renderBreathingStatusDot(): ReactNode {
  return (
    <span
      aria-label="Working"
      className="h-2 w-2 rounded-full bg-primary-6 ring-2 ring-primary-6/25 motion-safe:animate-[sidebar-working-dot-breathe_1.6s_ease-in-out_infinite] motion-reduce:opacity-80"
    >
      <style>{`
        @keyframes sidebar-working-dot-breathe {
          0%, 100% { opacity: 0.6; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </span>
  );
}

export function renderStatusDot(tone: StatusDotTone = "default"): ReactNode {
  const ariaLabel =
    tone === "unread"
      ? "Unread"
      : tone === "asking"
        ? "Pending question"
        : undefined;
  const colorClass =
    tone === "unread"
      ? "bg-success-6"
      : tone === "asking"
        ? "bg-warning-6"
        : "bg-fill-4";

  return (
    <span
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      className={`h-1.5 w-1.5 rounded-full ${colorClass}`}
    />
  );
}

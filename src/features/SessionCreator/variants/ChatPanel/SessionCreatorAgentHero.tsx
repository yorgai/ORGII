import { ChevronDown } from "lucide-react";
import React, { forwardRef, memo } from "react";

export interface SessionCreatorAgentHeroProps {
  name: string;
  description: string;
  avatarIcon: React.ReactNode;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}

const SessionCreatorAgentHero = memo(
  forwardRef<HTMLButtonElement, SessionCreatorAgentHeroProps>(
    (
      {
        name,
        description,
        avatarIcon,
        active = false,
        danger = false,
        onClick,
      },
      ref
    ) => {
      return (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          aria-expanded={active}
          data-testid="session-creator-agent-selector"
          className="flex w-full items-start gap-3 rounded-lg px-1 py-1 text-left transition-colors hover:bg-fill-2"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fill-2">
            {avatarIcon}
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex min-w-0 items-center gap-1">
              <span
                className={`truncate text-[15px] font-semibold leading-tight ${
                  danger ? "text-warning-6" : "text-text-1"
                }`}
              >
                {name}
              </span>
              <ChevronDown
                size={14}
                strokeWidth={2}
                className={`shrink-0 text-text-3 transition-transform ${
                  active ? "rotate-180" : ""
                }`}
              />
            </div>
            <p
              className="mt-1 truncate text-[12px] leading-snug text-text-3"
              title={description}
            >
              {description}
            </p>
          </div>
        </button>
      );
    }
  )
);

SessionCreatorAgentHero.displayName = "SessionCreatorAgentHero";

export default SessionCreatorAgentHero;

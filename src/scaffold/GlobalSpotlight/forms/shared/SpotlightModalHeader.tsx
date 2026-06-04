/**
 * SpotlightModalHeader
 *
 * Enhanced terminal-style modal header with status indicators
 */
import { type LucideIcon, X } from "lucide-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { getMaterialConfig } from "@src/components/Glass/config";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

interface SpotlightModalHeaderProps {
  icon: LucideIcon | string;
  title: string;
  badge?: string;
  badgeColor?: "primary" | "blue" | "green" | "yellow" | "red";
  statusText?: string;
  isLoading?: boolean;
  onClose: () => void;
  actions?: React.ReactNode;
  hideHeader?: boolean;
}

const SpotlightModalHeader: React.FC<SpotlightModalHeaderProps> = ({
  icon,
  title,
  badge,
  badgeColor = "primary",
  statusText,
  isLoading = false,
  onClose,
  actions,
  hideHeader = false,
}) => {
  const { t } = useTranslation();
  const { isDark } = useCurrentTheme();
  const materialConfig = useMemo(
    () => getMaterialConfig(isDark, "thick"),
    [isDark]
  );
  const iconBoxStyle = useMemo(
    () => ({
      backdropFilter: `blur(${materialConfig.blur}px)`,
      WebkitBackdropFilter: `blur(${materialConfig.blur}px)`,
      background: materialConfig.background,
      border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.18)"}`,
    }),
    [isDark, materialConfig.blur, materialConfig.background]
  );

  const badgeColorClasses = {
    primary: "border-primary-6/20 bg-primary-6/10 text-primary-6",
    blue: "border-blue-500/20 bg-blue-500/10 text-blue-400",
    green: "border-green-500/20 bg-green-500/10 text-green-400",
    yellow: "border-yellow-500/20 bg-yellow-500/10 text-yellow-400",
    red: "border-red-500/20 bg-red-500/10 text-red-400",
  };

  // Render icon - handle both Lucide components and string class names
  const IconComponent = typeof icon === "function" ? icon : null;

  if (hideHeader) return null;

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-4">
        <div
          className="spotlight-icon-box flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
          style={iconBoxStyle}
        >
          {IconComponent ? (
            <IconComponent className="text-text-1" size={18} />
          ) : (
            <i className={`${icon} text-[18px] text-text-1`} />
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold tracking-tight text-text-1">
              {title}
            </span>
            {badge && (
              <span
                className={`rounded-full border px-2 py-[1px] text-[10px] font-bold tracking-wide ${badgeColorClasses[badgeColor]}`}
              >
                {badge}
              </span>
            )}
          </div>
          {statusText && (
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span
                  className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${isLoading ? "bg-yellow-400" : "bg-green-400"}`}
                ></span>
                <span
                  className={`relative inline-flex h-2 w-2 rounded-full ${isLoading ? "bg-yellow-500" : "bg-green-500"}`}
                ></span>
              </span>
              <span className="text-[12px] font-medium text-text-2">
                {statusText}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {actions}
        {actions && (
          <div className="mx-2 h-5 w-[1px] bg-border-2 opacity-50"></div>
        )}
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-text-2 hover:border-red-500/20 hover:bg-red-500/10 hover:text-red-500"
          title={t("close")}
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
};

export default SpotlightModalHeader;

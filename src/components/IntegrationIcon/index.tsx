/**
 * IntegrationIcon Component
 *
 * Displays the appropriate SVG icon for integration types.
 * Brand integrations (Telegram, Discord, WhatsApp, Feishu, DingTalk,
 * GitHub, GitLab) use dedicated SVG brand icons.
 * Generic types (email, nodes) use Lucide.
 *
 * @example
 * ```tsx
 * <IntegrationIcon type="telegram" />
 * <IntegrationIcon type="github" size={20} />
 * <IntegrationIcon type="email" size={16} className="text-text-2" />
 * ```
 */
import { Mail, Network } from "lucide-react";
import React, { memo } from "react";

import { type BrandIntegrationType, INTEGRATION_ICON_MAP } from "./config";

// Re-export types
export type { BrandIntegrationType } from "./config";

// ============================================
// Types
// ============================================

export interface IntegrationIconProps {
  /** Integration type to display */
  type: string;
  /** Icon size in pixels (default: 16) */
  size?: number;
  /** Additional className */
  className?: string;
}

// ============================================
// Component
// ============================================

const IntegrationIcon: React.FC<IntegrationIconProps> = memo(
  ({ type, size = 16, className = "" }) => {
    // Lucide fallbacks for non-brand types
    if (type === "email") {
      return <Mail size={size} className={className} />;
    }
    if (type === "nodes") {
      return <Network size={size} className={className} />;
    }

    const Icon = INTEGRATION_ICON_MAP[type as BrandIntegrationType];

    // Fallback for unknown types
    if (!Icon) {
      return <Network size={size} className={`text-text-2 ${className}`} />;
    }

    return <Icon width={size} height={size} className={className} />;
  }
);

IntegrationIcon.displayName = "IntegrationIcon";

export default IntegrationIcon;

import type { LucideProps } from "lucide-react";
import { forwardRef } from "react";

import McpLogoSvg from "./mcp.svg";

/**
 * Model Context Protocol logo (Wikimedia) — matches Lucide icon usage in toolbars.
 */
export const McpLogoIcon = forwardRef<SVGSVGElement, LucideProps>(
  ({ size = 24, className, ...rest }, ref) => (
    <McpLogoSvg
      ref={ref}
      width={size}
      height={size}
      className={className}
      aria-hidden
      {...rest}
    />
  )
);

McpLogoIcon.displayName = "McpLogoIcon";

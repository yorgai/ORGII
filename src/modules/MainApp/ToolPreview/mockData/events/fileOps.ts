import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { createEvent } from "../shared";

export const fileOpsEvents: Record<string, SessionEvent> = {
  read_file: createEvent(
    "read_file",
    { path: "src/components/Button/index.tsx" },
    {
      success: true,
      content: `import React from "react";
import clsx from "clsx";
import "./Button.scss";

interface ButtonProps {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  onClick?: () => void;
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  disabled = false,
  onClick,
}: ButtonProps) {
  return (
    <button
      className={clsx(
        "btn",
        \`btn--\${variant}\`,
        \`btn--\${size}\`,
        disabled && "btn--disabled"
      )}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default Button;`,
      file_path: "src/components/Button/index.tsx",
    }
  ),

  edit_file: createEvent(
    "edit_file",
    {
      path: "src/config/settings.ts",
      old_string: "const DEBUG = false;",
      new_string: "const DEBUG = true;",
    },
    {
      success: true,
      diff: [
        "--- a/src/config/settings.ts",
        "+++ b/src/config/settings.ts",
        "@@ -1,32 +1,48 @@",
        " // Application settings",
        "-const DEBUG = false;",
        "-const LOG_LEVEL = 'warn';",
        "+const DEBUG = true;",
        "+const LOG_LEVEL = 'debug';",
        " ",
        " export const CONFIG = {",
        "   debug: DEBUG,",
        "-  logLevel: LOG_LEVEL,",
        "+  logLevel: LOG_LEVEL as LogLevel,",
        "   maxRetries: 3,",
        "   timeout: 5000,",
        "+  requestTimeout: 30000,",
        "+  connectionPoolSize: 10,",
        " };",
        " ",
        "-// Feature flags",
        "-export const FEATURES = {",
        "-  darkMode: false,",
        "-  notifications: true,",
        "-  analytics: false,",
        "+// Feature flags with environment override support",
        "+type FeatureFlag = { enabled: boolean; rollout?: number };",
        "+",
        "+export const FEATURES: Record<string, FeatureFlag> = {",
        "+  darkMode: { enabled: true, rollout: 100 },",
        "+  notifications: { enabled: true, rollout: 100 },",
        "+  analytics: { enabled: true, rollout: 50 },",
        "+  betaEditor: { enabled: false, rollout: 0 },",
        "+  experimentalCache: { enabled: false, rollout: 10 },",
        " };",
        " ",
        "-// Validation",
        "-export function validateConfig(config: typeof CONFIG) {",
        "-  if (config.timeout < 0) throw new Error('invalid timeout');",
        "-  if (config.maxRetries < 0) throw new Error('invalid retries');",
        "+// Validation with detailed error reporting",
        "+export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';",
        "+",
        "+interface ValidationResult {",
        "+  valid: boolean;",
        "+  errors: string[];",
        "+}",
        "+",
        "+export function validateConfig(config: typeof CONFIG): ValidationResult {",
        "+  const errors: string[] = [];",
        "+  if (config.timeout < 0) errors.push('timeout must be non-negative');",
        "+  if (config.maxRetries < 0) errors.push('maxRetries must be non-negative');",
        "+  if (config.requestTimeout < config.timeout) {",
        "+    errors.push('requestTimeout must be >= timeout');",
        "+  }",
        "+  if (config.connectionPoolSize < 1 || config.connectionPoolSize > 100) {",
        "+    errors.push('connectionPoolSize must be between 1 and 100');",
        "+  }",
        "+  return { valid: errors.length === 0, errors };",
        " }",
      ].join("\n"),
      file_path: "src/config/settings.ts",
      lines_added: 24,
      lines_removed: 12,
    }
  ),

  apply_patch: createEvent(
    "apply_patch",
    {
      patch_text: [
        "*** Begin Patch",
        "*** Add File: src/utils/dateFormat.ts",
        "+import { padStart } from './strings';",
        "+",
        "+export function formatDate(date: Date): string {",
        "+  return date.toISOString().split('T')[0];",
        "+}",
        "+",
        "+export function formatRelative(date: Date): string {",
        "+  const diff = Date.now() - date.getTime();",
        "+  const seconds = Math.floor(diff / 1000);",
        "+  if (seconds < 60) return 'just now';",
        "+  const minutes = Math.floor(seconds / 60);",
        "+  if (minutes < 60) return `${minutes}m ago`;",
        "+  const hours = Math.floor(minutes / 60);",
        "+  return `${hours}h ago`;",
        "+}",
        "*** Modify File: src/config/settings.ts",
        " // Application settings",
        "-const DEBUG = false;",
        "+const DEBUG = true;",
        " ",
        "-const LOG_LEVEL = 'warn';",
        "+const LOG_LEVEL = 'debug';",
        " ",
        " export const CONFIG = {",
        "*** Modify File: src/hooks/useSession.ts",
        " import { useEffect, useState } from 'react';",
        "+import { formatRelative } from '../utils/dateFormat';",
        " ",
        " export function useSession(id: string) {",
        "   const [session, setSession] = useState(null);",
        "+  const [lastActive, setLastActive] = useState('');",
        " ",
        "   useEffect(() => {",
        "-    fetchSession(id).then(setSession);",
        "+    fetchSession(id).then((data) => {",
        "+      setSession(data);",
        "+      setLastActive(formatRelative(data.updatedAt));",
        "+    });",
        "   }, [id]);",
        " ",
        "-  return { session };",
        "+  return { session, lastActive };",
        " }",
        "*** Delete File: src/deprecated/legacyDateUtils.ts",
        "*** Modify File: src/components/SessionCard.tsx",
        " import type { Session } from '../types';",
        "+import { useSession } from '../hooks/useSession';",
        " ",
        " interface SessionCardProps {",
        "   session: Session;",
        "+  showLastActive?: boolean;",
        " }",
        " ",
        "-export function SessionCard({ session }: SessionCardProps) {",
        "+export function SessionCard({ session, showLastActive }: SessionCardProps) {",
        "+  const { lastActive } = useSession(session.id);",
        " ",
        "   return (",
        '     <div className="card">',
        "       <h3>{session.name}</h3>",
        '+      {showLastActive && <span className="text-muted">{lastActive}</span>}',
        "     </div>",
        "   );",
        " }",
        "*** End Patch",
      ].join("\n"),
    },
    {
      success: true,
      content:
        "Patch applied successfully (1 added, 3 modified, 1 deleted — 5 files)",
    }
  ),

  delete_file: createEvent(
    "delete_file",
    { path: "src/deprecated/oldComponent.tsx" },
    {
      success: true,
      message: "File deleted successfully",
      file_path: "src/deprecated/oldComponent.tsx",
    }
  ),

  list_dir: createEvent(
    "list_dir",
    { path: "src/components" },
    {
      success: true,
      entries: [
        { name: "Button", type: "directory" },
        { name: "Checkbox", type: "directory" },
        { name: "Dropdown", type: "directory" },
        { name: "ExpandOverlay.tsx", type: "file" },
        { name: "FileTypeIcon", type: "directory" },
        { name: "FloatingExpandPill.tsx", type: "file" },
        { name: "InlineAlert", type: "directory" },
        { name: "Input", type: "directory" },
        { name: "Modal", type: "directory" },
        { name: "ModelIcon", type: "directory" },
        { name: "Radio", type: "directory" },
        { name: "SearchInput", type: "directory" },
        { name: "Select", type: "directory" },
        { name: "Spinner.tsx", type: "file" },
        { name: "Switch", type: "directory" },
        { name: "Tabs", type: "directory" },
        { name: "TerminalDisplay", type: "directory" },
        { name: "Tooltip", type: "directory" },
        { name: "index.ts", type: "file" },
      ],
      path: "src/components",
    }
  ),

  manage_workspace: createEvent(
    "manage_workspace",
    { action: "list" },
    {
      success: true,
      content: [
        "Workspaces (20):",
        "[git] orgii_frontend → /Users/developer/Documents/GitHub/orgii_frontend",
        "[git] orgii_backend → /Users/developer/Documents/GitHub/orgii_backend",
        "[git] design-system → /Users/developer/Documents/GitHub/design-system",
        "[git] marketplace-api → /Users/developer/Work/marketplace-api",
        "[git] agent-core → /Users/developer/Documents/GitHub/agent-core",
        "[git] infra-terraform → /Users/developer/Work/infra-terraform",
        "[git] docs-site → /Users/developer/Documents/GitHub/docs-site",
        "[git] mobile-app → /Users/developer/Documents/GitHub/mobile-app",
        "[git] shared-utils → /Users/developer/Documents/GitHub/shared-utils",
        "[git] auth-service → /Users/developer/Work/microservices/auth-service",
        "[git] payment-gateway → /Users/developer/Work/microservices/payment-gateway",
        "[git] notification-hub → /Users/developer/Work/microservices/notification-hub",
        "[git] e2e-tests → /Users/developer/Documents/GitHub/e2e-tests",
        "[git] cli-tools → /Users/developer/Documents/GitHub/cli-tools",
        "[git] data-pipeline → /Users/developer/Work/data-pipeline",
        "[folder] scratch-pad → /Users/developer/Desktop/scratch-pad",
        "[folder] meeting-notes → /Users/developer/Documents/meeting-notes",
        "[folder] prototypes → /Users/developer/Desktop/prototypes",
        "[folder] vendor-sdks → /Users/developer/Work/vendor-sdks",
        "[folder] config-backups → /Users/developer/.config/backups",
      ].join("\n"),
    }
  ),
};

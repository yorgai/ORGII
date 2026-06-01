/**
 * ApprovalPreview — standalone PermissionCard for DevTools playground.
 *
 * Reuses PermissionCardBody for all rendering. Maps SessionEvent
 * fields to the shared component's props.
 */
import { useTranslation } from "react-i18next";

import { PermissionCardBody } from "@src/engines/ChatPanel/InputArea/PermissionCard/PermissionCardBody";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

interface ApprovalPreviewProps {
  event: SessionEvent;
  collapsed?: boolean;
  onCollapse?: () => void;
}

export function ApprovalPreview({
  event,
  collapsed,
  onCollapse,
}: ApprovalPreviewProps) {
  const { t } = useTranslation("sessions");
  const args = event.args;

  const toolName = (args.tool_name as string) || "execute_shell_command";
  const description = (args.description as string) || "";

  const isCommandConfirm = toolName === "exec:command-confirm";
  const commandText =
    isCommandConfirm && typeof args.command === "string" ? args.command : null;

  const argsPreview = isCommandConfirm
    ? []
    : Object.entries(args)
        .filter(([key]) => key !== "tool_name" && key !== "description")
        .slice(0, 5)
        .map(([key, value]) => {
          const strValue =
            typeof value === "string" ? value : JSON.stringify(value);
          const truncated =
            strValue.length > 120 ? `${strValue.slice(0, 120)}...` : strValue;
          return { key, value: truncated };
        });

  return (
    <PermissionCardBody
      label={
        isCommandConfirm
          ? t("chat.commandConfirmTitle", "Command Requires Approval")
          : t("chat.permissionPrompt", "Your permission is needed")
      }
      badge={
        !isCommandConfirm && toolName ? (
          <span className="text-[10px] text-text-3">{toolName}</span>
        ) : undefined
      }
      commandText={commandText}
      description={description || null}
      argsPreview={argsPreview}
      collapsed={collapsed}
      onCollapse={onCollapse}
    />
  );
}

import { FileCode2 } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import {
  type SessionFileChange,
  TOOL_ICONS,
  TOOL_LABEL_I18N_KEYS,
} from "../types";

interface SessionFileRowProps {
  file: SessionFileChange;
}

const SessionFileRow: React.FC<SessionFileRowProps> = ({ file }) => {
  const { t } = useTranslation("projects");
  const ToolIcon = TOOL_ICONS[file.tool] ?? FileCode2;
  const toolLabel = TOOL_LABEL_I18N_KEYS[file.tool]
    ? t(TOOL_LABEL_I18N_KEYS[file.tool])
    : file.tool;
  const fileName = file.path.split("/").pop() ?? file.path;
  const dirPath = file.path.includes("/")
    ? file.path.slice(0, file.path.lastIndexOf("/") + 1)
    : "";

  return (
    <div
      className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-fill-2"
      title={file.path}
    >
      <ToolIcon size={12} className="shrink-0 text-text-4" />
      <div className="flex min-w-0 flex-1 items-center gap-1 text-[11px]">
        {dirPath && <span className="truncate text-text-4">{dirPath}</span>}
        <span className="shrink-0 font-medium text-text-1">{fileName}</span>
      </div>
      <span className="shrink-0 rounded bg-fill-2 px-1.5 py-px text-[9px] font-medium text-text-3">
        {toolLabel}
        {file.count > 1 && ` ×${file.count}`}
      </span>
    </div>
  );
};

export default SessionFileRow;

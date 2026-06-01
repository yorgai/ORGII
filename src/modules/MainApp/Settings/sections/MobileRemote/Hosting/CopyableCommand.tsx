/**
 * CopyableCommand
 *
 * Single-line shell command rendered in a compact box with a copy
 * button. Used in the relay hosting picker to give the user one-click
 * copy of the exact command they need to run in a terminal. Uses the
 * default UI font (per the workspace rule against monospace) and
 * relies on `pre` semantics + a fixed-character feel via `tracking-tight`.
 */
import { Check, Copy } from "lucide-react";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { copyText } from "@src/util/data/clipboard";

interface CopyableCommandProps {
  command: string;
  /** Optional aria label override for the copy button. */
  ariaLabel?: string;
}

const CopyableCommand: React.FC<CopyableCommandProps> = ({
  command,
  ariaLabel,
}) => {
  const { t } = useTranslation("settings");
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopy = useCallback(async () => {
    try {
      await copyText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, [command]);

  return (
    <div className="flex items-stretch gap-2 rounded-md border border-border-2 bg-fill-1 p-1.5">
      <pre className="m-0 flex-1 self-center overflow-x-auto whitespace-pre px-2 py-1 text-xs leading-relaxed tracking-tight text-text-1">
        {command}
      </pre>
      <Button
        size="small"
        appearance="ghost"
        icon={copied ? <Check size={14} /> : <Copy size={14} />}
        iconOnly
        onClick={handleCopy}
        title={ariaLabel ?? t("mobileRemote.hosting.copyCommand")}
      />
    </div>
  );
};

export default CopyableCommand;

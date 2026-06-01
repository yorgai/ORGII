/**
 * Codex TOML Editor
 *
 * CodeMirror-based editor for raw `~/.codex/config.toml` editing.
 * Shown when the user toggles from UI to TOML view in the Codex
 * CLI agent detail panel.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { rpc } from "@src/api/tauri/rpc";
import { CodeMirrorEditor } from "@src/features/CodeMirror";
import { PanelFooter } from "@src/modules/shared/layouts/blocks";

interface CodexTomlEditorProps {
  onSaved?: () => void;
}

const CodexTomlEditor: React.FC<CodexTomlEditorProps> = ({ onSaved }) => {
  const { t } = useTranslation("integrations");

  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [savedContent, setSavedContent] = useState("");
  const [configPath, setConfigPath] = useState("");
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const path = await rpc.agentOrgs.codex.getPath();
      if (cancelled) return;
      setConfigPath(path);

      const json = await rpc.agentOrgs.codex.readConfig();
      if (cancelled) return;

      if (Object.keys(json).length === 0) {
        setContent("");
        setSavedContent("");
      } else {
        const raw = await rpc.agentOrgs.codex.readRaw();
        if (cancelled) return;
        setContent(raw);
        setSavedContent(raw);
      }
      setLoading(false);
    };
    load().catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const hasChanges = content !== savedContent;

  const handleChange = useCallback((value: string) => {
    setContent(value);
    setErrorMessage(null);
    setSaveStatus("idle");
  }, []);

  const handleSave = useCallback(async () => {
    setSaveStatus("saving");
    setErrorMessage(null);
    try {
      await rpc.agentOrgs.codex.writeRaw({ content });
      setSavedContent(content);
      setSaveStatus("saved");
      onSaved?.();
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setSaveStatus("error");
    }
  }, [content, onSaved]);

  const handleReset = useCallback(() => {
    setContent(savedContent);
    setErrorMessage(null);
    setSaveStatus("idle");
  }, [savedContent]);

  if (loading) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1">
        <CodeMirrorEditor
          value={content}
          onChange={handleChange}
          filePath="config.toml"
          height="100%"
        />
      </div>

      <PanelFooter
        left={
          <>
            <div className="text-xs text-text-3">{configPath}</div>
            <div className="flex items-center gap-2 text-xs">
              {saveStatus === "saved" && (
                <span className="text-success-6">
                  {t("common:status.saved", "Saved")}
                </span>
              )}
              {errorMessage && (
                <span className="max-w-[300px] truncate text-danger-6">
                  {errorMessage}
                </span>
              )}
            </div>
          </>
        }
        secondaryActions={
          hasChanges
            ? [{ label: t("common:actions.cancel"), onClick: handleReset }]
            : undefined
        }
        primaryAction={{
          label:
            saveStatus === "saving"
              ? t("common:actions.save") + "..."
              : t("common:actions.save"),
          onClick: handleSave,
          disabled: !hasChanges || saveStatus === "saving",
        }}
      />
    </div>
  );
};

export default CodexTomlEditor;

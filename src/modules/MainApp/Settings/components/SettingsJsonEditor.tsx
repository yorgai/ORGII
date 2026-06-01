/**
 * Settings JSON Editor
 *
 * CodeMirror-based JSONC editor for raw settings editing.
 * Shown when the user toggles from GUI to JSON view.
 */
import { useAtomValue, useSetAtom } from "jotai";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { rpc } from "@src/api/tauri/rpc";
import InlineAlert from "@src/components/InlineAlert";
import {
  generateJsoncContent,
  validateSettings,
} from "@src/config/settingsSchema";
import { CodeMirrorEditor } from "@src/features/CodeMirror";
import { PanelFooter } from "@src/modules/shared/layouts/blocks";
import { handleExternalChangeAtom, settingsAtom } from "@src/store/settings";

const SettingsJsonEditor: React.FC = () => {
  const { t } = useTranslation("settings");
  const settings = useAtomValue(settingsAtom);
  const handleExternalChange = useSetAtom(handleExternalChangeAtom);
  const [isScopeAlertVisible, setIsScopeAlertVisible] = useState(true);

  // Derive the JSONC content from settings (recalculated when settings change)
  const settingsJsonc = useMemo(
    () => generateJsoncContent(settings),
    [settings]
  );
  const savedContentRef = useRef(settingsJsonc);

  useEffect(() => {
    savedContentRef.current = settingsJsonc;
  }, [settingsJsonc]);

  // Track the settings-derived content that's been "synced" to the editor.
  // When settingsJsonc changes, we detect the mismatch during render and
  // reset the editor — no synchronous setState inside useEffect needed.
  const [editorState, setEditorState] = useState(() => ({
    syncedJsonc: settingsJsonc,
    content: settingsJsonc,
  }));

  // When settings change externally, reset editor to the new content
  if (editorState.syncedJsonc !== settingsJsonc) {
    setEditorState({ syncedJsonc: settingsJsonc, content: settingsJsonc });
  }

  const editorContent = editorState.content;
  const hasChanges = editorContent !== settingsJsonc;

  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [settingsPath, setSettingsPath] = useState<string>("");

  // Get the file path for display
  useEffect(() => {
    let cancelled = false;
    rpc.settings
      .getPath()
      .then((path) => {
        if (!cancelled) setSettingsPath(path);
      })
      .catch((err) => {
        console.warn("[SettingsJsonEditor] rpc.settings.getPath failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isScopeAlertVisible) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setIsScopeAlertVisible(false);
    }, 10_000);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [isScopeAlertVisible]);

  const handleChange = useCallback((value: string) => {
    setEditorState((prev) => ({ ...prev, content: value }));
    setErrorMessage(null);
    setSaveStatus("idle");
  }, []);

  const handleSave = useCallback(async () => {
    setSaveStatus("saving");
    setErrorMessage(null);

    try {
      // Parse and validate before saving
      // Strip comments for JSON parsing (basic approach)
      const jsonStr = editorContent
        .replace(/\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      const parsed = JSON.parse(jsonStr);
      const validated = validateSettings(parsed);

      // Per-agent knobs (`agent.os.*`, `agent.sde.*`) are NOT mirrored
      // here on purpose — the AgentDefinition store (`agent_definitions/`)
      // is the single source of truth for those, edited from AgentOrgs /
      // Settings → Agent tab. settings.jsonc only owns the keys that have
      // a Zod schema definition.
      await rpc.settings.write({ content: editorContent });

      // Update the in-memory atom with validated values
      handleExternalChange(validated as unknown as Record<string, unknown>);

      savedContentRef.current = editorContent;
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      const message =
        err instanceof SyntaxError
          ? t("jsonView.invalidJson", { detail: err.message })
          : String(err);
      setErrorMessage(message);
      setSaveStatus("error");
    }
  }, [editorContent, handleExternalChange, t]);

  const handleReset = useCallback(() => {
    setEditorState((prev) => ({ ...prev, content: savedContentRef.current }));
    setErrorMessage(null);
    setSaveStatus("idle");
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {isScopeAlertVisible && (
        <div className="border-b border-border-2 p-3">
          <InlineAlert
            type="info"
            title={t("jsonView.scopeTitle")}
            onClose={() => setIsScopeAlertVisible(false)}
            closeAriaLabel={t("common:actions.close")}
          >
            <p>{t("jsonView.scopeDescription")}</p>
            <p>{t("jsonView.notCovered")}</p>
          </InlineAlert>
        </div>
      )}
      {/* CodeMirror Editor */}
      <div className="min-h-0 flex-1">
        <CodeMirrorEditor
          value={editorContent}
          onChange={handleChange}
          language="json"
          filePath="settings.jsonc"
          height="100%"
        />
      </div>

      <PanelFooter
        left={
          <>
            <div className="text-xs text-text-3">{settingsPath}</div>
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

export default SettingsJsonEditor;

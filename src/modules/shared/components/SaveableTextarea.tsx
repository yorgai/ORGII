/**
 * SaveableTextarea
 *
 * Reusable textarea with draft state, cancel/save actions, and status feedback.
 * Supports both sync and async onSave callbacks.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Textarea from "@src/components/Textarea";
import { useKeyboardSave } from "@src/hooks/keyboard";
import { Placeholder } from "@src/modules/shared/layouts/blocks";

export interface SaveableTextareaProps {
  /** Current saved value */
  value: string;
  /** Called when user clicks Save. Can be async (shows saving/error states). */
  onSave: (value: string) => void | Promise<void>;
  placeholder?: string;
  /** Auto-size config for the textarea */
  autoSize?: { minRows?: number; maxRows?: number };
  /** Whether the component is in a loading state (hides content) */
  loading?: boolean;
  dataTestId?: string;
  saveButtonDataTestId?: string;
}

const SaveableTextarea: React.FC<SaveableTextareaProps> = ({
  value,
  onSave,
  placeholder,
  autoSize = { minRows: 3, maxRows: 10 },
  loading = false,
  dataTestId,
  saveButtonDataTestId,
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">(
    "idle"
  );

  // Sync draft when saved value changes externally
  const prevValueRef = useRef(value);

  useEffect(() => {
    if (prevValueRef.current !== value) {
      prevValueRef.current = value;
      setDraft(value);
    }
  }, [value]);

  const hasChanges = draft !== value;

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveStatus("idle");

    try {
      await onSave(draft);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err: unknown) {
      console.error("[SaveableTextarea] Save failed:", err);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } finally {
      setSaving(false);
    }
  }, [draft, onSave]);

  const handleCancel = useCallback(() => {
    setDraft(value);
  }, [value]);

  useKeyboardSave(handleSave, hasChanges && !saving);

  if (loading) return <Placeholder variant="loading" />;

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={draft}
        onChange={(val: string) => setDraft(val)}
        placeholder={placeholder}
        autoSize={autoSize}
        data-testid={dataTestId}
      />
      <div className="flex items-center gap-2">
        {hasChanges && (
          <Button size="default" onClick={handleCancel} disabled={saving}>
            {t("actions.cancel")}
          </Button>
        )}
        <Button
          size="default"
          variant="primary"
          onClick={handleSave}
          disabled={!hasChanges || saving}
          data-testid={saveButtonDataTestId}
        >
          {saving ? t("status.saving") : t("actions.save")}
        </Button>
        {saveStatus === "saved" && (
          <span className="text-xs text-success-6">{t("status.saved")}</span>
        )}
        {saveStatus === "error" && (
          <span className="text-xs text-danger-6">
            {t("status.saveFailed")}
          </span>
        )}
      </div>
    </div>
  );
};

export default SaveableTextarea;

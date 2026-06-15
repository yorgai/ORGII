/**
 * UploadTrigger
 *
 * Renders the upload trigger area: drag zone, picture-card button, or default button.
 * Extracted from Upload/index.tsx to keep the main file under 600 lines.
 */
import { Plus, UploadCloud, Upload as UploadIcon } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import {
  createKeyboardActivationHandler,
  getInteractiveTabIndex,
} from "@src/util/dom/keyboardActivation";

interface UploadTriggerProps {
  children?: React.ReactNode;
  drag?: boolean;
  listType?: "text" | "picture" | "picture-card";
  disabled?: boolean;
  accept?: string;
  onDragEnter: (event: React.DragEvent) => void;
  onDragLeave: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
  onClick: () => void;
}

export function UploadTrigger({
  children,
  drag,
  listType,
  disabled,
  accept,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onClick,
}: UploadTriggerProps) {
  const { t } = useTranslation("common");

  if (children) {
    return (
      <Button
        appearance="ghost"
        variant="tertiary"
        className="upload-trigger-custom"
        onClick={onClick}
        disabled={disabled}
      >
        {children}
      </Button>
    );
  }

  if (drag) {
    return (
      <div
        className="upload-drag-area"
        role="button"
        tabIndex={getInteractiveTabIndex(Boolean(disabled))}
        aria-disabled={disabled}
        onClick={disabled ? undefined : onClick}
        onKeyDown={
          disabled ? undefined : createKeyboardActivationHandler(onClick)
        }
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <UploadCloud size={24} />
        <p className="upload-drag-text">{t("uploadZone.clickOrDrag")}</p>
        {accept && (
          <p className="upload-drag-hint">
            {t("uploadZone.supportFormats", { accept })}
          </p>
        )}
      </div>
    );
  }

  if (listType === "picture-card") {
    return (
      <div
        className="upload-picture-card-trigger"
        role="button"
        tabIndex={getInteractiveTabIndex(Boolean(disabled))}
        aria-disabled={disabled}
        onClick={disabled ? undefined : onClick}
        onKeyDown={
          disabled ? undefined : createKeyboardActivationHandler(onClick)
        }
      >
        <Plus size={24} />
        <div>{t("actions.upload")}</div>
      </div>
    );
  }

  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      icon={<UploadIcon size={16} />}
    >
      {t("actions.upload")}
    </Button>
  );
}

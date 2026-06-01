/**
 * UploadTrigger
 *
 * Renders the upload trigger area: drag zone, picture-card button, or default button.
 * Extracted from Upload/index.tsx to keep the main file under 600 lines.
 */
import { Plus, UploadCloud, Upload as UploadIcon } from "lucide-react";
import React from "react";

import Button from "@src/components/Button";

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
  if (children) {
    return <div onClick={onClick}>{children}</div>;
  }

  if (drag) {
    return (
      <div
        className="upload-drag-area"
        onClick={onClick}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <UploadCloud size={24} />
        <p className="upload-drag-text">
          Click or drag file to this area to upload
        </p>
        {accept && <p className="upload-drag-hint">Support: {accept}</p>}
      </div>
    );
  }

  if (listType === "picture-card") {
    return (
      <div className="upload-picture-card-trigger" onClick={onClick}>
        <Plus size={24} />
        <div>Upload</div>
      </div>
    );
  }

  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      icon={<UploadIcon size={16} />}
    >
      Upload
    </Button>
  );
}

/**
 * UploadFileList
 *
 * Renders the file list for "text", "picture", and "picture-card" display modes.
 * Extracted from Upload/index.tsx to keep the main file under 600 lines.
 */
import { FileCheck, FileText, Trash2, X } from "lucide-react";

import type { UploadFile } from "@src/components/Upload/types";

interface UploadFileListProps {
  fileList: UploadFile[];
  listType?: "text" | "picture" | "picture-card";
  showUploadList?: boolean;
  onRemove: (file: UploadFile) => void;
}

export function UploadFileList({
  fileList,
  listType,
  showUploadList,
  onRemove,
}: UploadFileListProps) {
  if (!showUploadList || fileList.length === 0) return null;

  if (listType === "picture-card") {
    return (
      <div className="upload-list upload-list-picture-card">
        {fileList.map((file) => (
          <div key={file.uid} className="upload-list-item">
            {file.url && (
              <img
                src={file.url}
                alt={file.name}
                className="upload-list-item-thumbnail"
              />
            )}
            <div className="upload-list-item-info">
              <span className="upload-list-item-name">{file.name}</span>
            </div>
            {file.status === "uploading" && (
              <div
                className="upload-list-item-progress"
                style={{ width: `${file.percent}%` }}
              />
            )}
            <div className="upload-list-item-actions">
              <button onClick={() => onRemove(file)}>
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="upload-list">
      {fileList.map((file) => (
        <div
          key={file.uid}
          className={`upload-list-item upload-list-item-${file.status}`}
        >
          {listType === "picture" && file.url && (
            <img
              src={file.url}
              alt={file.name}
              className="upload-list-item-thumbnail"
            />
          )}
          {file.status === "done" ? (
            <FileCheck size={16} className="upload-list-item-icon" />
          ) : (
            <FileText size={16} className="upload-list-item-icon" />
          )}
          <span className="upload-list-item-name">{file.name}</span>
          {file.status === "uploading" && (
            <span className="upload-list-item-percent">{file.percent}%</span>
          )}
          {file.status === "error" && (
            <span className="upload-list-item-error">{file.error}</span>
          )}
          <button
            className="upload-list-item-remove"
            onClick={() => onRemove(file)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

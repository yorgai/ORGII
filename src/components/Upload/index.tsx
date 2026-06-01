/**
 * Upload Component
 *
 * Native file upload with drag & drop support.
 *
 * Features:
 * - File selection (click + drag-drop)
 * - Progress tracking
 * - File validation (size, type)
 * - Image preview
 * - Multiple files support
 * - Custom request handler
 * - Before upload hook
 * - File list management
 * - Multiple display styles
 *
 * @example
 * ```tsx
 * import Upload from "@src/components/Upload";
 *
 * <Upload
 *   action="/api/upload"
 *   accept="image/*"
 *   multiple
 *   onChange={(fileList) => {}}
 * />
 *
 * // With custom request
 * <Upload
 *   customRequest={async ({ file, onProgress, onSuccess, onError }) => {
 *     // Custom upload logic
 *   }}
 * />
 * ```
 */
import React, { useCallback, useEffect, useRef, useState } from "react";

import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import { UploadFileList } from "./UploadFileList";
import { UploadTrigger } from "./UploadTrigger";
import "./index.scss";
import type { CustomRequestOptions, UploadFile } from "./types";

export type { CustomRequestOptions, UploadFile } from "./types";

export interface UploadProps {
  /**
   * Upload endpoint URL
   */
  action?: string;

  /**
   * Accept file types
   */
  accept?: string;

  /**
   * Multiple files
   * @default false
   */
  multiple?: boolean;

  /**
   * Max file count
   */
  maxCount?: number;

  /**
   * Max file size (bytes)
   */
  maxSize?: number;

  /**
   * File list (controlled)
   */
  fileList?: UploadFile[];

  /**
   * Default file list (uncontrolled)
   */
  defaultFileList?: UploadFile[];

  /**
   * Before upload hook
   */
  beforeUpload?: (file: File) => boolean | Promise<boolean>;

  /**
   * Custom request handler
   */
  customRequest?: (options: CustomRequestOptions) => void;

  /**
   * File list change callback
   */
  onChange?: (fileList: UploadFile[]) => void;

  /**
   * Remove file callback
   */
  onRemove?: (file: UploadFile) => void;

  /**
   * Upload progress callback
   */
  onProgress?: (percent: number, file: UploadFile) => void;

  /**
   * Upload success callback
   */
  onSuccess?: (response: unknown, file: UploadFile) => void;

  /**
   * Upload error callback
   */
  onError?: (error: Error, file: UploadFile) => void;

  /**
   * Display style
   * @default 'text'
   */
  listType?: "text" | "picture" | "picture-card";

  /**
   * Disabled state
   */
  disabled?: boolean;

  /**
   * Drag to upload
   * @default false
   */
  drag?: boolean;

  /**
   * Show upload list
   * @default true
   */
  showUploadList?: boolean;

  /**
   * Additional class name
   */
  className?: string;

  /**
   * Additional style
   */
  style?: React.CSSProperties;

  /**
   * Children (custom trigger)
   */
  children?: React.ReactNode;
}

const Upload: React.FC<UploadProps> = ({
  action,
  accept,
  multiple = false,
  maxCount,
  maxSize,
  fileList: controlledFileList,
  defaultFileList = [],
  beforeUpload,
  customRequest,
  onChange,
  onRemove,
  onProgress,
  onSuccess,
  onError,
  listType = "text",
  disabled = false,
  drag = false,
  showUploadList = true,
  className = "",
  style,
  children,
}) => {
  const { isDark } = useCurrentTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const [internalFileList, setInternalFileList] =
    useState<UploadFile[]>(defaultFileList);
  const [isDragging, setIsDragging] = useState(false);

  const fileList =
    controlledFileList !== undefined ? controlledFileList : internalFileList;

  // Track current file list in a ref for cleanup on unmount
  const fileListRef = useRef(fileList);
  useEffect(() => {
    fileListRef.current = fileList;
  }, [fileList]);

  // Revoke all blob URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      fileListRef.current.forEach((file) => {
        if (file.url && file.url.startsWith("blob:")) {
          URL.revokeObjectURL(file.url);
        }
      });
    };
  }, []);

  // Generate unique ID
  const generateUid = useCallback(() => {
    return `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  // Convert File to UploadFile
  const fileToUploadFile = useCallback(
    (file: File): UploadFile => {
      return {
        uid: generateUid(),
        name: file.name,
        size: file.size,
        type: file.type,
        status: "ready",
        percent: 0,
        originFile: file,
        url: file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined,
      };
    },
    [generateUid]
  );

  // Update file list
  const updateFileList = useCallback(
    (newFileList: UploadFile[]) => {
      if (controlledFileList === undefined) {
        setInternalFileList(newFileList);
      }
      onChange?.(newFileList);
    },
    [controlledFileList, onChange]
  );

  // Update single file
  const updateFile = useCallback(
    (uid: string, updates: Partial<UploadFile>) => {
      const newFileList = fileList.map((file) =>
        file.uid === uid ? { ...file, ...updates } : file
      );
      updateFileList(newFileList);
    },
    [fileList, updateFileList]
  );

  // Default upload handler using fetch
  const defaultUpload = useCallback(
    async (file: File, uploadFile: UploadFile) => {
      if (!action) {
        console.error("Upload action URL is required");
        return;
      }

      const formData = new FormData();
      formData.append("file", file);

      try {
        const xhr = new XMLHttpRequest();

        xhr.upload.onprogress = (progressEvent) => {
          if (progressEvent.lengthComputable) {
            const percent = Math.round(
              (progressEvent.loaded / progressEvent.total) * 100
            );
            updateFile(uploadFile.uid, { percent, status: "uploading" });
            onProgress?.(percent, uploadFile);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const response = JSON.parse(xhr.responseText);
            updateFile(uploadFile.uid, {
              status: "done",
              percent: 100,
              response,
            });
            onSuccess?.(response, uploadFile);
          } else {
            throw new Error(`Upload failed with status ${xhr.status}`);
          }
        };

        xhr.onerror = () => {
          const error = new Error("Upload failed");
          updateFile(uploadFile.uid, {
            status: "error",
            error: error.message,
          });
          onError?.(error, uploadFile);
        };

        xhr.open("POST", action);
        xhr.send(formData);
      } catch (error) {
        const err = error as Error;
        updateFile(uploadFile.uid, {
          status: "error",
          error: err.message,
        });
        onError?.(err, uploadFile);
      }
    },
    [action, updateFile, onProgress, onSuccess, onError]
  );

  // Process file upload
  const processFile = useCallback(
    async (file: File) => {
      // Validate file size
      if (maxSize && file.size > maxSize) {
        console.error(
          `File ${file.name} exceeds maximum size of ${maxSize} bytes`
        );
        return;
      }

      // Before upload hook
      if (beforeUpload) {
        const result = await beforeUpload(file);
        if (result === false) return;
      }

      const uploadFile = fileToUploadFile(file);
      const newFileList = [...fileList, uploadFile];

      // Check max count
      if (maxCount && newFileList.length > maxCount) {
        console.error(`Maximum ${maxCount} files allowed`);
        return;
      }

      updateFileList(newFileList);

      // Upload file
      if (customRequest) {
        customRequest({
          file,
          onProgress: (percent) => {
            updateFile(uploadFile.uid, { percent, status: "uploading" });
            onProgress?.(percent, uploadFile);
          },
          onSuccess: (response) => {
            updateFile(uploadFile.uid, {
              status: "done",
              percent: 100,
              response,
            });
            onSuccess?.(response, uploadFile);
          },
          onError: (error) => {
            updateFile(uploadFile.uid, {
              status: "error",
              error: error.message,
            });
            onError?.(error, uploadFile);
          },
        });
      } else {
        defaultUpload(file, uploadFile);
      }
    },
    [
      maxSize,
      maxCount,
      beforeUpload,
      fileToUploadFile,
      fileList,
      updateFileList,
      customRequest,
      defaultUpload,
      updateFile,
      onProgress,
      onSuccess,
      onError,
    ]
  );

  // Handle file selection
  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      files.forEach(processFile);
      // Reset input
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    },
    [processFile]
  );

  // Handle file remove
  const handleRemove = useCallback(
    (file: UploadFile) => {
      onRemove?.(file);
      const newFileList = fileList.filter(
        (fileItem) => fileItem.uid !== file.uid
      );
      updateFileList(newFileList);

      // Revoke object URL if it exists
      if (file.url && file.url.startsWith("blob:")) {
        URL.revokeObjectURL(file.url);
      }
    },
    [fileList, updateFileList, onRemove]
  );

  // Handle drag events
  const handleDragEnter = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!disabled) {
        setIsDragging(true);
      }
    },
    [disabled]
  );

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);

      if (disabled) return;

      const files = Array.from(event.dataTransfer.files);
      files.forEach(processFile);
    },
    [disabled, processFile]
  );

  const handleClick = useCallback(() => {
    if (disabled) return;
    inputRef.current?.click();
  }, [disabled]);

  const uploadClasses = [
    "upload",
    `upload-${listType}`,
    drag && "upload-drag",
    isDragging && "upload-dragging",
    disabled && "upload-disabled",
    isDark && "upload-dark",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={uploadClasses} style={style}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
      <UploadTrigger
        drag={drag}
        listType={listType}
        disabled={disabled}
        accept={accept}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        {children}
      </UploadTrigger>
      <UploadFileList
        fileList={fileList}
        listType={listType}
        showUploadList={showUploadList}
        onRemove={handleRemove}
      />
    </div>
  );
};

export default Upload;

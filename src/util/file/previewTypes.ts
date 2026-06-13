/**
 * File Preview Types Utility
 *
 * Utilities for determining file preview types and capabilities.
 * Used by Orgii Editor to render appropriate previews for different file types.
 */
import { isMacOS } from "@src/util/platform/tauri";

import { isBinaryByExtension } from "./binaryDetection";
import { getFileExtensionLower } from "./pathUtils";

// ============================================
// Types
// ============================================

export type PreviewType =
  | "code" // Text files displayed in CodeMirror
  | "image" // Image files (png, jpg, gif, svg, etc.)
  | "video" // Video files (mp4, webm, mov, etc.)
  | "json" // JSON files (tree view)
  | "csv" // CSV/TSV files (table view)
  | "pdf" // PDF documents
  | "docx" // Word documents (.docx)
  | "xlsx" // Excel spreadsheets (.xlsx, .xls)
  | "pptx" // PowerPoint presentations (.pptx, .ppt)
  | "pages" // Apple Pages documents (.pages) — macOS only via textutil
  | "markdown" // Markdown files
  | "html" // HTML files
  | "database" // SQLite database files (table view)
  | "binary"; // Other binary files (no preview)

// ============================================
// Extension Mappings
// ============================================

/**
 * SQLite database file extensions
 */
const DATABASE_EXTENSIONS = new Set(["db", "sqlite", "sqlite3"]);

/**
 * Image file extensions that can be previewed
 */
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "ico",
  "bmp",
  "avif",
]);

/**
 * Video file extensions that can be previewed natively by the browser
 */
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "avi", "mkv", "ogv"]);

/**
 * Structured data extensions with their preview types
 */
const STRUCTURED_DATA_EXTENSIONS: Record<string, PreviewType> = {
  json: "json",
  csv: "csv",
  tsv: "csv",
};

/**
 * Office document extensions with their preview types
 */
const OFFICE_EXTENSIONS: Record<string, PreviewType> = {
  doc: "docx",
  docx: "docx",
  xls: "xlsx",
  xlsx: "xlsx",
  ppt: "pptx",
  pptx: "pptx",
};

/**
 * Document extensions with their preview types
 */
const DOCUMENT_EXTENSIONS: Record<string, PreviewType> = {
  md: "markdown",
  mdc: "markdown",
  markdown: "markdown",
  html: "html",
  htm: "html",
  pdf: "pdf",
};

// ============================================
// Preview Type Detection
// ============================================

/**
 * Get the preview type for a file based on its extension
 *
 * @param filePath - File path or filename
 * @returns The appropriate preview type for the file
 *
 * @example
 * getPreviewType("image.png") // "image"
 * getPreviewType("data.json") // "json"
 * getPreviewType("script.js") // "code"
 * getPreviewType("binary.exe") // "binary"
 */
export function getPreviewType(filePath: string): PreviewType {
  if (!filePath) return "code";

  const extension = getFileExtensionLower(filePath);

  // Check image extensions
  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }

  // Check video extensions
  if (VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }

  // Check database extensions
  if (DATABASE_EXTENSIONS.has(extension)) {
    return "database";
  }

  // Check structured data extensions
  if (extension in STRUCTURED_DATA_EXTENSIONS) {
    return STRUCTURED_DATA_EXTENSIONS[extension];
  }

  // Apple Pages — macOS only (uses textutil for conversion)
  if (extension === "pages") {
    return isMacOS() ? "pages" : "binary";
  }

  // Check office document extensions
  if (extension in OFFICE_EXTENSIONS) {
    return OFFICE_EXTENSIONS[extension];
  }

  // Check document extensions
  if (extension in DOCUMENT_EXTENSIONS) {
    return DOCUMENT_EXTENSIONS[extension];
  }

  // Check if it's a binary file
  if (isBinaryByExtension(filePath)) {
    return "binary";
  }

  // Default to code view
  return "code";
}

/**
 * Check if a file can be previewed (not code or binary)
 *
 * @param filePath - File path or filename
 * @returns True if the file has a dedicated preview mode
 */
export function isPreviewableFile(filePath: string): boolean {
  const type = getPreviewType(filePath);
  return type !== "code" && type !== "binary";
}

/**
 * Check if a file supports toggling between code and preview modes
 *
 * Some files (like JSON, CSV, Markdown) can be viewed as raw code or in a
 * formatted preview. Images and PDFs are always shown as previews.
 *
 * @param filePath - File path or filename
 * @returns True if the file supports code/preview toggle
 */
export function supportsPreviewToggle(filePath: string): boolean {
  const type = getPreviewType(filePath);
  return ["json", "csv", "markdown", "html"].includes(type);
}

/**
 * Check if a file should always be shown as preview (no code view option)
 *
 * Binary files like images and PDFs don't have a meaningful code view.
 *
 * @param filePath - File path or filename
 * @returns True if the file should always show preview
 */
export function isPreviewOnlyFile(filePath: string): boolean {
  const type = getPreviewType(filePath);
  return (
    type === "image" ||
    type === "video" ||
    type === "pdf" ||
    type === "docx" ||
    type === "xlsx" ||
    type === "pptx" ||
    type === "pages" ||
    type === "database"
  );
}

export function requiresFilePreviewRoute(filePath: string): boolean {
  return isPreviewOnlyFile(filePath);
}

export function supportsSourceControlWorkingCopyPreview(
  previewType: PreviewType
): boolean {
  return isSourceControlWorkingCopyPreviewType(previewType);
}

function isSourceControlWorkingCopyPreviewType(
  previewType: PreviewType
): boolean {
  return ["image", "video", "pdf", "docx", "xlsx", "pptx", "pages"].includes(
    previewType
  );
}

/**
 * Get MIME type for an image file
 *
 * @param filePath - File path or filename
 * @returns MIME type string or undefined if not an image
 */
export function getImageMimeType(filePath: string): string | undefined {
  const extension = getFileExtensionLower(filePath);

  const mimeTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    bmp: "image/bmp",
    avif: "image/avif",
  };

  return mimeTypes[extension];
}

/**
 * Get MIME type for a video file
 *
 * @param filePath - File path or filename
 * @returns MIME type string or undefined if not a video
 */
export function getVideoMimeType(filePath: string): string | undefined {
  const extension = getFileExtensionLower(filePath);

  const mimeTypes: Record<string, string> = {
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
    ogv: "video/ogg",
  };

  return mimeTypes[extension];
}

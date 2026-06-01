/**
 * ImagePreviewOverlay
 *
 * Fullscreen dark overlay for previewing images.
 * Toolbar (optional copy, download, close) at the top-right of the image.
 * Click backdrop or press ESC to close.
 */
import { Copy, Download, X } from "lucide-react";
import React, { memo, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

import Message from "@src/components/Message";
import { useOverlayLayer } from "@src/store/ui/overlayLayerAtom";

// ============================================
// Types
// ============================================

interface ImagePreviewOverlayProps {
  dataUrl: string;
  fileName?: string;
  onClose: () => void;
  /** When false, hides the copy-to-clipboard control (e.g. chat panel). Default true. */
  showCopyButton?: boolean;
}

// ============================================
// Component
// ============================================

const ImagePreviewOverlay: React.FC<ImagePreviewOverlayProps> = memo(
  ({ dataUrl, fileName, onClose, showCopyButton = true }) => {
    // Drop inline browser webviews behind this fullscreen modal.
    useOverlayLayer(true);

    // Close on ESC
    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      };
      window.addEventListener("keydown", handleKeyDown, true);
      return () => window.removeEventListener("keydown", handleKeyDown, true);
    }, [onClose]);

    const handleBackdropClick = useCallback(
      (event: React.MouseEvent) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      },
      [onClose]
    );

    const handleCopy = useCallback(async () => {
      try {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob }),
        ]);
        Message.success("Image copied to clipboard");
      } catch {
        Message.error("Failed to copy image");
      }
    }, [dataUrl]);

    const handleDownload = useCallback(() => {
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = fileName || "image.png";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }, [dataUrl, fileName]);

    return createPortal(
      <div
        className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70"
        onClick={handleBackdropClick}
        role="dialog"
        aria-modal="true"
        aria-label="Image preview"
      >
        {/* Image container with toolbar overlay */}
        <div className="relative">
          {/* Toolbar — floating inside image top-right */}
          <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-lg bg-black p-1">
            {showCopyButton && (
              <button
                type="button"
                onClick={handleCopy}
                className="flex h-7 w-7 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/15 hover:text-white"
                aria-label="Copy image"
                title="Copy"
              >
                <Copy size={15} strokeWidth={2} />
              </button>
            )}
            <button
              type="button"
              onClick={handleDownload}
              className="flex h-7 w-7 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/15 hover:text-white"
              aria-label="Download image"
              title="Download"
            >
              <Download size={15} strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/15 hover:text-white"
              aria-label="Close preview"
              title="Close"
            >
              <X size={15} strokeWidth={2} />
            </button>
          </div>

          {/* Image */}
          <img
            src={dataUrl}
            alt={fileName || "Preview"}
            className="max-h-[80vh] max-w-[80vw] rounded-lg object-contain"
            draggable={false}
          />
        </div>
      </div>,
      document.body
    );
  }
);

ImagePreviewOverlay.displayName = "ImagePreviewOverlay";

export default ImagePreviewOverlay;

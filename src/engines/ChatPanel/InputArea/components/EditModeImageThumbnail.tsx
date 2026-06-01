/**
 * Edit-mode read-only image thumbnail with overlay preview.
 */
import React, { memo, useCallback, useState } from "react";

import ImagePreviewOverlay from "@src/components/ImagePreviewOverlay";

const EditModeImageThumbnail: React.FC<{ dataUrl: string; alt: string }> = memo(
  ({ dataUrl, alt }) => {
    const [showOverlay, setShowOverlay] = useState(false);

    const handleClick = useCallback(() => setShowOverlay(true), []);
    const handleClose = useCallback(() => setShowOverlay(false), []);

    return (
      <>
        <div
          className="group relative inline-flex h-10 w-10 flex-shrink-0 cursor-pointer overflow-hidden rounded-md border border-border-2 bg-fill-1"
          onClick={handleClick}
        >
          <img
            src={dataUrl}
            alt={alt}
            className="h-full w-full object-cover"
            draggable={false}
          />
        </div>
        {showOverlay && (
          <ImagePreviewOverlay
            dataUrl={dataUrl}
            onClose={handleClose}
            showCopyButton={false}
          />
        )}
      </>
    );
  }
);
EditModeImageThumbnail.displayName = "EditModeImageThumbnail";

export default EditModeImageThumbnail;

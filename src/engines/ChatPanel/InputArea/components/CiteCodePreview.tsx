/**
 * CiteCodePreview Component
 *
 * Display cited code snippet from editor with "Add to Chat" functionality
 */
import React, { memo } from "react";

// ============================================
// Type Definitions
// ============================================

interface Range {
  start: number;
  end: number;
}

interface CiteCodePreviewProps {
  /** Whether cite code is active */
  isCiteCode: boolean;
  /** Selected code range */
  selectedCiteRange: Range | null;
  /** File name of cited code */
  citeFileName: string;
  /** Handler to clear cite code */
  onClear: () => void;
}

// ============================================
// Component
// ============================================

const CiteCodePreview: React.FC<CiteCodePreviewProps> = memo(
  ({ isCiteCode, selectedCiteRange, citeFileName, onClear }) => {
    if (!isCiteCode || !selectedCiteRange) {
      return null;
    }

    return (
      <div className="flex items-center gap-1 rounded bg-fill-2 px-2 py-1 text-xs text-text-2">
        <span>{citeFileName}</span>
        <span className="text-text-3">
          L{selectedCiteRange.start}-{selectedCiteRange.end}
        </span>
        <button
          type="button"
          className="ml-1 text-text-3 hover:text-text-1"
          aria-label="Remove code citation"
          onClick={onClear}
        >
          <span aria-hidden>×</span>
        </button>
      </div>
    );
  }
);

CiteCodePreview.displayName = "CiteCodePreview";

export default CiteCodePreview;

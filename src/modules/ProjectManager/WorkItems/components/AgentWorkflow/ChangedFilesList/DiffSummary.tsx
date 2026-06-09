import React from "react";

import { formatStatNumber } from "@src/shared/pr/formatStatNumber";

interface DiffSummaryProps {
  added: number;
  removed: number;
}

const DiffSummary: React.FC<DiffSummaryProps> = ({ added, removed }) => (
  <div className="flex items-center gap-1.5 text-[11px]">
    <span className="text-success-6">+{formatStatNumber(added)}</span>
    <span className="text-text-4">/</span>
    <span className="text-danger-6">-{formatStatNumber(removed)}</span>
  </div>
);

export default DiffSummary;

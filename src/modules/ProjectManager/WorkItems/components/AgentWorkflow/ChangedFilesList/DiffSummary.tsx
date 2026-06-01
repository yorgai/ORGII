import React from "react";

interface DiffSummaryProps {
  added: number;
  removed: number;
}

const DiffSummary: React.FC<DiffSummaryProps> = ({ added, removed }) => (
  <div className="flex items-center gap-1.5 text-[11px]">
    <span className="text-success-6">+{added}</span>
    <span className="text-text-4">/</span>
    <span className="text-danger-6">-{removed}</span>
  </div>
);

export default DiffSummary;

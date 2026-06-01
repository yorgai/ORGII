import React from "react";

import type { ReviewCommentSeverity } from "@src/api/http/project";
import { SeverityIcon } from "@src/components/CodeReviewBlocks";

const SEVERITY_ORDER: ReviewCommentSeverity[] = [
  "error",
  "warning",
  "suggestion",
  "praise",
];

const PILL_STYLES: Record<ReviewCommentSeverity, string> = {
  error: "bg-danger-6/15 text-danger-6",
  warning: "bg-warning-6/15 text-warning-6",
  suggestion: "bg-primary-6/15 text-primary-6",
  praise: "bg-success-6/15 text-success-6",
};

interface SeverityPillsProps {
  counts: Partial<Record<ReviewCommentSeverity, number>>;
}

const SeverityPills: React.FC<SeverityPillsProps> = ({ counts }) => {
  const pills = SEVERITY_ORDER.filter(
    (severity) => (counts[severity] ?? 0) > 0
  );
  if (pills.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      {pills.map((severity) => (
        <span
          key={severity}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${PILL_STYLES[severity]}`}
        >
          <SeverityIcon severity={severity} size={11} />
          {counts[severity]}
        </span>
      ))}
    </div>
  );
};

export default SeverityPills;

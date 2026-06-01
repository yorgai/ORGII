import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";

interface CollapsibleSummaryProps {
  content: string;
}

const CollapsibleSummary: React.FC<CollapsibleSummaryProps> = ({ content }) => {
  const { t } = useTranslation("projects");
  const [expanded, setExpanded] = useState(false);
  const firstLine = content.split("\n")[0];
  const hasMore = content.includes("\n") || content.length > 150;

  return (
    <div className="pb-2">
      <div className="text-[13px] leading-relaxed text-text-2">
        {expanded ? (
          <pre className="whitespace-pre-wrap font-sans">{content}</pre>
        ) : (
          <span className="line-clamp-2">{firstLine}</span>
        )}
      </div>
      {hasMore && (
        <Button
          variant="tertiary"
          size="mini"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 !px-0"
        >
          {expanded
            ? t("common:actions.collapse")
            : t("workItems.reviewFeedback.showFullReview")}
        </Button>
      )}
    </div>
  );
};

export default CollapsibleSummary;

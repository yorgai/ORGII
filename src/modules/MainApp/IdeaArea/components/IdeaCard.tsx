/**
 * IdeaCard — display card for a single idea item.
 */
import { ChevronUp, MessageCircle } from "lucide-react";
import React from "react";

import { CATEGORY_LABELS, type IdeaItem, STATUS_LABELS } from "../demoData";

const CATEGORY_COLORS: Record<string, string> = {
  productivity: "bg-blue-500/10 text-blue-400",
  "dev-tools": "bg-violet-500/10 text-violet-400",
  ai: "bg-amber-500/10 text-amber-400",
  collaboration: "bg-teal-500/10 text-teal-400",
  utilities: "bg-slate-500/10 text-slate-400",
  creative: "bg-pink-500/10 text-pink-400",
};

const STATUS_COLORS: Record<string, string> = {
  concept: "bg-fill-2 text-text-3",
  "in-progress": "bg-primary-6/10 text-primary-6",
  shipped: "bg-green-500/10 text-green-500",
};

interface IdeaCardProps {
  idea: IdeaItem;
  onClick?: (idea: IdeaItem) => void;
}

const IdeaCard: React.FC<IdeaCardProps> = ({ idea, onClick }) => {
  return (
    <button
      className="w-full rounded-xl border border-border-2 bg-transparent p-4 text-left transition-[border-color,box-shadow] duration-150 ease-in-out hover:border-border-3 focus:border-primary-6 focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-primary-6)_15%,transparent)] focus:outline-none"
      onClick={() => onClick?.(idea)}
    >
      <div className="flex items-start gap-3">
        {/* Upvote column */}
        <div className="flex flex-col items-center gap-1 pt-0.5">
          <div className="flex flex-col items-center rounded-lg border border-border-2 bg-transparent px-2 py-1.5">
            <ChevronUp size={14} className="text-text-3" />
            <span className="text-[11px] font-semibold tabular-nums text-text-2">
              {idea.upvotes >= 1000
                ? `${(idea.upvotes / 1000).toFixed(1)}k`
                : idea.upvotes}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${CATEGORY_COLORS[idea.category] ?? "bg-fill-2 text-text-3"}`}
            >
              {CATEGORY_LABELS[idea.category]}
            </span>
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${STATUS_COLORS[idea.status] ?? "bg-fill-2 text-text-3"}`}
            >
              {STATUS_LABELS[idea.status]}
            </span>
            {idea.trending && (
              <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                Trending
              </span>
            )}
          </div>

          <h3 className="mb-1 text-[13px] font-semibold leading-snug text-text-1">
            {idea.title}
          </h3>

          <p className="mb-2 line-clamp-2 text-[12px] leading-relaxed text-text-3">
            {idea.description}
          </p>

          <div className="flex flex-wrap items-center gap-1.5">
            {idea.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-fill-2 px-1.5 py-0.5 text-[10px] text-text-3"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between border-t border-border-1 pt-2.5">
        <span className="text-[11px] text-text-3">
          <span className="font-medium text-text-2">{idea.authorName}</span>
          {"  "}
          {idea.authorHandle}
        </span>
        <div className="flex items-center gap-3 text-[11px] text-text-3">
          <span>{idea.createdAt}</span>
          <span className="flex items-center gap-1">
            <MessageCircle size={11} />
            {idea.comments}
          </span>
        </div>
      </div>
    </button>
  );
};

export default IdeaCard;

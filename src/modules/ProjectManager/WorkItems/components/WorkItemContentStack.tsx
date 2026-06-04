import type { ReactNode } from "react";

interface WorkItemContentStackProps {
  titleContent?: ReactNode;
  pathContent?: ReactNode;
  propertiesContent?: ReactNode;
  descriptionContent: ReactNode;
  todosContent?: ReactNode;
  lowerContent?: ReactNode;
  className?: string;
  scrollable?: boolean;
  titleClassName?: string;
  descriptionClassName?: string;
  todosClassName?: string;
  lowerClassName?: string;
}

const INSET_SEPARATOR = (
  <div className="shrink-0 px-4" aria-hidden>
    <div className="border-t border-border-2" />
  </div>
);

export default function WorkItemContentStack({
  titleContent,
  pathContent,
  propertiesContent,
  descriptionContent,
  todosContent,
  lowerContent,
  className = "",
  scrollable = false,
  titleClassName = "px-4 py-2",
  descriptionClassName = "px-4 py-4",
  todosClassName = "px-4 pb-4",
  lowerClassName = "px-4 pt-4",
}: WorkItemContentStackProps) {
  const scrollClassName = scrollable
    ? "overflow-y-auto scrollbar-hide"
    : "overflow-hidden";
  const hasMetaContent = Boolean(pathContent || propertiesContent);
  const hasTopSeparator = Boolean(titleContent || hasMetaContent);

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col ${scrollClassName} ${className}`.trim()}
    >
      {hasMetaContent ? (
        <div className="shrink-0 px-4 py-2">
          {pathContent ? <div>{pathContent}</div> : null}
          {propertiesContent ? (
            <div className={pathContent ? "mt-3" : ""}>{propertiesContent}</div>
          ) : null}
        </div>
      ) : null}
      {hasTopSeparator ? INSET_SEPARATOR : null}
      {titleContent ? (
        <div className={`shrink-0 ${titleClassName}`.trim()}>
          {titleContent}
        </div>
      ) : null}
      <div className={`shrink-0 ${descriptionClassName}`.trim()}>
        {descriptionContent}
      </div>
      {todosContent ? (
        <div className={`shrink-0 ${todosClassName}`.trim()}>
          {todosContent}
        </div>
      ) : null}
      {lowerContent ? (
        <>
          {INSET_SEPARATOR}
          <div className={`min-h-0 flex-1 ${lowerClassName}`.trim()}>
            {lowerContent}
          </div>
        </>
      ) : null}
    </div>
  );
}

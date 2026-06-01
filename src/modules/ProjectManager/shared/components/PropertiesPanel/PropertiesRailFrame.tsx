import { useAtomValue } from "jotai";
import React from "react";

import { workStationInternalLayoutModeAtom } from "@src/store/ui/workStationAtom";
import { classNames } from "@src/util/ui/classNames";

interface PropertiesRailFrameProps {
  children: React.ReactNode;
  width?: number | string;
  minWidth?: number | string;
  maxWidth?: number | string;
  className?: string;
  contentClassName?: string;
  floatingContent?: boolean;
}

function toCssSize(value: number | string | undefined): string | undefined {
  return typeof value === "number" ? `${value}px` : value;
}

const PropertiesRailFrame: React.FC<PropertiesRailFrameProps> = ({
  children,
  width,
  minWidth,
  maxWidth,
  className,
  contentClassName,
  floatingContent = false,
}) => {
  const internalLayoutMode = useAtomValue(workStationInternalLayoutModeAtom);
  const isComfortLayout = internalLayoutMode === "comfort";
  const sizeStyle = {
    width: toCssSize(width),
    minWidth: toCssSize(minWidth),
    maxWidth: toCssSize(maxWidth),
  };

  if (floatingContent) {
    return (
      <div
        className={classNames(
          "box-border flex h-full shrink-0 flex-col",
          className
        )}
        style={sizeStyle}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className={classNames(
        "box-border flex shrink-0 flex-col",
        isComfortLayout
          ? "h-auto max-h-full bg-[var(--cm-editor-background,var(--color-bg-1))] py-2 pr-2"
          : "h-full border-l border-solid border-border-2",
        className
      )}
      style={sizeStyle}
    >
      <div
        className={classNames(
          "min-h-0 overflow-hidden",
          isComfortLayout
            ? "max-h-full rounded-lg border border-solid border-border-2 bg-[var(--cm-editor-background,var(--color-bg-1))] shadow-[0_4px_12px_rgb(0_0_0_/_6%)] [&>section]:h-auto [&>section]:max-h-full"
            : "flex-1",
          contentClassName
        )}
      >
        {children}
      </div>
    </div>
  );
};

export default PropertiesRailFrame;

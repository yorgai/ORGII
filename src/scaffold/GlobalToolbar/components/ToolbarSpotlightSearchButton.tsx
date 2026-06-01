/**
 * Round toolbar search button — always opens GlobalSpotlight.
 * On the code-editor route the spotlight's route-aware default filter
 * handles switching to the Editor tab, so no special casing is needed
 * in the button itself.
 */
import { Search } from "lucide-react";
import React, { useCallback } from "react";

import ToolbarButton from "./ToolbarButton";
import ToolbarGlassContainer from "./ToolbarGlassContainer";

export interface ToolbarSpotlightSearchButtonProps {
  /** When set, called on click instead of default behavior */
  onClick?: () => void;
  /** Called when no `onClick` is provided */
  onOpenSpotlight?: () => void;
  title?: string;
}

export const ToolbarSpotlightSearchButton: React.FC<
  ToolbarSpotlightSearchButtonProps
> = ({ onClick, onOpenSpotlight, title }) => {
  const handleClick = useCallback(() => {
    if (onClick) {
      onClick();
      return;
    }
    onOpenSpotlight?.();
  }, [onClick, onOpenSpotlight]);

  return (
    <ToolbarGlassContainer
      chrome="roundButton"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <ToolbarButton
        icon={Search}
        onClick={handleClick}
        title={title ?? "Search"}
        size="medium"
        shape="round"
      />
    </ToolbarGlassContainer>
  );
};

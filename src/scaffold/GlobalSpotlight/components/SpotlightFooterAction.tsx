/**
 * SpotlightFooterAction Component
 *
 * Small clickable pill rendered alongside the keyboard-shortcuts footer.
 * Uses the same Glass material as SpotlightFooter for visual consistency.
 */
import { ArrowUpRight } from "lucide-react";
import React, { useContext } from "react";

import Glass from "@src/components/Glass";

import { SpotlightFooterMaterialContext } from "./spotlightFooterMaterialContext";

export interface SpotlightFooterActionProps {
  label: string;
  onClick: () => void;
}

export const SpotlightFooterAction: React.FC<SpotlightFooterActionProps> = ({
  label,
  onClick,
}) => {
  const material = useContext(SpotlightFooterMaterialContext);

  return (
    <Glass
      material={material}
      radius={999}
      enableSpecular={true}
      className="spotlight-shadow shrink-0 cursor-pointer"
    >
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1.5 px-3 py-2 text-[11px] text-text-2 transition-colors hover:text-text-1"
      >
        <span>{label}</span>
        <ArrowUpRight size={10} strokeWidth={2.5} />
      </button>
    </Glass>
  );
};

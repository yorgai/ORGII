import { Check } from "lucide-react";
import React from "react";

import { DROPDOWN_ITEM } from "./tokens";

interface DropdownSelectedCheckProps {
  className?: string;
}

const DropdownSelectedCheck: React.FC<DropdownSelectedCheckProps> = ({
  className = "",
}) => (
  <Check
    size={DROPDOWN_ITEM.iconSize}
    strokeWidth={2.25}
    className={["shrink-0 text-primary-6", className].filter(Boolean).join(" ")}
  />
);

export default DropdownSelectedCheck;

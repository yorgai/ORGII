import { Check } from "lucide-react";
import React from "react";

interface DropdownSelectedCheckProps {
  className?: string;
}

const DropdownSelectedCheck: React.FC<DropdownSelectedCheckProps> = ({
  className = "",
}) => (
  <Check
    size={14}
    strokeWidth={2.25}
    className={["shrink-0 text-primary-6", className].filter(Boolean).join(" ")}
  />
);

export default DropdownSelectedCheck;

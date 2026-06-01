import { Check, Loader2, XCircle } from "lucide-react";
import React from "react";

export type StepStatus = "done" | "active" | "pending" | "error" | "warning";

const StepDot: React.FC<{ status: StepStatus }> = ({ status }) => {
  switch (status) {
    case "done":
      return (
        <div className="flex h-4 w-4 items-center justify-center rounded-full bg-primary-6">
          <Check size={10} strokeWidth={3} className="text-white" />
        </div>
      );
    case "active":
      return (
        <div className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-primary-6 bg-transparent">
          <Loader2 size={10} className="animate-spin text-primary-6" />
        </div>
      );
    case "error":
      return (
        <div className="flex h-4 w-4 items-center justify-center rounded-full bg-danger-6">
          <XCircle size={10} strokeWidth={3} className="text-white" />
        </div>
      );
    case "warning":
      return (
        <div className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-warning-6 bg-transparent">
          <div className="h-1.5 w-1.5 rounded-full bg-warning-6" />
        </div>
      );
    default:
      return (
        <div className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-border-2 bg-transparent">
          <div className="h-1.5 w-1.5 rounded-full bg-border-2" />
        </div>
      );
  }
};

export default StepDot;

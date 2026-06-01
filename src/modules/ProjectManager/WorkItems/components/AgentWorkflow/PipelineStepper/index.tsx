import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { OrchestratorPhase } from "@src/api/http/project";

import StepDot, { type StepStatus } from "./StepDot";

const PHASE_ORDER: OrchestratorPhase[] = ["sde", "review", "completed"];

interface PipelineStepperProps {
  currentPhase: OrchestratorPhase;
  cycleCount?: number;
}

const PipelineStepper: React.FC<PipelineStepperProps> = ({
  currentPhase,
  cycleCount = 0,
}) => {
  const { t } = useTranslation("projects");
  const phaseLabels: Record<string, string> = useMemo(
    () => ({
      sde: t("workItems.agentWorkflow.sdePhase"),
      review: t("workItems.agentWorkflow.reviewPhase"),
      completed: t("workItems.agentWorkflow.completed"),
    }),
    [t]
  );

  const getStepStatus = (step: OrchestratorPhase): StepStatus => {
    if (currentPhase === "failed") {
      const currentIdx = PHASE_ORDER.indexOf(PHASE_ORDER[0]);
      const stepIdx = PHASE_ORDER.indexOf(step);
      if (stepIdx < currentIdx) return "done";
      if (stepIdx === currentIdx) return "error";
      return "pending";
    }
    if (currentPhase === "awaiting_user") {
      if (step === "sde") return "done";
      if (step === "review") return "warning";
      return "pending";
    }
    if (currentPhase === "completed") return "done";
    const currentIdx = PHASE_ORDER.indexOf(currentPhase);
    const stepIdx = PHASE_ORDER.indexOf(step);
    if (stepIdx < currentIdx) return "done";
    if (stepIdx === currentIdx) return "active";
    return "pending";
  };

  return (
    <div className="flex items-center gap-0">
      {PHASE_ORDER.map((step, idx) => {
        const status = getStepStatus(step);
        const isLast = idx === PHASE_ORDER.length - 1;
        return (
          <React.Fragment key={step}>
            <div className="flex items-center gap-1.5">
              <StepDot status={status} />
              <span
                className={`text-[11px] leading-none ${
                  status === "active"
                    ? "font-medium text-primary-6"
                    : status === "done"
                      ? "font-medium text-text-1"
                      : status === "error"
                        ? "font-medium text-danger-6"
                        : "text-text-4"
                }`}
              >
                {phaseLabels[step]}
              </span>
            </div>
            {!isLast && (
              <div className="mx-2 h-px flex-1">
                <div
                  className={`h-full ${
                    status === "done" ? "bg-primary-6" : "bg-border-2"
                  }`}
                />
              </div>
            )}
          </React.Fragment>
        );
      })}
      {cycleCount > 1 && (
        <span className="ml-2 rounded-full bg-fill-2 px-1.5 py-0.5 text-[10px] text-text-3">
          {t("workItems.agentWorkflow.cycles", { count: cycleCount })}
        </span>
      )}
    </div>
  );
};

export default PipelineStepper;

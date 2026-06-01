import type { ActionDefinition } from "../types";
import { controlActions } from "./controlActions";
import { generalActions } from "./generalActions";
import { stageActions } from "./stageActions";
import { workflowConfigActions } from "./workflowConfigActions";

export const availableActions: ActionDefinition[] = [
  ...controlActions,
  ...generalActions,
  ...stageActions,
  ...workflowConfigActions,
];

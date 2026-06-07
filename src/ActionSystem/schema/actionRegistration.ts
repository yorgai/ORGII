import type { ZodTypeAny } from "zod";

import type { ZodAction } from "./defineZodAction";

export interface AppZodActionRegistration {
  scope: "app";
  actions: readonly ZodAction<ZodTypeAny>[];
}

export interface WorkStationActionContext {
  repoPath: string;
}

export interface WorkStationZodActionRegistration {
  scope: "workstation";
  createActions: (
    context: WorkStationActionContext
  ) => readonly ZodAction<ZodTypeAny>[];
}

export type ZodActionRegistration =
  | AppZodActionRegistration
  | WorkStationZodActionRegistration;

export function defineAppActionRegistration(
  actions: readonly ZodAction<ZodTypeAny>[]
): AppZodActionRegistration {
  return { scope: "app", actions };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isZodAction(value: unknown): value is ZodAction<ZodTypeAny> {
  if (!isRecord(value)) return false;
  if (!isRecord(value.meta)) return false;
  return (
    typeof value.meta.id === "string" && typeof value.execute === "function"
  );
}

export function isAppZodActionRegistration(
  value: unknown
): value is AppZodActionRegistration {
  if (!isRecord(value)) return false;
  if (value.scope !== "app") return false;
  return Array.isArray(value.actions) && value.actions.every(isZodAction);
}

export function extractAppActionRegistrations(
  moduleExports: unknown
): AppZodActionRegistration[] {
  if (!isRecord(moduleExports)) return [];
  return Object.values(moduleExports).filter(isAppZodActionRegistration);
}

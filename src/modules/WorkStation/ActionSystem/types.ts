/**
 * ActionSystem Types
 *
 * Shared runtime types for the action dispatch system.
 * For action schemas, see `schema/defineZodAction.ts`.
 */

export interface ActionResult {
  success: boolean;
  message?: string;
  data?: unknown;
}

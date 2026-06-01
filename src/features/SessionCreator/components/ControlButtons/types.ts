/**
 * ControlButtons Types
 *
 * Shared types for ControlButtons and its dropdown sub-components.
 */
import type { AdvancedConfig } from "../../types";

export type DropdownDirection = "up" | "down";

export interface ControlButtonsProps {
  /** Advanced config */
  advancedConfig: AdvancedConfig;
  /** Config change handler */
  onConfigChange: (config: AdvancedConfig) => void;
  /** Dropdown direction - up opens above trigger, down opens below */
  dropdownDirection?: DropdownDirection;
  /** When true, auto-opens the model selector (e.g. after an incompatible agent switch) */
  requestModelOpen?: boolean;
  /** Called after the auto-open request has been consumed */
  onModelOpenHandled?: () => void;
  /** When true, hides the Model/Source compound pill (rendered externally) */
  hideModelSourcePill?: boolean;
  /** When true, hides the ModePill (only shows Model/Source) */
  hideModePill?: boolean;
}

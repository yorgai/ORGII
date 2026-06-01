/**
 * Action Registry
 *
 * Chat context component mappings from unified registry.
 * Now uses UNIFIED_EVENT_REGISTRY under the hood.
 */

export {
  getActionConfig,
  shouldShowStatusLine,
  requiresItemIndex,
  getRegisteredActionTypes,
} from "@src/engines/SessionCore/rendering/registry";

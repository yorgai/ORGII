// Default export
import {
  getAddedComponentsActions,
  getCandidatesActions,
  getGlobalTokensActions,
  getPagesActions,
  getRepoComponentsActions,
} from "./actions";
import {
  DesignTabAddedComponents,
  DesignTabGlobalTokens,
  DesignTabPages,
  DesignTabRepoComponents,
} from "./sections";

/**
 * DesignTab - Components browser for the primary sidebar
 *
 * Two sections:
 * - Added Components: Components with .orgii storybook files (ready for preview)
 * - Candidates: All React components scanned from the repository
 *
 * Filter visibility follows explorer pattern:
 * - Hidden by default
 * - Toggle via header action button
 * - Query cleared when filter is hidden
 */

// Re-export all section components
export {
  DesignTabPages,
  DesignTabGlobalTokens,
  DesignTabAddedComponents,
  DesignTabRepoComponents,
} from "./sections";

// Re-export all action functions
export {
  getPagesActions,
  getGlobalTokensActions,
  getAddedComponentsActions,
  getCandidatesActions,
  getRepoComponentsActions,
} from "./actions";

// Re-export types
export type {
  PageItem,
  DesignTabPagesProps,
  DesignTabGlobalTokensProps,
  DesignTabAddedComponentsProps,
  DesignTabRepoComponentsProps,
  ActionItem,
  PagesActionsOptions,
  GlobalTokensActionsOptions,
  AddedComponentsActionsOptions,
  CandidatesActionsOptions,
} from "./types";

export default {
  DesignTabPages,
  DesignTabGlobalTokens,
  DesignTabAddedComponents,
  DesignTabRepoComponents,
  getPagesActions,
  getGlobalTokensActions,
  getAddedComponentsActions,
  getCandidatesActions,
  getRepoComponentsActions,
};

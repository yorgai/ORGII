/**
 * Domain Adapters
 *
 * Shared item builders for converting domain objects into SpotlightItem arrays.
 * Eliminates duplication across selectors and the main spotlight.
 */
export {
  buildRepoSpotlightItems,
  sortRepoItemsSelectedFirst,
} from "./repoAdapter";
export { buildBranchSpotlightItems } from "./branchAdapter";
export { buildWorkspaceFolderItems } from "./workspaceFolderAdapter";

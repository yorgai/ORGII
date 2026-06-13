// ============================================
// Unified API Object
// ============================================
import {
  formatRelativePath,
  getFileExtension,
  getFileName,
  getTotalMatchCount,
  getTotalSymbolCount,
  groupSymbolsByKind,
  isCodeSearchAvailable,
} from "./helpers";
import {
  merkleBuildTree,
  merkleDiffSinceSnapshot,
  merkleGetStats,
} from "./merkle";
import {
  cancelSearch,
  clearSearchCache,
  searchCodeFast,
  searchCodeRegex,
  searchCodeStreaming,
} from "./regex";
import {
  checkAdvancedSearchEnabled,
  checkSemanticAvailable,
  searchSemantic,
} from "./semantic";
import {
  findReferences,
  getFileSymbols,
  getSupportedLanguages,
  gotoDefinition,
  searchSymbols,
} from "./symbol";

/**
 * Code Search API
 *
 * TypeScript wrapper for Tauri code search commands.
 */
export type {
  SearchMatch,
  CodeSearchResult,
  SymbolInfo,
  SymbolSearchResult,
  Location,
  SearchFilters,
  LanguageInfo,
  SearchResultEvent,
  SearchCompleteEvent,
  IncrementalIndexResult,
  SemanticHit,
  EmbeddingModelStatus,
  USearchIndexInfo,
  SearchMode,
} from "./types";

export {
  searchCodeRegex,
  searchCodeStreaming,
  cancelSearch,
  searchCodeFast,
  clearSearchCache,
} from "./regex";

export {
  searchSymbols,
  getFileSymbols,
  gotoDefinition,
  findReferences,
  getSupportedLanguages,
} from "./symbol";

export {
  merkleBuildTree,
  merkleDiffSinceSnapshot,
  merkleGetStats,
} from "./merkle";

export {
  checkAdvancedSearchEnabled,
  checkSemanticAvailable,
  searchSemantic,
  indexRepositorySemantic,
  removeRepositorySemantic,
  cancelSemanticIndexing,
  incrementalIndexSemantic,
  checkEmbeddingModelStatus,
  downloadEmbeddingModel,
  deleteEmbeddingModel,
  setModelDir,
  getModelDirPath,
  isSemanticSearchAvailable,
  getSemanticIndexInfo,
  getModelInfo,
  stopEmbedder,
} from "./semantic";

export type { MerkleChange, MerkleDiffResult, MerkleStats } from "./merkle";

export {
  isCodeSearchAvailable,
  getTotalMatchCount,
  getTotalSymbolCount,
  groupSymbolsByKind,
  getFileExtension,
  getFileName,
  formatRelativePath,
} from "./helpers";

export const searchApi = {
  searchCodeRegex,
  searchCodeStreaming,
  searchCodeFast,
  cancelSearch,
  clearSearchCache,
  searchSymbols,
  getFileSymbols,
  gotoDefinition,
  findReferences,
  getSupportedLanguages,
  merkleBuildTree,
  merkleDiffSinceSnapshot,
  merkleGetStats,
  checkAdvancedSearchEnabled,
  checkSemanticAvailable,
  searchSemantic,
  isCodeSearchAvailable,
  getTotalMatchCount,
  getTotalSymbolCount,
  groupSymbolsByKind,
  getFileExtension,
  getFileName,
  formatRelativePath,
};

export default searchApi;

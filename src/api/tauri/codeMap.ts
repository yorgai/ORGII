import { invoke } from "@tauri-apps/api/core";

export const CODE_MAP_STATUS = {
  NOT_INDEXED: "not_indexed",
  INDEXING: "indexing",
  READY: "ready",
  STALE: "stale",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

export type CodeMapStatusKind =
  (typeof CODE_MAP_STATUS)[keyof typeof CODE_MAP_STATUS];

export const CODE_MAP_FRESHNESS = {
  FRESH: "fresh",
  STALE: "stale",
  UNKNOWN: "unknown",
} as const;

export type CodeMapFreshnessKind =
  (typeof CODE_MAP_FRESHNESS)[keyof typeof CODE_MAP_FRESHNESS];

export const CODE_MAP_INDEX_PHASE = {
  QUEUED: "queued",
  SCANNING: "scanning",
  EXTRACTING: "extracting",
  STORING: "storing",
  RESOLVING: "resolving",
  COMPLETE: "complete",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

export type CodeMapIndexPhase =
  (typeof CODE_MAP_INDEX_PHASE)[keyof typeof CODE_MAP_INDEX_PHASE];

export const CODE_MAP_EVENT = {
  STATUS_CHANGED: "code-map:status-changed",
  INDEX_PROGRESS: "code-map:index-progress",
} as const;

export type CodeMapNodeKind =
  | "file"
  | "module"
  | "class"
  | "struct"
  | "interface"
  | "trait"
  | "function"
  | "method"
  | "property"
  | "field"
  | "variable"
  | "constant"
  | "enum"
  | "type_alias"
  | "namespace"
  | "import"
  | "component";

export type CodeMapLanguage =
  | "typescript"
  | "tsx"
  | "javascript"
  | "jsx"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "c"
  | "cpp"
  | "csharp"
  | "php"
  | "ruby"
  | "swift"
  | "kotlin";

export type CodeMapConfidence =
  | "exact"
  | "high"
  | "medium"
  | "low"
  | "heuristic";

export type CodeMapExtractionMethod =
  | "file_system"
  | "tree_sitter"
  | "regex"
  | "resolver";

export type CodeMapResolutionStatus =
  | "not_applicable"
  | "unresolved"
  | "resolved"
  | "ambiguous";

export type CodeMapEdgeKind =
  | "contains"
  | "imports"
  | "exports"
  | "references"
  | "calls"
  | "extends"
  | "implements"
  | "type_of"
  | "returns"
  | "instantiates";

export interface CodeMapIndexProgress {
  workspacePath: string;
  phase: CodeMapIndexPhase;
  filesProcessed: number;
  filesTotal: number;
  currentFile?: string | null;
  addedFiles: number;
  modifiedFiles: number;
  deletedFiles: number;
  error?: string | null;
}

export interface CodeMapWorkspaceSummary {
  workspacePath: string;
  status: CodeMapStatusKind;
  files: number;
  symbols: number;
  relationships: number;
  unresolved: number;
  staleFiles: number;
  indexSizeBytes: number;
  freshness: CodeMapFreshnessKind;
  lastIndexedAt?: number | null;
  error?: string | null;
}

export interface CodeMapWorkspaceStatus extends CodeMapWorkspaceSummary {
  progress?: CodeMapIndexProgress | null;
}

export interface CodeMapNode {
  id: string;
  kind: CodeMapNodeKind;
  name: string;
  qualifiedName: string;
  filePath: string;
  language: CodeMapLanguage;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  signature?: string | null;
  updatedAt: number;
  confidence: CodeMapConfidence;
  extractionMethod: CodeMapExtractionMethod;
  parentId?: string | null;
}

export interface CodeMapEdge {
  source: string;
  target: string;
  kind: CodeMapEdgeKind;
  line?: number | null;
  column?: number | null;
  provenance?: string | null;
  confidence: CodeMapConfidence;
  resolutionStatus: CodeMapResolutionStatus;
}

export interface CodeMapRelationship {
  edge: CodeMapEdge;
  node: CodeMapNode;
}

export interface CodeMapSourceWindow {
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
}

export interface CodeMapNodeDetails {
  node: CodeMapNode;
  incoming: CodeMapRelationship[];
  outgoing: CodeMapRelationship[];
  source?: CodeMapSourceWindow | null;
}

export interface CodeMapSearchResult {
  node: CodeMapNode;
  rank: number;
  source?: CodeMapSourceWindow | null;
  incomingCount: number;
  outgoingCount: number;
}

export interface CodeMapSearchResponse {
  workspacePath: string;
  query: string;
  results: CodeMapSearchResult[];
  unresolvedCount: number;
  staleFiles: number;
  truncated: boolean;
}

export interface CodeMapQueryRequest {
  workspacePath: string;
  query?: string | null;
  nodeId?: string | null;
  filePath?: string | null;
  kind?: CodeMapNodeKind | null;
  language?: CodeMapLanguage | null;
  pathPrefix?: string | null;
  includeSource: boolean;
  includeRelationships: boolean;
  maxResults: number;
  maxDepth: number;
}

export async function getCodeMapStatus(
  workspacePath: string
): Promise<CodeMapWorkspaceStatus> {
  return invoke<CodeMapWorkspaceStatus>("code_map_get_status", {
    workspacePath,
  });
}

export async function getManyCodeMapStatuses(
  workspacePaths: string[]
): Promise<CodeMapWorkspaceSummary[]> {
  return invoke<CodeMapWorkspaceSummary[]>("code_map_get_many_statuses", {
    workspacePaths,
  });
}

export async function startCodeMapIndex(
  workspacePath: string,
  force = false
): Promise<CodeMapWorkspaceStatus> {
  return invoke<CodeMapWorkspaceStatus>("code_map_start_index", {
    workspacePath,
    force,
  });
}

export async function cancelCodeMapIndex(
  workspacePath: string
): Promise<boolean> {
  return invoke<boolean>("code_map_cancel_index", { workspacePath });
}

export async function clearCodeMapIndex(
  workspacePath: string
): Promise<CodeMapWorkspaceStatus> {
  return invoke<CodeMapWorkspaceStatus>("code_map_clear_index", {
    workspacePath,
  });
}

export async function searchCodeMap(
  request: CodeMapQueryRequest
): Promise<CodeMapSearchResponse> {
  return invoke<CodeMapSearchResponse>("code_map_search", { request });
}

export async function getCodeMapNodeDetails(
  request: CodeMapQueryRequest
): Promise<CodeMapNodeDetails> {
  return invoke<CodeMapNodeDetails>("code_map_node_details", { request });
}

export const codeMapApi = {
  getStatus: getCodeMapStatus,
  getManyStatuses: getManyCodeMapStatuses,
  startIndex: startCodeMapIndex,
  cancelIndex: cancelCodeMapIndex,
  clearIndex: clearCodeMapIndex,
  search: searchCodeMap,
  getNodeDetails: getCodeMapNodeDetails,
};

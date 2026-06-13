import { useCallback, useState } from "react";

import {
  type CodeMapNodeDetails,
  type CodeMapQueryRequest,
  type CodeMapSearchResponse,
  getCodeMapNodeDetails,
  searchCodeMap,
} from "@src/api/tauri/codeMap";

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createDefaultRequest(
  workspacePath: string,
  overrides: Partial<CodeMapQueryRequest>
): CodeMapQueryRequest {
  return {
    workspacePath,
    query: null,
    nodeId: null,
    filePath: null,
    kind: null,
    language: null,
    pathPrefix: null,
    includeSource: false,
    includeRelationships: false,
    maxResults: 50,
    maxDepth: 2,
    ...overrides,
  };
}

export function useCodeMapSearch(workspacePath?: string | null) {
  const [result, setResult] = useState<CodeMapSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(
    async (query: string, overrides: Partial<CodeMapQueryRequest> = {}) => {
      if (!workspacePath || !query.trim()) return;
      setLoading(true);
      setError(null);
      try {
        const response = await searchCodeMap(
          createDefaultRequest(workspacePath, {
            query: query.trim(),
            includeSource: true,
            includeRelationships: true,
            ...overrides,
          })
        );
        setResult(response);
      } catch (searchError) {
        setError(errorToMessage(searchError));
      } finally {
        setLoading(false);
      }
    },
    [workspacePath]
  );

  return { result, loading, error, search };
}

export function useCodeMapNodeDetails(workspacePath?: string | null) {
  const [details, setDetails] = useState<CodeMapNodeDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNode = useCallback(
    async (overrides: Partial<CodeMapQueryRequest>) => {
      if (!workspacePath) return;
      setLoading(true);
      setError(null);
      try {
        const response = await getCodeMapNodeDetails(
          createDefaultRequest(workspacePath, {
            includeSource: true,
            includeRelationships: true,
            ...overrides,
          })
        );
        setDetails(response);
      } catch (nodeError) {
        setError(errorToMessage(nodeError));
      } finally {
        setLoading(false);
      }
    },
    [workspacePath]
  );

  return { details, loading, error, loadNode };
}

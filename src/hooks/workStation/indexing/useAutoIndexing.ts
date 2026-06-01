export interface UseAutoIndexingOptions {
  repoId: string;
  repoPath: string;
  enabled?: boolean;
}

export function useAutoIndexing(_options: UseAutoIndexingOptions): void {}

export default useAutoIndexing;

export interface FileChangeInfo {
  path: string;
  fileName: string;
  status: string;
  additions: number;
  deletions: number;
  lineCount: number;
}

export interface FileChangesResult {
  files: FileChangeInfo[];
  totalAdditions: number;
  totalDeletions: number;
  stats: { added: number; modified: number; deleted: number };
}

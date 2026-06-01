import { createFileContentActions } from "./fileContentActions.zod";
import { createFileCrudActions } from "./fileCrudActions.zod";
import { createFileOpenActions } from "./fileOpenActions.zod";

/**
 * File Actions - barrel re-export
 *
 * All file actions split by domain:
 * - Open & Navigation (search, reveal)
 * - CRUD (save, create, delete, rename, copy, paste, duplicate)
 * - Content (read, edit, listDir)
 * - Tab (close, closeAll, saveAll - static, no repoPath)
 */
export { fileTabZodActions } from "./fileTabActions.zod";

export function createFileZodActions(repoPath: string) {
  return [
    ...createFileOpenActions(repoPath),
    ...createFileCrudActions(repoPath),
    ...createFileContentActions(repoPath),
  ];
}

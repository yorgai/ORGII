/**
 * File CRUD Actions (Zod-based)
 *
 * Actions for creating, deleting, renaming files/folders,
 * plus copy, paste, and duplicate operations.
 * Part of the file actions factory (requires repoPath).
 */
import { z } from "zod";

import { ACTION_ID } from "@src/ActionSystem/actionIds";
import { defineZodAction } from "@src/ActionSystem/schema/defineZodAction";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import { FileOperationsService } from "@src/services/file";

import { resolvePath } from "./utils";

export function createFileCrudActions(repoPath: string) {
  const fileSave = defineZodAction(
    {
      id: ACTION_ID.FILE_SAVE,
      category: "file",
      layer: "gui",
      description: "Save the current file",
      params: z.object({
        path: z
          .string()
          .optional()
          .describe(
            "File path (defaults to current file, absolute or relative to repo)"
          ),
      }),
      shortcut: getShortcutKeys("save_file"),
      examples: ["save", "save file", "save current file"],
    },
    async ({ path }) => {
      const filePath = path ? resolvePath(path, repoPath) : undefined;
      const result = await FileOperationsService.save(filePath);
      return {
        success: result.success,
        message: result.success
          ? "File saved"
          : result.message || "Failed to save file",
      };
    }
  );

  const fileRefresh = defineZodAction(
    {
      id: ACTION_ID.FILE_REFRESH,
      category: "file",
      description: "Refresh the file tree",
      params: z.object({}),
      examples: ["refresh files", "reload file tree"],
    },
    async () => {
      const result = await FileOperationsService.refresh();
      return {
        success: result.success,
        message: result.success
          ? "File tree refreshed"
          : result.message || "Failed to refresh",
      };
    }
  );

  const fileCollapseAll = defineZodAction(
    {
      id: ACTION_ID.FILE_COLLAPSE_ALL,
      category: "file",
      description: "Collapse all directories in the file explorer",
      params: z.object({}),
      examples: ["collapse all", "collapse folders"],
    },
    async () => {
      const result = FileOperationsService.collapseAll();
      return {
        success: result.success,
        message: result.success
          ? "All directories collapsed"
          : result.message || "Failed to collapse",
      };
    }
  );

  const fileCreate = defineZodAction(
    {
      id: ACTION_ID.FILE_CREATE,
      category: "file",
      layer: "action",
      description: "Create a new file",
      params: z.object({
        path: z
          .string()
          .min(1, "Path cannot be empty")
          .describe("Path for the new file (absolute or relative to repo)"),
        content: z
          .string()
          .optional()
          .default("")
          .describe("Initial content for the file"),
      }),
      requiresConfirmation: true,
      examples: ["create new file utils.ts", "new file src/helper.js"],
    },
    async ({ path, content }) => {
      const filePath = resolvePath(path, repoPath);
      const result = await FileOperationsService.create(
        filePath,
        content ?? ""
      );
      return {
        success: result.success,
        message: result.success
          ? `Created: ${path}`
          : result.message || "Failed to create file",
        data: { path: filePath },
      };
    }
  );

  const fileDelete = defineZodAction(
    {
      id: ACTION_ID.FILE_DELETE,
      category: "file",
      layer: "action",
      description: "Delete a file or directory",
      params: z.object({
        path: z
          .string()
          .min(1, "Path cannot be empty")
          .describe("File path to delete"),
      }),
      requiresConfirmation: true,
      examples: ["delete temp.txt", "remove old-file.js"],
    },
    async ({ path }) => {
      const filePath = resolvePath(path, repoPath);
      const result = await FileOperationsService.delete(filePath);
      return {
        success: result.success,
        message: result.success
          ? `Deleted: ${path}`
          : result.message || "Failed to delete file",
      };
    }
  );

  const fileRename = defineZodAction(
    {
      id: ACTION_ID.FILE_RENAME,
      category: "file",
      layer: "action",
      description: "Rename or move a file",
      params: z.object({
        oldPath: z
          .string()
          .min(1, "Old path cannot be empty")
          .describe("Current file path"),
        newPath: z
          .string()
          .min(1, "New path cannot be empty")
          .describe("New file path"),
      }),
      examples: ["rename utils.ts to helpers.ts", "move file to new folder"],
    },
    async ({ oldPath, newPath }) => {
      const sourceFile = resolvePath(oldPath, repoPath);
      const destFile = resolvePath(newPath, repoPath);
      const result = await FileOperationsService.rename(sourceFile, destFile);
      return {
        success: result.success,
        message: result.success
          ? `Renamed: ${oldPath} → ${newPath}`
          : result.message || "Failed to rename file",
      };
    }
  );

  const folderCreate = defineZodAction(
    {
      id: ACTION_ID.FOLDER_CREATE,
      category: "file",
      layer: "action",
      description: "Create a new folder",
      params: z.object({
        path: z
          .string()
          .min(1, "Path cannot be empty")
          .describe("Path for the new folder (absolute or relative to repo)"),
      }),
      requiresConfirmation: false,
      examples: ["create folder src/utils", "new folder components"],
    },
    async ({ path }) => {
      const folderPath = resolvePath(path, repoPath);
      const result = await FileOperationsService.createFolder(folderPath);
      return {
        success: result.success,
        message: result.success
          ? `Created folder: ${path}`
          : result.message || "Failed to create folder",
      };
    }
  );

  const fileCopy = defineZodAction(
    {
      id: ACTION_ID.FILE_COPY,
      category: "file",
      layer: "action",
      description: "Copy file or folder paths to clipboard for paste operation",
      params: z.object({
        paths: z
          .array(z.string().min(1))
          .min(1, "At least one path required")
          .describe("File or folder paths to copy"),
      }),
      examples: ["copy file", "copy selected files"],
    },
    async ({ paths }) => {
      const resolvedPaths = paths.map((pathItem) =>
        resolvePath(pathItem, repoPath)
      );
      const result = await FileOperationsService.copy(resolvedPaths);
      return {
        success: result.success,
        message: result.success
          ? `Copied ${paths.length} item(s) to clipboard`
          : result.message || "Failed to copy",
      };
    }
  );

  const filePaste = defineZodAction(
    {
      id: ACTION_ID.FILE_PASTE,
      category: "file",
      layer: "action",
      description: "Paste copied files into target directory",
      params: z.object({
        targetDir: z
          .string()
          .min(1, "Target directory cannot be empty")
          .describe("Directory to paste files into"),
      }),
      examples: ["paste files", "paste into folder"],
    },
    async ({ targetDir }) => {
      const targetPath = resolvePath(targetDir, repoPath);
      const result = await FileOperationsService.paste(targetPath);
      return {
        success: result.success,
        message: result.success
          ? result.message || "Files pasted successfully"
          : result.message || "Failed to paste files",
      };
    }
  );

  const fileDuplicate = defineZodAction(
    {
      id: ACTION_ID.FILE_DUPLICATE,
      category: "file",
      layer: "action",
      description: "Duplicate a file or folder with an incremented name",
      params: z.object({
        path: z
          .string()
          .min(1, "Path cannot be empty")
          .describe("File or folder path to duplicate"),
      }),
      examples: ["duplicate file", "copy as new file"],
    },
    async ({ path }) => {
      const filePath = resolvePath(path, repoPath);
      const result = await FileOperationsService.duplicate(filePath);
      return {
        success: result.success,
        message: result.success
          ? result.message || "File duplicated"
          : result.message || "Failed to duplicate",
      };
    }
  );

  return [
    fileSave,
    fileRefresh,
    fileCollapseAll,
    fileCreate,
    fileDelete,
    fileRename,
    folderCreate,
    fileCopy,
    filePaste,
    fileDuplicate,
  ];
}

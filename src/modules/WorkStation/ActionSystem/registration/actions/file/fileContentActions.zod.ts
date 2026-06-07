/**
 * File Content Actions (Zod-based)
 *
 * Actions for reading, editing, and listing directory contents.
 * Part of the file actions factory (requires repoPath).
 */
import { readDir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { z } from "zod";

import { ACTION_ID } from "@src/ActionSystem/actionIds";
import { defineZodAction } from "@src/ActionSystem/schema/defineZodAction";

import { resolvePath } from "./utils";

export function createFileContentActions(repoPath: string) {
  const fileRead = defineZodAction(
    {
      id: ACTION_ID.FILE_READ,
      category: "file",
      layer: "action",
      description:
        "Read file contents. Returns the text content of a file for programmatic use.",
      params: z.object({
        path: z
          .string()
          .min(1, "Path cannot be empty")
          .describe("File path to read (absolute or relative to repo)"),
      }),
      examples: ["read file contents", "get content of utils.ts", "cat file"],
    },
    async ({ path }) => {
      const filePath = resolvePath(path, repoPath);
      try {
        const content = await readTextFile(filePath);
        return {
          success: true,
          message: `Read: ${path}`,
          data: {
            path: filePath,
            content,
            size: content.length,
          },
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
  );

  const fileEdit = defineZodAction(
    {
      id: ACTION_ID.FILE_EDIT,
      category: "file",
      layer: "action",
      description:
        "Edit a file by replacing a string. Reads the file, replaces the first occurrence of oldString with newString, and writes back.",
      params: z.object({
        path: z
          .string()
          .min(1, "Path cannot be empty")
          .describe("File path to edit (absolute or relative to repo)"),
        oldString: z
          .string()
          .min(1, "Old string cannot be empty")
          .describe("The text to find and replace"),
        newString: z.string().describe("The replacement text"),
        replaceAll: z
          .boolean()
          .optional()
          .default(false)
          .describe("Replace all occurrences (default: first only)"),
      }),
      requiresConfirmation: true,
      examples: [
        "replace text in file",
        "edit string in utils.ts",
        "change function name",
      ],
    },
    async ({ path, oldString, newString, replaceAll }) => {
      const filePath = resolvePath(path, repoPath);
      try {
        const content = await readTextFile(filePath);

        if (!content.includes(oldString)) {
          return {
            success: false,
            message: `String not found in file: "${oldString.substring(0, 50)}${oldString.length > 50 ? "..." : ""}"`,
          };
        }

        const occurrenceCount = content.split(oldString).length - 1;
        const replacementCount = replaceAll ? occurrenceCount : 1;

        const updatedContent = replaceAll
          ? content.split(oldString).join(newString)
          : content.replace(oldString, newString);

        await writeTextFile(filePath, updatedContent);

        return {
          success: true,
          message: `Edited: ${path} (${replacementCount} replacement${replacementCount > 1 ? "s" : ""})`,
          data: {
            path: filePath,
            replacements: replacementCount,
          },
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to edit file: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
  );

  const fileListDir = defineZodAction(
    {
      id: ACTION_ID.FILE_LIST_DIR,
      category: "file",
      layer: "action",
      description:
        "List contents of a directory. Returns file and folder names with their types.",
      params: z.object({
        path: z
          .string()
          .optional()
          .describe(
            "Directory path to list (absolute or relative to repo, defaults to repo root)"
          ),
      }),
      examples: ["list files", "ls directory", "show folder contents"],
    },
    async ({ path }) => {
      const dirPath = path ? resolvePath(path, repoPath) : repoPath;
      try {
        const entries = await readDir(dirPath);

        const items = entries.map((entry) => ({
          name: entry.name,
          type: entry.isDirectory ? "directory" : "file",
          isSymlink: entry.isSymlink || false,
        }));

        items.sort((left, right) => {
          if (left.type === right.type)
            return left.name.localeCompare(right.name);
          return left.type === "directory" ? -1 : 1;
        });

        const textLines = items.map(
          (item) =>
            `${item.type === "directory" ? "d" : "-"} ${item.name}${item.isSymlink ? " -> (symlink)" : ""}`
        );

        return {
          success: true,
          message: `Listed: ${dirPath} (${items.length} items)`,
          data: {
            path: dirPath,
            entries: items,
            text: textLines.join("\n"),
            count: items.length,
          },
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to list directory: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
  );

  return [fileRead, fileEdit, fileListDir];
}

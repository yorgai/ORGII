/**
 * File Open & Navigation Actions (Zod-based)
 *
 * Actions for opening files, searching, and revealing in explorer/finder.
 * Part of the file actions factory (requires repoPath).
 */
import { z } from "zod";

import { ACTION_ID } from "@src/ActionSystem/actionIds";
import { defineZodAction } from "@src/ActionSystem/schema/defineZodAction";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import {
  closeGlobalSpotlight,
  openEditorSpotlight,
} from "@src/scaffold/GlobalSpotlight/openSpotlight";
import { FileOperationsService } from "@src/services/file";
import { searchFilesNative } from "@src/util/platform/tauri/fileSearch";

import { resolvePath } from "./utils";

export function createFileOpenActions(repoPath: string) {
  const fileOpen = defineZodAction(
    {
      id: ACTION_ID.FILE_OPEN,
      category: "file",
      layer: "gui",
      description:
        "Search for and open a file. Auto-opens on high confidence match, otherwise shows search results for user to choose.",
      params: z.object({
        path: z
          .string()
          .min(1, "Path cannot be empty")
          .describe("File name or path to search for and open"),
      }),
      shortcut: getShortcutKeys("quick_open"),
      examples: ["open package.json", "show src/index.ts"],
    },
    async ({ path }) => {
      const searchQuery = path;
      const fileName = path.split("/").pop() || path;

      openEditorSpotlight(searchQuery);

      try {
        const results = await searchFilesNative({
          root_path: repoPath,
          query: searchQuery,
          max_results: 10,
          exclude_dirs: [
            "node_modules",
            ".git",
            "dist",
            "build",
            ".next",
            "target",
          ],
        });

        if (results.files.length === 0) {
          return {
            success: false,
            message: `No files found matching: ${searchQuery}`,
          };
        }

        const exactPathMatch = results.files.find(
          (file) =>
            file.path.endsWith(`/${path}`) ||
            file.path === `${repoPath}/${path}`
        );
        const exactNameMatches = results.files.filter(
          (file) => file.filename.toLowerCase() === fileName.toLowerCase()
        );
        const topResult = results.files[0];
        const secondResult = results.files[1];

        const isExactPathMatch = !!exactPathMatch;
        const isSingleExactNameMatch = exactNameMatches.length === 1;
        const isHighScoreWithGap =
          topResult.score > 0.9 &&
          (!secondResult || topResult.score - secondResult.score > 0.2);

        const isHighConfidence =
          isExactPathMatch || isSingleExactNameMatch || isHighScoreWithGap;

        if (isHighConfidence) {
          const fileToOpen = exactPathMatch || exactNameMatches[0] || topResult;

          await new Promise((resolve) => setTimeout(resolve, 400));
          closeGlobalSpotlight();
          await new Promise((resolve) => setTimeout(resolve, 100));

          await FileOperationsService.open(fileToOpen.path);

          return {
            success: true,
            message: `Opened: ${fileToOpen.path.replace(repoPath + "/", "")}`,
          };
        } else {
          return {
            success: true,
            message: `Found ${results.files.length} matches for "${searchQuery}" - please select from spotlight`,
          };
        }
      } catch (error) {
        return {
          success: false,
          message: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
  );

  const fileOpenDirect = defineZodAction(
    {
      id: ACTION_ID.FILE_OPEN_DIRECT,
      category: "file",
      layer: "gui",
      description:
        "Open a known file path directly without starting a search flow",
      params: z.object({
        path: z
          .string()
          .min(1, "Path cannot be empty")
          .describe("File path to open (absolute or relative to repo)"),
      }),
      examples: ["open this exact file", "open /path/to/file.ts"],
    },
    async ({ path }) => {
      const filePath = resolvePath(path, repoPath);
      const result = await FileOperationsService.open(filePath);
      return {
        success: result.success,
        message: result.success
          ? `Opened: ${path}`
          : result.message || "Failed to open file",
      };
    }
  );

  const fileOpenAtLine = defineZodAction(
    {
      id: ACTION_ID.FILE_OPEN_AT_LINE,
      category: "file",
      layer: "gui",
      description: "Open a file and jump to a specific line",
      params: z.object({
        path: z
          .string()
          .min(1, "Path cannot be empty")
          .describe("File path to open (absolute or relative to repo)"),
        line: z
          .number()
          .int()
          .min(1, "Line must be at least 1")
          .describe("Line number to jump to"),
      }),
      examples: ["open file at line 42", "go to line 100 in utils.ts"],
    },
    async ({ path, line }) => {
      const filePath = resolvePath(path, repoPath);
      const result = await FileOperationsService.openAtLine(filePath, line);
      return {
        success: result.success,
        message: result.success
          ? `Opened ${path} at line ${line}`
          : result.message || "Failed to open file",
      };
    }
  );

  const fileSearch = defineZodAction(
    {
      id: ACTION_ID.FILE_SEARCH,
      category: "file",
      description:
        "Search for files using spotlight (Cmd+P) without auto-opening",
      params: z.object({
        query: z
          .string()
          .min(1, "Query cannot be empty")
          .describe("File name or pattern to search for"),
      }),
      shortcut: getShortcutKeys("quick_open"),
      examples: ["find package.json", "search for index.ts"],
    },
    async ({ query }) => {
      openEditorSpotlight(query);

      return {
        success: true,
        message: `Searching for: ${query}`,
      };
    }
  );

  const fileReveal = defineZodAction(
    {
      id: ACTION_ID.FILE_REVEAL,
      category: "file",
      description: "Reveal a file in the file explorer",
      params: z.object({
        path: z
          .string()
          .min(1, "Path cannot be empty")
          .describe("File path to reveal (absolute or relative to repo)"),
      }),
      examples: ["reveal in explorer", "show in files"],
    },
    async ({ path }) => {
      const filePath = resolvePath(path, repoPath);
      const result = await FileOperationsService.reveal(filePath);
      return {
        success: result.success,
        message: result.success
          ? `Revealed: ${path}`
          : result.message || "Failed to reveal file",
      };
    }
  );

  const fileRevealInFinder = defineZodAction(
    {
      id: ACTION_ID.FILE_REVEAL_IN_FINDER,
      category: "file",
      description: "Reveal a file in the OS file manager (Finder/Explorer)",
      params: z.object({
        path: z
          .string()
          .min(1, "Path cannot be empty")
          .describe(
            "File path to reveal in Finder/Explorer (absolute or relative to repo)"
          ),
      }),
      examples: ["reveal in finder", "show in finder", "open in explorer"],
    },
    async ({ path }) => {
      const filePath = resolvePath(path, repoPath);
      const result = await FileOperationsService.revealInFinder(filePath);
      return {
        success: result.success,
        message: result.success
          ? `Revealed in Finder: ${path}`
          : result.message || "Failed to reveal in Finder",
      };
    }
  );

  return [
    fileOpen,
    fileOpenDirect,
    fileSearch,
    fileOpenAtLine,
    fileReveal,
    fileRevealInFinder,
  ];
}

/**
 * App-level file actions.
 *
 * These are not scoped to a WorkStation repo and only operate on explicit
 * absolute paths supplied by the caller.
 */
import { z } from "zod";

import { showInFinder } from "@src/util/platform/ipcRenderer";

import { ACTION_ID } from "../actionIds";
import { defineZodAction } from "../schema/defineZodAction";

const fileRevealInOsFileManager = defineZodAction(
  {
    id: ACTION_ID.FILE_REVEAL_IN_OS_FILE_MANAGER,
    category: "file",
    layer: "gui",
    description: "Reveal an absolute path in the OS file manager",
    params: z.object({
      path: z
        .string()
        .min(1, "Path cannot be empty")
        .describe("Absolute file or directory path to reveal"),
    }),
    examples: ["reveal this path", "show this repo in the OS file manager"],
  },
  async ({ path }) => {
    await showInFinder(path);
    return { success: true, message: `Revealed in OS file manager: ${path}` };
  }
);

export const appFileZodActions = [fileRevealInOsFileManager];

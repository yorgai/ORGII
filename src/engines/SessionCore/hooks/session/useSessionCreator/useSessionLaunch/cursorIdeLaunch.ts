import {
  type CursorIdeControlNewComposerParams,
  cursorBridgeNewComposer,
} from "@src/api/tauri/cursorBridge";
import { promptRestartCursorWithDebugPort } from "@src/api/tauri/cursorBridge/restartDialog";
import { DISPATCH_CATEGORY } from "@src/api/tauri/session";
import type { Session } from "@src/store/session";

export interface BuildCursorComposerParamsOptions {
  cursorCreatorModeOverride: string | null;
  cursorCreatorModelOverride: string | null;
  text: string;
}

export function buildCursorComposerParams(
  options: BuildCursorComposerParamsOptions
): CursorIdeControlNewComposerParams {
  const { cursorCreatorModeOverride, cursorCreatorModelOverride, text } =
    options;

  return {
    text,
    ...(cursorCreatorModelOverride
      ? { modelName: cursorCreatorModelOverride }
      : {}),
    ...(cursorCreatorModeOverride ? { modeId: cursorCreatorModeOverride } : {}),
  };
}

export async function openCursorComposerWithRetry(
  params: CursorIdeControlNewComposerParams
): Promise<Awaited<ReturnType<typeof cursorBridgeNewComposer>>> {
  try {
    return await cursorBridgeNewComposer(params);
  } catch (cursorError) {
    const restarted = await promptRestartCursorWithDebugPort(cursorError);
    if (!restarted) {
      throw cursorError;
    }
    return cursorBridgeNewComposer(params);
  }
}

export function buildCursorIdeSession(options: {
  composerId: string;
  isBackgroundLaunch: boolean;
  sessionName: string;
  userInput: string;
}): Session {
  const { composerId, isBackgroundLaunch, sessionName, userInput } = options;
  const sessionId = `cursoride-${composerId}`;
  const nowIso = new Date().toISOString();

  return {
    session_id: sessionId,
    status: "running",
    created_at: nowIso,
    updated_at: nowIso,
    created_time: nowIso,
    updated_time: nowIso,
    user_input: userInput,
    repo_name: "",
    name: sessionName || userInput.slice(0, 80) || "Cursor IDE",
    branch: "",
    is_active: !isBackgroundLaunch,
    category: DISPATCH_CATEGORY.CURSOR_IDE,
    agentIconId: "cursor",
  };
}

import {
  SESSION_CREATOR_LAUNCH_MODE,
  type SessionCreatorLaunchMode,
} from "@src/features/SessionCreator/types";

export function isBackgroundLaunchMode(
  launchMode: SessionCreatorLaunchMode
): boolean {
  return launchMode === SESSION_CREATOR_LAUNCH_MODE.START_BACKGROUND;
}

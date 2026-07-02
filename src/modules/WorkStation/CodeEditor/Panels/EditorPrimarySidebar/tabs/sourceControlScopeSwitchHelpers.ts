import {
  type SourceControlScope,
  normalizeScopePath,
} from "./sourceControlScopePickerHelpers";

/** Stable identity string for a Source Control scope (local vs worktree path). */
export function scopeIdentityKey(scope: SourceControlScope): string {
  return scope.kind === "worktree" ? normalizeScopePath(scope.path) : "local";
}

/** True when the active scope identity changed since the last committed render. */
export function isScopeIdentityChanging(
  previousKey: string,
  nextKey: string
): boolean {
  return previousKey !== nextKey;
}

/** Whether the scoped file-list pane should show a loading placeholder. */
export function shouldShowScopePaneLoading(options: {
  pendingWorktreeScope: boolean;
  scopeIdentityChanging: boolean;
  paneLoading: boolean;
}): boolean {
  if (options.pendingWorktreeScope) return true;
  if (options.scopeIdentityChanging) return true;
  return options.paneLoading;
}

export const AUTO_SAVE_DEBOUNCE_MS = 1200;

export interface AutoSaveScheduleState {
  autoSaveEnabled: boolean;
  selectedFile: string | null;
  loading: boolean;
  error: unknown | null;
  isBinary: boolean;
  readOnly: boolean;
  contentReady: boolean;
  hasUnsavedChanges: boolean;
  saving: boolean;
  hasSaveHandler: boolean;
  editVersion: number;
  lastAttemptVersion: number;
}

export function shouldScheduleAutoSave(state: AutoSaveScheduleState): boolean {
  if (!state.autoSaveEnabled) return false;
  if (!state.selectedFile) return false;
  if (state.loading) return false;
  if (state.error) return false;
  if (state.isBinary) return false;
  if (state.readOnly) return false;
  if (!state.contentReady) return false;
  if (!state.hasUnsavedChanges) return false;
  if (state.saving) return false;
  if (!state.hasSaveHandler) return false;
  if (state.editVersion === 0) return false;
  if (state.lastAttemptVersion === state.editVersion) return false;
  return true;
}

export interface ScheduleAutoSaveTimerOptions {
  editVersion: number;
  getCurrentEditVersion: () => number;
  markAttempt: (version: number) => void;
  save: () => void | Promise<void>;
  delayMs?: number;
}

export function scheduleAutoSaveTimer({
  editVersion,
  getCurrentEditVersion,
  markAttempt,
  save,
  delayMs = AUTO_SAVE_DEBOUNCE_MS,
}: ScheduleAutoSaveTimerOptions): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    if (getCurrentEditVersion() !== editVersion) return;
    markAttempt(editVersion);
    void save();
  }, delayMs);
}

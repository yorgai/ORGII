import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTO_SAVE_DEBOUNCE_MS,
  type AutoSaveScheduleState,
  scheduleAutoSaveTimer,
  shouldScheduleAutoSave,
} from "../autoSaveScheduler";

const baseScheduleState: AutoSaveScheduleState = {
  autoSaveEnabled: true,
  selectedFile: "/repo/src/index.ts",
  loading: false,
  error: null,
  isBinary: false,
  readOnly: false,
  contentReady: true,
  hasUnsavedChanges: true,
  saving: false,
  hasSaveHandler: true,
  editVersion: 1,
  lastAttemptVersion: 0,
};

describe("autoSaveScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules auto save only when all runtime guards pass", () => {
    expect(shouldScheduleAutoSave(baseScheduleState)).toBe(true);
  });

  it.each<Partial<AutoSaveScheduleState>>([
    { autoSaveEnabled: false },
    { selectedFile: null },
    { loading: true },
    { error: new Error("load failed") },
    { isBinary: true },
    { readOnly: true },
    { contentReady: false },
    { hasUnsavedChanges: false },
    { saving: true },
    { hasSaveHandler: false },
    { editVersion: 0 },
    { lastAttemptVersion: 1 },
  ])("does not schedule when a guard blocks auto save: %o", (override) => {
    expect(shouldScheduleAutoSave({ ...baseScheduleState, ...override })).toBe(
      false
    );
  });

  it("waits for the debounce interval before saving", () => {
    const save = vi.fn();
    const markAttempt = vi.fn();

    scheduleAutoSaveTimer({
      editVersion: 1,
      getCurrentEditVersion: () => 1,
      markAttempt,
      save,
    });

    vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS - 1);
    expect(save).not.toHaveBeenCalled();
    expect(markAttempt).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(markAttempt).toHaveBeenCalledWith(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("skips a stale save when another edit happens before debounce completes", () => {
    const save = vi.fn();
    const markAttempt = vi.fn();
    let currentEditVersion = 1;

    scheduleAutoSaveTimer({
      editVersion: 1,
      getCurrentEditVersion: () => currentEditVersion,
      markAttempt,
      save,
    });

    currentEditVersion = 2;
    vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS);

    expect(markAttempt).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});

/**
 * openFileInEditor — single entry point for "jump to source" from chat blocks.
 *
 * Dispatches the `open-file-in-editor` document CustomEvent that
 * `useCodeEditorEvents` listens for. Centralising this avoids ad-hoc
 * `__TAURI_INTERNALS__` access and keeps the event detail shape typed.
 */

/** Detail payload for the `open-file-in-editor` document event. */
export interface OpenFileInEditorDetail {
  path: string;
  isDirectory?: boolean;
  /** 1-based line to reveal once the file is open. */
  line?: number;
}

/**
 * Open a file (optionally at a line) in the Code Editor.
 * No-op when `path` is empty.
 */
export function openFileInEditor(
  path: string,
  options?: { isDirectory?: boolean; line?: number }
): void {
  const trimmed = path.trim();
  if (trimmed.length === 0) return;

  document.dispatchEvent(
    new CustomEvent<OpenFileInEditorDetail>("open-file-in-editor", {
      detail: {
        path: trimmed,
        isDirectory: options?.isDirectory ?? false,
        line: options?.line,
      },
    })
  );
}

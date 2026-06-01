/**
 * Pending File Opens — module-level queue
 *
 * Simple queue for files that should be opened in the Code Editor
 * when navigating from another page (e.g. Project Manager).
 *
 * Uses a plain module variable (not React state or Jotai atom)
 * to avoid hydration/render timing issues between producers and consumers.
 */

export interface PendingFileOpen {
  path: string;
  line?: number;
}

let queue: PendingFileOpen[] = [];

export function queueFileOpens(files: PendingFileOpen[]): void {
  queue = files;
}

export function consumePendingFileOpens(): PendingFileOpen[] {
  const files = queue;
  queue = [];
  return files;
}

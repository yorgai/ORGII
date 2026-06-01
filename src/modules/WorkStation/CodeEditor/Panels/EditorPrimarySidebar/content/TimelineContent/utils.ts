/**
 * TimelineSection Utilities
 */
import { formatRelativeTime as _formatRelativeTime } from "@src/util/time/formatRelativeTime";

export function formatRelativeTime(timestamp: string): string {
  return _formatRelativeTime(timestamp, "compact");
}

/**
 * Get file basename from path
 */
export function getBasename(filePath: string): string {
  return filePath.split("/").pop() || filePath;
}

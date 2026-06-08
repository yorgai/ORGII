import { formatRelativeTime as _formatRelativeTime } from "@src/util/time/formatRelativeTime";

export function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString();
  } catch {
    return iso;
  }
}

export function formatRelativeTime(iso: string): string {
  return _formatRelativeTime(iso, "nano");
}

export { truncate } from "@src/util/string/truncate";

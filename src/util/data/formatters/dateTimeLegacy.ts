/**
 * Legacy Date/Time Formatters
 *
 * Consolidated from formatTimeStamp.ts and dayjsAdaptArea.ts.
 * These formatters work with Unix timestamps (seconds) or API date strings
 * and do not apply the app-level timezone setting — they use the browser's
 * local timezone or UTC arithmetic directly.
 *
 * Imported and re-exported by date.ts to keep that module under the line limit.
 */
import { parseApiDate } from "./dateCore";

/**
 * Format a Unix timestamp as a readable date/time string
 * @param timestamp - Unix timestamp in seconds
 * @returns Formatted string like "Jan 05, 2025, 14:30"
 */
export const formatDateTime = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  const month = months[date.getMonth()];
  const day = date.getDate().toString().padStart(2, "0");
  const year = date.getFullYear();
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");

  return `${month} ${day}, ${year}, ${hours}:${minutes}`;
};

/**
 * Format a date string as relative time (e.g., "5 minutes ago")
 * Uses timezone-aware parsing via parseApiDate to handle UTC timestamps correctly.
 * @param dateString - ISO date string (assumed UTC if no timezone indicator)
 * @returns Relative time string
 */
export function fromNow(dateString: string): string {
  const date = parseApiDate(dateString);
  if (!date) return "just now";

  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 0) return "just now";

  const intervals = [
    { label: "year", seconds: 31536000 },
    { label: "month", seconds: 2592000 },
    { label: "day", seconds: 86400 },
    { label: "hour", seconds: 3600 },
    { label: "minute", seconds: 60 },
    { label: "second", seconds: 1 },
  ];

  for (const interval of intervals) {
    const count = Math.floor(diffInSeconds / interval.seconds);
    if (count >= 1) {
      return count === 1
        ? `1 ${interval.label} ago`
        : `${count} ${interval.label}s ago`;
    }
  }

  return "just now";
}

/**
 * Format a payment date string (MM-DD-YYYY) to readable format
 * @param dateString - Date string in MM-DD-YYYY format
 * @returns Formatted string like "January 5, 2025"
 */
export function paymentFormatDate(dateString: string): string {
  if (!dateString) return "";

  const parts = dateString.split("-");
  if (parts.length !== 3) return "";

  const [month, day, year] = parts;
  const date = new Date(`${year}-${month}-${day}`);

  if (isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

/**
 * Format seconds as HH:MM:SS for dashboard display
 * @param seconds - Total seconds
 * @returns Formatted string like "02h 15m 30s"
 */
export function formatDashBoardTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return [
    String(hours).padStart(2, "0") + "h",
    String(minutes).padStart(2, "0") + "m",
    String(secs).padStart(2, "0") + "s",
  ].join(" ");
}

/**
 * Format a Unix timestamp as relative time for "Last Fetched" display
 * @param timestamp - Unix timestamp in seconds (UTC)
 * @returns Formatted string like "Last Fetched Minutes"
 */
export function timeAgo(timestamp: number): string {
  const now = new Date();
  const utcNow = now.getTime() / 1000 + now.getTimezoneOffset() * 60;
  const timeDifference = utcNow - timestamp;
  const seconds = Math.floor(timeDifference);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (seconds === 0) return "Last Fetched Now";
  if (seconds < 60) return "Last Fetched Seconds";
  if (minutes < 60) return "Last Fetched Minutes";
  if (hours < 24) return "Last Fetched Hours";
  if (days < 7) return "Last Fetched Days";
  if (weeks < 4) return "Last Fetched Weeks";
  if (months < 12) return "Last Fetched Months";
  return "Last Fetched Years";
}

/**
 * Format time as compact relative string (e.g., "Now", "1m", "5h", "3d", "1w", "1mo", "1y")
 * @param dateString - ISO date string (assumed UTC if no timezone indicator)
 * @returns Compact relative time string
 */
export function formatCompactTimeAgo(
  dateString: string | null | undefined
): string {
  if (!dateString) return "";

  const date = parseApiDate(dateString);
  if (!date) return "";

  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 0) return "Now";
  if (diffInSeconds < 60) return "Now";

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  const diffInHours = Math.floor(diffInMinutes / 60);
  const diffInDays = Math.floor(diffInHours / 24);
  const diffInWeeks = Math.floor(diffInDays / 7);
  const diffInMonths = Math.floor(diffInDays / 30);
  const diffInYears = Math.floor(diffInDays / 365);

  if (diffInMinutes < 60) return `${diffInMinutes}m`;
  if (diffInHours < 24) return `${diffInHours}h`;
  if (diffInDays < 7) return `${diffInDays}d`;
  if (diffInWeeks < 4) return `${diffInWeeks}w`;
  if (diffInMonths < 12) return `${diffInMonths}mo`;
  return `${diffInYears}y`;
}

/**
 * Get the user's timezone offset in minutes
 * @returns Timezone offset in minutes (positive for ahead of UTC)
 */
export const getUserTimeZoneOffset = (): number => {
  const now = new Date();
  return -now.getTimezoneOffset();
};

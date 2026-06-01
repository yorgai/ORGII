/**
 * Timezone Configuration
 *
 * Shared timezone types, options list, and utility functions.
 * Used by both Settings (GeneralSection) and Profile (CoreInfoPanel).
 *
 * Timezone data is stored in timezone-data.json and imported here.
 */
import timezoneData from "./timezone-data.json";

// ============================================
// Types
// ============================================

export type TimezoneOption = "auto" | "utc" | string;

export interface TimezoneOptionItem {
  value: TimezoneOption;
  /** English label (fallback when i18n key not found) */
  label: string;
  /** i18n key for localized label: geo:timezoneLabels.{labelKey} */
  labelKey: string;
  offset: string;
  offsetMinutes: number;
  aliases?: string[];
  region?: string;
}

// ============================================
// Utility Functions
// ============================================

export const getCurrentTimezone = (): TimezoneOption => {
  try {
    const stored = localStorage.getItem("orgii_timezone");
    return stored || "auto";
  } catch {
    return "auto";
  }
};

/**
 * Get timezone offset information for a given timezone
 */
export function getTimezoneOffset(tzValue: TimezoneOption): {
  offset: string;
  offsetMinutes: number;
} {
  if (tzValue === "auto") {
    const now = new Date();
    const offsetMinutes = -now.getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
    const offsetMins = Math.abs(offsetMinutes) % 60;
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const offset =
      offsetMins === 0
        ? `${sign}${offsetHours}`
        : `${sign}${offsetHours}:${String(offsetMins).padStart(2, "0")}`;
    return { offset, offsetMinutes };
  }

  if (tzValue === "utc") {
    return { offset: "+0", offsetMinutes: 0 };
  }

  try {
    const now = new Date();
    // Use Intl API for accurate offset
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tzValue,
      timeZoneName: "longOffset",
    });
    const parts = formatter.formatToParts(now);
    const offsetPart = parts.find((part) => part.type === "timeZoneName");

    if (offsetPart) {
      // Parse offset like "GMT+8" or "GMT-5"
      const match = offsetPart.value.match(/GMT([+-])(\d+)(?::(\d+))?/);
      if (match) {
        const sign = match[1] === "+" ? 1 : -1;
        const hours = parseInt(match[2], 10);
        const minutes = match[3] ? parseInt(match[3], 10) : 0;
        const offsetMinutes = sign * (hours * 60 + minutes);
        const offset =
          minutes === 0
            ? `${match[1]}${hours}`
            : `${match[1]}${hours}:${String(minutes).padStart(2, "0")}`;
        return { offset, offsetMinutes };
      }
    }

    // Fallback: calculate offset manually
    const utcDate = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
    const tzDate = new Date(now.toLocaleString("en-US", { timeZone: tzValue }));
    const offsetMs = tzDate.getTime() - utcDate.getTime();
    const offsetMinutes = Math.round(offsetMs / 60000);
    const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
    const offsetMins = Math.abs(offsetMinutes) % 60;
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const offset =
      offsetMins === 0
        ? `${sign}${offsetHours}`
        : `${sign}${offsetHours}:${String(offsetMins).padStart(2, "0")}`;
    return { offset, offsetMinutes };
  } catch {
    return { offset: "?", offsetMinutes: 0 };
  }
}

/**
 * Get current time string for a given timezone
 */
export function getCurrentTimeForTimezone(tzValue: TimezoneOption): string {
  if (tzValue === "auto") {
    try {
      const now = new Date();
      return now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    } catch {
      return "";
    }
  }

  if (tzValue === "utc") {
    try {
      const now = new Date();
      return now.toLocaleTimeString("en-US", {
        timeZone: "UTC",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    } catch {
      return "";
    }
  }

  try {
    const now = new Date();
    return now.toLocaleTimeString("en-US", {
      timeZone: tzValue,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}

// ============================================
// Timezone Options List
// ============================================

/**
 * Comprehensive list of timezone options with aliases for city search.
 * Sorted by GMT offset (east to west: +12 → -12).
 *
 * Data sourced from timezone-data.json.
 *
 * Used by:
 * - Settings > General > Timezone selector
 * - Profile > CoreInfoPanel > Timezone picker
 */
export const TIMEZONE_OPTIONS: TimezoneOptionItem[] =
  timezoneData as TimezoneOptionItem[];

/**
 * Date Core
 *
 * Leaf module with primitive date helpers that have no upward dependencies
 * on other formatters or on the store. `date.ts` imports from here, so this
 * file MUST NOT import from `date.ts`.
 */

/**
 * Parse a date string from the API, treating it as UTC if no timezone is specified.
 * This fixes the issue where dates like "2025-12-05T03:00:00" are incorrectly
 * interpreted as local time instead of UTC.
 *
 * @param dateString - The date string from the API
 * @returns A Date object representing the correct time
 */
export const parseApiDate = (
  dateString: string | null | undefined
): Date | null => {
  if (!dateString) return null;

  try {
    if (
      dateString.endsWith("Z") ||
      dateString.includes("+") ||
      /[-+]\d{2}:\d{2}$/.test(dateString)
    ) {
      return new Date(dateString);
    }

    return new Date(dateString + "Z");
  } catch {
    return null;
  }
};

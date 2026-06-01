// Event status handling utility functions

/**
 * Get event status, compatible with both object and string formats
 * @param event Event object
 * @returns Status string
 */
export const getEventStatus = (event: unknown): string => {
  if (!event || typeof event !== "object") return "";
  const eventObj = event as Record<string, unknown>;
  if (typeof eventObj.status === "string") {
    return eventObj.status;
  } else if (typeof eventObj.status === "object" && eventObj.status !== null) {
    // If status is an object, get the last value (latest status)
    const statusObj = eventObj.status as Record<string, unknown>;
    const statusKeys = Object.keys(statusObj);
    if (statusKeys.length > 0) {
      const lastKey = statusKeys[statusKeys.length - 1];
      return String(statusObj[lastKey] || "");
    }
  }
  return "";
};

/**
 * Check if event status matches one of the specified statuses
 * @param event Event object
 * @param statuses Array of statuses to check
 * @returns Whether it matches the specified status
 */
export const hasEventStatus = (event: unknown, statuses: string[]): boolean => {
  const currentStatus = getEventStatus(event);
  return statuses.includes(currentStatus);
};

/**
 * Check if event is not in the specified status
 * @param event Event object
 * @param status Status to exclude
 * @returns Whether it is not in the specified status
 */
export const isNotEventStatus = (event: unknown, status: string): boolean => {
  const currentStatus = getEventStatus(event);
  return currentStatus !== status;
};

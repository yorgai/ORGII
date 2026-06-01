import axios, { AxiosResponse, InternalAxiosRequestConfig } from "axios";

import {
  extractFileInfo,
  generateRequestId,
  getApiStack,
  getComponentInfo,
  getTauriStack,
} from "./apiTrackerUtils";

// Extended axios config with tracking properties
interface TrackedAxiosConfig extends InternalAxiosRequestConfig {
  __requestId?: string;
  __captureId?: string;
}

export type InteractionType =
  | "auto"
  | "click"
  | "hover"
  | "keyboard"
  | "focus"
  | "unknown";

export type BackendType = "python" | "rust";

export interface ApiCall {
  id: string;
  method: string;
  url: string;
  fullUrl: string;
  backend: BackendType;
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  data?: unknown;
  status?: number;
  statusText?: string;
  response?: unknown;
  error?: unknown;
  duration?: number;
  timestamp: string;
  componentSelector?: string;
  componentLabel?: string;
  interactionType?: InteractionType;
  filePath?: string;
  componentName?: string;
  functionName?: string;
  lineNumber?: number;
  tauriCommand?: string;
  tauriArgs?: unknown;
}

let apiCalls: ApiCall[] = [];
let trackingEnabled = false;
let tracingModeEnabled = false;
const requestStartTimes = new Map<string, number>();
const MAX_API_CALLS = 100;

// Track recent user interactions to determine interaction type
let recentInteraction: {
  type: InteractionType;
  timestamp: number;
} | null = null;

const INTERACTION_WINDOW_MS = 500; // Consider interactions within 500ms as related

// Detect interaction type from recent events
const detectInteractionType = (): InteractionType => {
  if (!recentInteraction) return "auto";

  const timeSinceInteraction = Date.now() - recentInteraction.timestamp;
  if (timeSinceInteraction > INTERACTION_WINDOW_MS) {
    return "auto";
  }

  return recentInteraction.type;
};

// Track user interactions with named handlers (removable)
function trackClick() {
  recentInteraction = { type: "click", timestamp: Date.now() };
}
function trackHover() {
  recentInteraction = { type: "hover", timestamp: Date.now() };
}
function trackKeyboard() {
  recentInteraction = { type: "keyboard", timestamp: Date.now() };
}
function trackFocus() {
  recentInteraction = { type: "focus", timestamp: Date.now() };
}

if (typeof window !== "undefined") {
  document.addEventListener("click", trackClick, true);
  document.addEventListener("mouseover", trackHover, true);
  document.addEventListener("keydown", trackKeyboard, true);
  document.addEventListener("focus", trackFocus, true);
}

/** Remove all interaction tracking listeners (call on app teardown) */
export function cleanupInteractionTracking() {
  document.removeEventListener("click", trackClick, true);
  document.removeEventListener("mouseover", trackHover, true);
  document.removeEventListener("keydown", trackKeyboard, true);
  document.removeEventListener("focus", trackFocus, true);
}

// Store pending call info (captured before axios processes the request)
const pendingCallInfo = new Map<
  string,
  {
    stack: string;
    fileInfo: ReturnType<typeof extractFileInfo>;
    componentInfo: ReturnType<typeof getComponentInfo>;
  }
>();

/**
 * Capture API call stack at the point of calling the API function.
 * This should be called from apiConfig.ts before the axios request is made.
 * Returns a capture ID that should be passed to the axios config.
 */
export const captureApiCallStack = (): string => {
  const captureId = `capture-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  if (!trackingEnabled) return captureId;

  const stack = getApiStack();
  const fileInfo = extractFileInfo(stack);
  const componentInfo = getComponentInfo();

  pendingCallInfo.set(captureId, { stack, fileInfo, componentInfo });

  // Clean up old entries after 5 seconds (in case request never completes)
  setTimeout(() => {
    pendingCallInfo.delete(captureId);
  }, 5000);

  return captureId;
};

// Initialize axios interceptors
let interceptorsInitialized = false;

export const initializeApiTracking = () => {
  if (interceptorsInitialized || typeof window === "undefined") return;

  // Request interceptor
  const requestInterceptor = axios.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      if (!trackingEnabled) return config;

      const requestId = generateRequestId();
      const startTime = Date.now();
      requestStartTimes.set(requestId, startTime);

      // Store request ID in config for response matching
      (config as TrackedAxiosConfig).__requestId = requestId;

      // Check if we have pre-captured info from wrapper
      const preCaptured = pendingCallInfo.get(
        (config as TrackedAxiosConfig).__captureId ?? ""
      );
      if (preCaptured) {
        pendingCallInfo.delete(
          (config as TrackedAxiosConfig).__captureId ?? ""
        );
      }

      // Get component info at request time (fallback)
      const componentInfo = preCaptured?.componentInfo || getComponentInfo();
      const fileInfo = preCaptured?.fileInfo || {};

      const apiCall: ApiCall = {
        id: requestId,
        method: (config.method || "GET").toUpperCase(),
        url: config.url || "",
        fullUrl: config.baseURL
          ? `${config.baseURL}${config.url}`
          : config.url || "",
        backend: "python",
        headers: config.headers as Record<string, string>,
        params: config.params,
        data: config.data,
        timestamp: new Date().toISOString(),
        componentSelector: componentInfo.selector,
        componentLabel: componentInfo.label,
        interactionType: detectInteractionType(),
        filePath: fileInfo.filePath,
        componentName: fileInfo.componentName,
        functionName: fileInfo.functionName,
        lineNumber: fileInfo.lineNumber,
      };

      // Add to calls list
      apiCalls.unshift(apiCall);
      if (apiCalls.length > MAX_API_CALLS) {
        apiCalls = apiCalls.slice(0, MAX_API_CALLS);
      }

      // Dispatch event for real-time updates when tracing mode is enabled
      if (tracingModeEnabled) {
        window.dispatchEvent(
          new CustomEvent("api-call-updated", {
            detail: { apiCall, totalCalls: apiCalls.length },
          })
        );
      }

      return config;
    },
    (error) => {
      return Promise.reject(error);
    }
  );

  // Response interceptor
  const responseInterceptor = axios.interceptors.response.use(
    (response: AxiosResponse) => {
      if (!trackingEnabled) return response;

      const requestId = (response.config as TrackedAxiosConfig).__requestId;
      if (requestId) {
        const startTime = requestStartTimes.get(requestId);
        const duration = startTime ? Date.now() - startTime : undefined;
        requestStartTimes.delete(requestId);

        // Update API call with response
        const apiCall = apiCalls.find((call) => call.id === requestId);
        if (apiCall) {
          apiCall.status = response.status;
          apiCall.statusText = response.statusText;
          apiCall.response = response.data;
          apiCall.duration = duration;

          // Dispatch event for real-time updates when tracing mode is enabled
          if (tracingModeEnabled) {
            window.dispatchEvent(
              new CustomEvent("api-call-updated", {
                detail: { apiCall, totalCalls: apiCalls.length },
              })
            );
          }
        }
      }

      return response;
    },
    (error) => {
      if (!trackingEnabled) return Promise.reject(error);

      const requestId = (error.config as TrackedAxiosConfig | undefined)
        ?.__requestId;
      if (requestId) {
        const startTime = requestStartTimes.get(requestId);
        const duration = startTime ? Date.now() - startTime : undefined;
        requestStartTimes.delete(requestId);

        // Update API call with error
        const apiCall = apiCalls.find((call) => call.id === requestId);
        if (apiCall) {
          apiCall.status = error.response?.status;
          apiCall.statusText = error.response?.statusText;
          apiCall.error = error.response?.data || error.message;
          apiCall.duration = duration;

          // Dispatch event for real-time updates when tracing mode is enabled
          if (tracingModeEnabled) {
            window.dispatchEvent(
              new CustomEvent("api-call-updated", {
                detail: { apiCall, totalCalls: apiCalls.length },
              })
            );
          }
        }
      }

      return Promise.reject(error);
    }
  );

  interceptorsInitialized = true;

  // Return cleanup function
  return () => {
    axios.interceptors.request.eject(requestInterceptor);
    axios.interceptors.response.eject(responseInterceptor);
    interceptorsInitialized = false;
  };
};

export const enableApiTracking = () => {
  trackingEnabled = true;
  initializeApiTracking();
};

export const disableApiTracking = () => {
  trackingEnabled = false;
  // Drop in-flight timing/capture state since the result-side counterparts
  // early-return while disabled and would otherwise leak entries forever.
  // apiCalls is intentionally preserved so the recent-log UX still works.
  requestStartTimes.clear();
  pendingCallInfo.clear();
};

export const isApiTrackingEnabled = () => trackingEnabled;

export const getApiCalls = (): ApiCall[] => {
  return [...apiCalls];
};

export const getApiCallsForComponent = (
  componentSelector?: string
): ApiCall[] => {
  if (!componentSelector) return getApiCalls();
  return apiCalls.filter(
    (call) => call.componentSelector === componentSelector
  );
};

export const clearApiCalls = () => {
  apiCalls = [];
  requestStartTimes.clear();

  // Dispatch event for UI update
  window.dispatchEvent(
    new CustomEvent("api-call-updated", {
      detail: { apiCall: null, totalCalls: 0 },
    })
  );
};

export const getRecentApiCalls = (limit: number = 20): ApiCall[] => {
  return apiCalls.slice(0, limit);
};

export const isTracingModeEnabled = () => tracingModeEnabled;

export const toggleTracingMode = (): boolean => {
  tracingModeEnabled = !tracingModeEnabled;

  // Dispatch event for UI notification
  window.dispatchEvent(
    new CustomEvent("api-tracing-mode-changed", {
      detail: { enabled: tracingModeEnabled },
    })
  );
  return tracingModeEnabled;
};

export const enableTracingMode = () => {
  if (!tracingModeEnabled) {
    toggleTracingMode();
  }
};

export const disableTracingMode = () => {
  if (tracingModeEnabled) {
    toggleTracingMode();
  }
};

// ============================================
// Tauri Invoke Tracking
// ============================================

/**
 * Track a Tauri invoke call (Rust backend).
 * Called from the invokeTauri wrapper in tauri/init.ts.
 */
export function trackTauriInvoke(
  cmd: string,
  args: unknown,
  requestId: string
): void {
  if (!trackingEnabled) return;

  const stack = getTauriStack();
  const fileInfo = extractFileInfo(stack);
  const componentInfo = getComponentInfo();

  const apiCall: ApiCall = {
    id: requestId,
    method: "INVOKE",
    url: cmd,
    fullUrl: `tauri://${cmd}`,
    backend: "rust",
    tauriCommand: cmd,
    tauriArgs: args,
    data: args,
    timestamp: new Date().toISOString(),
    componentSelector: componentInfo.selector,
    componentLabel: componentInfo.label,
    interactionType: detectInteractionType(),
    filePath: fileInfo.filePath,
    componentName: fileInfo.componentName,
    functionName: fileInfo.functionName,
    lineNumber: fileInfo.lineNumber,
  };

  apiCalls.unshift(apiCall);
  if (apiCalls.length > MAX_API_CALLS) {
    apiCalls = apiCalls.slice(0, MAX_API_CALLS);
  }

  requestStartTimes.set(requestId, Date.now());

  if (tracingModeEnabled) {
    window.dispatchEvent(
      new CustomEvent("api-call-updated", {
        detail: { apiCall, totalCalls: apiCalls.length },
      })
    );
  }
}

/**
 * Record the result of a completed Tauri invoke call.
 */
export function trackTauriInvokeResult(
  requestId: string,
  response: unknown,
  error?: unknown
): void {
  if (!trackingEnabled) return;

  const startTime = requestStartTimes.get(requestId);
  const duration = startTime ? Date.now() - startTime : undefined;
  requestStartTimes.delete(requestId);

  const apiCall = apiCalls.find((call) => call.id === requestId);
  if (!apiCall) return;

  if (error) {
    apiCall.error = error instanceof Error ? error.message : error;
    apiCall.status = 500;
    apiCall.statusText = "Error";
  } else {
    apiCall.response = response;
    apiCall.status = 200;
    apiCall.statusText = "OK";
  }
  apiCall.duration = duration;

  if (tracingModeEnabled) {
    window.dispatchEvent(
      new CustomEvent("api-call-updated", {
        detail: { apiCall, totalCalls: apiCalls.length },
      })
    );
  }
}

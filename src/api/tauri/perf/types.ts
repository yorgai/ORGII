/** Sample region definition (normalized 0.0-1.0) */
export interface SampleRegion {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Luminance result for a region */
export interface LuminanceResult {
  name: string;
  luminance: number;
  is_light: boolean;
}

/** Full luminance analysis result */
export interface LuminanceAnalysis {
  regions: LuminanceResult[];
  processing_time_ms: number;
}

/** Binary check result */
export interface BinaryCheckResult {
  is_binary: boolean;
  reason: string;
  processing_time_us: number;
}

/** JSON parse result */
export interface JsonParseResult {
  value: unknown;
  processing_time_ms: number;
  input_size: number;
}

/** JSON stringify result */
export interface JsonStringifyResult {
  json: string;
  processing_time_ms: number;
  output_size: number;
}

/** JSON validation result */
export interface JsonValidationResult {
  valid: boolean;
  error: string | null;
  processing_time_ms: number;
}

/** Hash result */
export interface HashResult {
  hash: string;
  algorithm: string;
  input_size: number;
  processing_time_ms: number;
}

/** Process metrics snapshot */
export interface ProcessMetrics {
  memory_rss_mb: number;
  memory_virtual_mb: number;
  cpu_percent: number;
  start_time_secs: number;
  uptime_secs: number;
  pid: number;
  name: string;
}

/** Lightweight memory-only metrics */
export interface MemoryMetrics {
  rss_mb: number;
  virtual_mb: number;
}

/** System-wide memory information */
export interface SystemMemoryMetrics {
  total_mb: number;
  used_mb: number;
  available_mb: number;
  swap_total_mb: number;
  swap_used_mb: number;
}

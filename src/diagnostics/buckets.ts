const UNKNOWN_BUCKET = "unknown";

export function bucketDurationMs(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return UNKNOWN_BUCKET;
  const minute = 60_000;
  const hour = 60 * minute;
  if (durationMs < minute) return "lt_1m";
  if (durationMs < 10 * minute) return "1m_10m";
  if (durationMs < 30 * minute) return "10m_30m";
  if (durationMs < hour) return "30m_1h";
  if (durationMs < 2 * hour) return "1h_2h";
  if (durationMs < 6 * hour) return "2h_6h";
  return "6h_plus";
}

export function bucketRamMb(megabytes: number): string {
  if (!Number.isFinite(megabytes) || megabytes <= 0) return UNKNOWN_BUCKET;
  const gigabytes = megabytes / 1024;
  if (gigabytes < 1) return "lt_1gb";
  if (gigabytes < 2) return "1_2gb";
  if (gigabytes < 4) return "2_4gb";
  if (gigabytes < 8) return "4_8gb";
  if (gigabytes < 16) return "8_16gb";
  if (gigabytes < 32) return "16_32gb";
  if (gigabytes < 64) return "32_64gb";
  return "64gb_plus";
}

export function bucketTotalRamGb(gigabytes: number): string {
  if (!Number.isFinite(gigabytes) || gigabytes <= 0) return UNKNOWN_BUCKET;
  if (gigabytes < 8) return "lt_8gb";
  if (gigabytes < 16) return "8_16gb";
  if (gigabytes < 32) return "16_32gb";
  if (gigabytes < 64) return "32_64gb";
  return "64gb_plus";
}

export function bucketCpuPercent(percent: number): string {
  if (!Number.isFinite(percent) || percent < 0) return UNKNOWN_BUCKET;
  if (percent < 5) return "lt_5pct";
  if (percent < 15) return "5_15pct";
  if (percent < 30) return "15_30pct";
  if (percent < 60) return "30_60pct";
  return "60pct_plus";
}

export function bucketCpuCores(cores: number | undefined): string | undefined {
  if (!cores || !Number.isFinite(cores)) return undefined;
  if (cores <= 4) return "1_4";
  if (cores <= 8) return "5_8";
  if (cores <= 16) return "9_16";
  return "17_plus";
}

export function bucketOsVersion(version: string | undefined): string {
  if (!version) return UNKNOWN_BUCKET;
  const match = version.match(/^(\d+)(?:\.(\d+))?/);
  if (!match) return UNKNOWN_BUCKET;
  return match[2] ? `${match[1]}.${match[2]}` : match[1];
}

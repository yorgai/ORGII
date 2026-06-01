const DEFAULT_E2E_BASE_URL = "http://127.0.0.1:13847";

export function e2eBaseUrl() {
  return process.env.E2E_BASE_URL ?? DEFAULT_E2E_BASE_URL;
}

export function e2eUrl(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${e2eBaseUrl()}${normalizedPath}`;
}

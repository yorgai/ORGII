/**
 * Region Availability Check Hook
 *
 * Fetches the user's country via Rust backend (ipinfo.io, bypasses webview
 * cache) and checks it against provider-documented supported regions.
 * Used in the wizard to show a non-blocking warning when a provider may
 * not serve the user's region.
 */
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import type { ModelType } from "@src/assets/providers/types";
import {
  type RegionSupportStatus,
  checkRegionSupport,
  getRestrictedProviders,
  getRestrictedServices,
} from "@src/config/providerRegions";

// ── Module-level geo cache ───────────────────────────────────

interface GeoResult {
  countryCode: string;
  city: string;
  region: string;
}

interface GeoCache extends GeoResult {
  fetchedAt: number;
}

const GEO_CACHE_TTL_MS = 30 * 60 * 1000;
let geoCache: GeoCache | null = null;
let geoInFlight: Promise<GeoResult | null> | null = null;

async function fetchGeo(): Promise<GeoResult | null> {
  if (geoCache && Date.now() - geoCache.fetchedAt < GEO_CACHE_TTL_MS) {
    return geoCache;
  }
  if (geoInFlight) return geoInFlight;

  geoInFlight = (async () => {
    try {
      const data = await invoke<{
        country: string;
        city: string;
        region: string;
      }>("fetch_geo_info");
      const code = data.country || null;
      if (code) {
        const result: GeoResult = {
          countryCode: code,
          city: data.city || "",
          region: data.region || "",
        };
        geoCache = { ...result, fetchedAt: Date.now() };
        return result;
      }
      return null;
    } catch {
      return null;
    } finally {
      geoInFlight = null;
    }
  })();

  return geoInFlight;
}

// ── Hook ─────────────────────────────────────────────────────

export interface RegionCheckResult {
  /** "supported" | "unsupported" | "unknown" (no data) | "loading" */
  status: RegionSupportStatus | "loading";
  /** ISO 3166-1 alpha-2 country code from IP detection */
  countryCode: string | null;
  /** Human-readable location string, e.g. "Shaoxing, Zhejiang, CN" */
  locationText: string | null;
  /** Major providers (OpenAI, Anthropic, Google) that don't support this region */
  restrictedProviders: string[];
  /** Platform services (GitHub, npm, etc.) that may be blocked in this region */
  restrictedServices: string[];
}

/**
 * Check whether the user's detected region is supported by the given provider.
 * Returns "unknown" for providers without documented restrictions.
 */
export function useRegionCheck(agentType: ModelType | ""): RegionCheckResult {
  const [geo, setGeo] = useState<GeoResult | null>(geoCache ?? null);
  const [loading, setLoading] = useState(!geoCache);

  useEffect(() => {
    if (geoCache) return;

    let cancelled = false;

    fetchGeo().then((result) => {
      if (!cancelled) {
        setGeo(result);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const countryCode = geo?.countryCode ?? null;
  const locationText = geo
    ? [geo.city, geo.region, geo.countryCode].filter(Boolean).join(", ")
    : null;

  if (loading || !countryCode) {
    return {
      status: loading ? "loading" : "unknown",
      countryCode,
      locationText: null,
      restrictedProviders: [],
      restrictedServices: [],
    };
  }

  const regionStatus = checkRegionSupport(agentType, countryCode);
  const restrictedProviders = getRestrictedProviders(countryCode);
  const restrictedServices = getRestrictedServices(countryCode);

  return {
    status: regionStatus,
    countryCode,
    locationText,
    restrictedProviders,
    restrictedServices,
  };
}

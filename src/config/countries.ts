/**
 * Country List Configuration
 *
 * Curated list of countries for profile location selection.
 * Labels are resolved via i18n: geo:countries.{code}
 *
 * Naming rules:
 * - Hong Kong → "Hong Kong, China"
 * - Taiwan → "Taiwan, China"
 * - Macau → "Macau, China"
 *
 * Excluded (war zones / sanctions): Israel, Russia, Ukraine, Yemen,
 * Syria, Afghanistan, Iraq, Libya, Somalia, Sudan, South Sudan,
 * North Korea, Iran, Myanmar, Belarus.
 * Palestine is included.
 */

export interface CountryOption {
  /** ISO 3166-1 alpha-2 code */
  code: string;
  /** Region for potential grouping/filtering */
  region: "africa" | "americas" | "asia" | "europe" | "middleEast" | "oceania";
}

/**
 * Country list sorted by region then alphabetically by English name.
 * Display labels come from i18n: `geo:countries.{code}`
 */
export const COUNTRY_OPTIONS: CountryOption[] = [
  // ── Africa ──
  { code: "DZ", region: "africa" },
  { code: "AO", region: "africa" },
  { code: "BW", region: "africa" },
  { code: "CM", region: "africa" },
  { code: "CI", region: "africa" },
  { code: "EG", region: "africa" },
  { code: "ET", region: "africa" },
  { code: "GH", region: "africa" },
  { code: "KE", region: "africa" },
  { code: "MG", region: "africa" },
  { code: "MU", region: "africa" },
  { code: "MA", region: "africa" },
  { code: "MZ", region: "africa" },
  { code: "NA", region: "africa" },
  { code: "NG", region: "africa" },
  { code: "RW", region: "africa" },
  { code: "SN", region: "africa" },
  { code: "ZA", region: "africa" },
  { code: "TZ", region: "africa" },
  { code: "TN", region: "africa" },
  { code: "UG", region: "africa" },
  { code: "ZM", region: "africa" },
  { code: "ZW", region: "africa" },

  // ── Americas ──
  { code: "AR", region: "americas" },
  { code: "BS", region: "americas" },
  { code: "BB", region: "americas" },
  { code: "BO", region: "americas" },
  { code: "BR", region: "americas" },
  { code: "CA", region: "americas" },
  { code: "CL", region: "americas" },
  { code: "CO", region: "americas" },
  { code: "CR", region: "americas" },
  { code: "CU", region: "americas" },
  { code: "DO", region: "americas" },
  { code: "EC", region: "americas" },
  { code: "GT", region: "americas" },
  { code: "HN", region: "americas" },
  { code: "JM", region: "americas" },
  { code: "MX", region: "americas" },
  { code: "NI", region: "americas" },
  { code: "PA", region: "americas" },
  { code: "PY", region: "americas" },
  { code: "PE", region: "americas" },
  { code: "TT", region: "americas" },
  { code: "US", region: "americas" },
  { code: "UY", region: "americas" },
  { code: "VE", region: "americas" },

  // ── Asia ──
  { code: "BD", region: "asia" },
  { code: "BN", region: "asia" },
  { code: "KH", region: "asia" },
  { code: "CN", region: "asia" },
  { code: "GE", region: "asia" },
  { code: "HK", region: "asia" },
  { code: "IN", region: "asia" },
  { code: "ID", region: "asia" },
  { code: "JP", region: "asia" },
  { code: "KZ", region: "asia" },
  { code: "KG", region: "asia" },
  { code: "LA", region: "asia" },
  { code: "MO", region: "asia" },
  { code: "MY", region: "asia" },
  { code: "MV", region: "asia" },
  { code: "MN", region: "asia" },
  { code: "NP", region: "asia" },
  { code: "PK", region: "asia" },
  { code: "PH", region: "asia" },
  { code: "SG", region: "asia" },
  { code: "KR", region: "asia" },
  { code: "LK", region: "asia" },
  { code: "TW", region: "asia" },
  { code: "TH", region: "asia" },
  { code: "UZ", region: "asia" },
  { code: "VN", region: "asia" },

  // ── Europe ──
  { code: "AL", region: "europe" },
  { code: "AD", region: "europe" },
  { code: "AT", region: "europe" },
  { code: "BE", region: "europe" },
  { code: "BA", region: "europe" },
  { code: "BG", region: "europe" },
  { code: "HR", region: "europe" },
  { code: "CY", region: "europe" },
  { code: "CZ", region: "europe" },
  { code: "DK", region: "europe" },
  { code: "EE", region: "europe" },
  { code: "FI", region: "europe" },
  { code: "FR", region: "europe" },
  { code: "DE", region: "europe" },
  { code: "GR", region: "europe" },
  { code: "HU", region: "europe" },
  { code: "IS", region: "europe" },
  { code: "IE", region: "europe" },
  { code: "IT", region: "europe" },
  { code: "XK", region: "europe" },
  { code: "LV", region: "europe" },
  { code: "LI", region: "europe" },
  { code: "LT", region: "europe" },
  { code: "LU", region: "europe" },
  { code: "MT", region: "europe" },
  { code: "MD", region: "europe" },
  { code: "MC", region: "europe" },
  { code: "ME", region: "europe" },
  { code: "NL", region: "europe" },
  { code: "MK", region: "europe" },
  { code: "NO", region: "europe" },
  { code: "PL", region: "europe" },
  { code: "PT", region: "europe" },
  { code: "RO", region: "europe" },
  { code: "SM", region: "europe" },
  { code: "RS", region: "europe" },
  { code: "SK", region: "europe" },
  { code: "SI", region: "europe" },
  { code: "ES", region: "europe" },
  { code: "SE", region: "europe" },
  { code: "CH", region: "europe" },
  { code: "VA", region: "europe" },
  { code: "GB", region: "europe" },

  // ── Middle East ──
  { code: "BH", region: "middleEast" },
  { code: "JO", region: "middleEast" },
  { code: "KW", region: "middleEast" },
  { code: "LB", region: "middleEast" },
  { code: "OM", region: "middleEast" },
  { code: "PS", region: "middleEast" },
  { code: "QA", region: "middleEast" },
  { code: "SA", region: "middleEast" },
  { code: "TR", region: "middleEast" },
  { code: "AE", region: "middleEast" },

  // ── Oceania ──
  { code: "AU", region: "oceania" },
  { code: "FJ", region: "oceania" },
  { code: "NZ", region: "oceania" },
  { code: "PG", region: "oceania" },
];

/** All valid country codes */
export const COUNTRY_CODES = COUNTRY_OPTIONS.map((opt) => opt.code);

/**
 * Countries pinned to the top of the dropdown per language.
 * Shows the most relevant countries for native speakers of each language.
 */
export const PINNED_COUNTRIES_BY_LANGUAGE: Record<string, string[]> = {
  en: ["US", "GB", "CA", "AU", "NZ", "IE"],
  zh: ["CN", "HK", "MO", "TW", "SG", "US", "GB"],
  es: ["ES", "MX", "AR", "CO", "CL", "PE"],
  fr: ["FR", "BE", "CH", "CA", "SN", "CI"],
  ja: ["JP"],
  ko: ["KR"],
  ru: ["KZ", "KG"],
  de: ["DE", "AT", "CH"],
  tr: ["TR"],
  vi: ["VN"],
};

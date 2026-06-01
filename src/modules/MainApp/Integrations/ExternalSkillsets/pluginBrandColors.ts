/**
 * Official brand background colours keyed by plugin slug.
 * Source: Simple Icons (https://simpleicons.org) — these are the hex values
 * each brand has formally approved for icon usage.
 *
 * Simple Icons SVGs carry no fill — we render them white on a branded bg.
 */
export const BRAND_BG: Record<string, string> = {
  // Core dev-tools
  docker: "#2496ED",
  github: "#181717",
  mongodb: "#47A248",
  firebase: "#DD2C00",
  sentry: "#362D59",
  slack: "#4A154B",
  terraform: "#844FBA",
  "terraform-iac": "#844FBA",
  playwright: "#2EAD33",
  "playwright-testing": "#2EAD33",
  "nextjs-react-typescript": "#000000",
  twilio: "#F22F46",

  // Backend frameworks
  "rails-ruby": "#D30001",
  rails: "#D30001",
  "laravel-tallstack": "#FF2D20",
  laravel: "#FF2D20",
  "elixir-phoenix": "#4B275F",
  elixir: "#4B275F",
  "django-python": "#092E20",
  django: "#092E20",
  "fastapi-python": "#009688",
  fastapi: "#009688",
  "go-api-development": "#00ADD8",
  go: "#00ADD8",
  "rust-async": "#000000",
  rust: "#000000",

  // Mobile / frontend
  "flutter-dart": "#02569B",
  flutter: "#02569B",
  "swiftui-ios": "#F05138",
  swift: "#F05138",
  "sveltekit-development": "#FF3E00",
  sveltekit: "#FF3E00",
  "frontend-developer": "#3178C6",

  // ML / Blockchain / Game
  "deep-learning-python": "#EE4C2C",
  "solidity-web3": "#363636",
  solidity: "#363636",
  "unity-gamedev": "#222222",
  unity: "#222222",

  // LaunchDarkly (brand color from their website)
  launchdarkly: "#405BFF",
};

/** True when the SVG has no explicit hex/url fill — it's a monochrome Simple Icon. */
export function isMonochromeSvg(svgText: string): boolean {
  return !/fill="(#(?:[0-9a-fA-F]{3,8})|url\()/i.test(svgText);
}

/**
 * Design token lookup surface for component preview tooling.
 *
 * This module intentionally does not hardcode this repository's token values.
 * The preview feature is intended to work across arbitrary repositories, so
 * token values should come from project CSS extraction/runtime inspection rather
 * than a static orgii_frontend registry.
 */

export function getTokenValue(
  _tokenName: string,
  _theme: "light" | "dark" = "light"
): string | null {
  return null;
}

export function isKnownToken(_tokenName: string): boolean {
  return false;
}

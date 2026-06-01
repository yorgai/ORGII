/**
 * Re-export shim — canonical location is src/config/workstation/tokens.ts
 *
 * WorkStation-internal files may continue importing from this path.
 * External consumers (outside src/modules/WorkStation/) must import from
 * @src/config/workstation/tokens instead.
 */
export * from "@src/config/workstation/tokens";

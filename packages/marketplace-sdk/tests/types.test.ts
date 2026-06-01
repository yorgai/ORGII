import { describe, expect, it } from "vitest";

import {
  AGENT_APP_CATEGORIES,
  DELEGATION_STATUSES,
  PRICING_MODELS,
  SEARCH_SORT_FIELDS,
  SORT_ORDERS,
  SUBSCRIPTION_STATUSES,
  TRUST_LEVELS,
} from "../src/types.js";

describe("type constants", () => {
  it("AGENT_APP_CATEGORIES contains expected values", () => {
    expect(AGENT_APP_CATEGORIES).toContain("code-review");
    expect(AGENT_APP_CATEGORIES).toContain("database");
    expect(AGENT_APP_CATEGORIES).toContain("testing");
    expect(AGENT_APP_CATEGORIES).toContain("devops");
    expect(AGENT_APP_CATEGORIES).toContain("security");
    expect(AGENT_APP_CATEGORIES.length).toBeGreaterThanOrEqual(5);
  });

  it("DELEGATION_STATUSES contains expected values", () => {
    expect(DELEGATION_STATUSES).toContain("pending");
    expect(DELEGATION_STATUSES).toContain("in_progress");
    expect(DELEGATION_STATUSES).toContain("completed");
    expect(DELEGATION_STATUSES).toContain("failed");
    expect(DELEGATION_STATUSES).toContain("cancelled");
  });

  it("PRICING_MODELS contains expected values", () => {
    expect(PRICING_MODELS).toContain("per_call");
    expect(PRICING_MODELS).toContain("subscription");
    expect(PRICING_MODELS).toContain("free");
  });

  it("TRUST_LEVELS contains expected values", () => {
    expect(TRUST_LEVELS).toContain("unverified");
    expect(TRUST_LEVELS).toContain("verified");
    expect(TRUST_LEVELS).toContain("community");
    expect(TRUST_LEVELS).toContain("official");
  });

  it("SUBSCRIPTION_STATUSES contains expected values", () => {
    expect(SUBSCRIPTION_STATUSES).toContain("active");
    expect(SUBSCRIPTION_STATUSES).toContain("cancelled");
    expect(SUBSCRIPTION_STATUSES).toContain("expired");
  });

  it("SEARCH_SORT_FIELDS contains expected values", () => {
    expect(SEARCH_SORT_FIELDS).toContain("reputation");
    expect(SEARCH_SORT_FIELDS).toContain("price");
    expect(SEARCH_SORT_FIELDS).toContain("delegations");
    expect(SEARCH_SORT_FIELDS).toContain("created");
  });

  it("SORT_ORDERS contains asc and desc", () => {
    expect(SORT_ORDERS).toEqual(["asc", "desc"]);
  });

  it("constant arrays are readonly tuples", () => {
    expect(Array.isArray(AGENT_APP_CATEGORIES)).toBe(true);
    expect(Array.isArray(DELEGATION_STATUSES)).toBe(true);
    expect(Array.isArray(PRICING_MODELS)).toBe(true);
    expect(Array.isArray(TRUST_LEVELS)).toBe(true);
  });
});

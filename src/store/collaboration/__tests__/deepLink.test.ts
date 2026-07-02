import { describe, expect, it } from "vitest";

import {
  isCollabJoinDeepLink,
  isCollabShareDeepLink,
  parseCollabJoinDeepLink,
  parseCollabShareDeepLink,
} from "../deepLink";
import {
  buildCollabInviteLink,
  buildCollabSessionShareLink,
} from "../protocol";

const SUPABASE_URL = "https://team-project.supabase.co";
const ANON_KEY = "anon-public-key";
const INVITE = "2poycTL4TJfAc_Zd7mbvmXv_9JtrFX-1";
const ORG_ID = "org-42";
const SHARE_TOKEN = "a".repeat(64);

describe("isCollabJoinDeepLink", () => {
  it("recognizes an orgii collaboration/join link", () => {
    expect(
      isCollabJoinDeepLink(
        `orgii://collaboration/join?sync=supabase&supabase=${encodeURIComponent(SUPABASE_URL)}&invite=${INVITE}`
      )
    ).toBe(true);
  });

  it("ignores trailing slashes and case in scheme", () => {
    expect(
      isCollabJoinDeepLink(`ORGII://collaboration/join/?invite=${INVITE}`)
    ).toBe(true);
  });

  it("rejects a non-collaboration orgii path", () => {
    expect(isCollabJoinDeepLink("orgii://marketplace/callback?code=abc")).toBe(
      false
    );
  });

  it("rejects a different orgii collaboration action", () => {
    expect(isCollabJoinDeepLink("orgii://collaboration/leave")).toBe(false);
  });

  it("does not match yorgai:// links", () => {
    expect(isCollabJoinDeepLink("yorgai://collaboration/join?invite=x")).toBe(
      false
    );
  });
});

describe("parseCollabJoinDeepLink", () => {
  it("parses a valid link with URL-encoded Supabase project", () => {
    expect(
      parseCollabJoinDeepLink(
        `orgii://collaboration/join?sync=supabase&supabase=${encodeURIComponent(SUPABASE_URL)}&anon=${encodeURIComponent(ANON_KEY)}&invite=${INVITE}`
      )
    ).toEqual({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      inviteCode: INVITE,
    });
  });

  it("decodes the Supabase URL built by buildCollabInviteLink round-trip", () => {
    const link = buildCollabInviteLink({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      inviteCode: INVITE,
    });
    expect(parseCollabJoinDeepLink(link)).toEqual({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      inviteCode: INVITE,
    });
  });

  it("allows a missing Supabase URL (user supplies it manually)", () => {
    expect(
      parseCollabJoinDeepLink(`orgii://collaboration/join?invite=${INVITE}`)
    ).toEqual({
      supabaseUrl: undefined,
      anonKey: undefined,
      inviteCode: INVITE,
    });
  });

  it("returns null when the invite code is missing", () => {
    expect(
      parseCollabJoinDeepLink(
        `orgii://collaboration/join?supabase=${encodeURIComponent(SUPABASE_URL)}`
      )
    ).toBeNull();
  });

  it("returns null for a non-collaboration orgii path", () => {
    expect(
      parseCollabJoinDeepLink("orgii://marketplace/callback?code=abc")
    ).toBeNull();
  });

  it("returns null for a yorgai:// OAuth callback (passthrough unaffected)", () => {
    expect(
      parseCollabJoinDeepLink("yorgai://marketplace/callback?code=abc")
    ).toBeNull();
  });

  it("returns null for a malformed link", () => {
    expect(parseCollabJoinDeepLink("orgii://")).toBeNull();
    expect(parseCollabJoinDeepLink("not a url")).toBeNull();
  });
});

describe("isCollabShareDeepLink", () => {
  it("recognizes an orgii collaboration/session link", () => {
    expect(
      isCollabShareDeepLink(
        `orgii://collaboration/session?share=${SHARE_TOKEN}`
      )
    ).toBe(true);
  });

  it("ignores trailing slashes and case in scheme", () => {
    expect(
      isCollabShareDeepLink(
        `ORGII://collaboration/session/?share=${SHARE_TOKEN}`
      )
    ).toBe(true);
  });

  it("does not match the join path (and vice versa)", () => {
    const joinLink = `orgii://collaboration/join?invite=${INVITE}`;
    const shareLink = `orgii://collaboration/session?share=${SHARE_TOKEN}`;
    expect(isCollabShareDeepLink(joinLink)).toBe(false);
    expect(isCollabJoinDeepLink(shareLink)).toBe(false);
  });

  it("does not match yorgai:// links", () => {
    expect(
      isCollabShareDeepLink(`yorgai://collaboration/session?share=x`)
    ).toBe(false);
  });
});

describe("parseCollabShareDeepLink", () => {
  it("decodes the link built by buildCollabSessionShareLink round-trip", () => {
    const link = buildCollabSessionShareLink({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      orgId: ORG_ID,
      shareToken: SHARE_TOKEN,
    });
    expect(parseCollabShareDeepLink(link)).toEqual({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      orgId: ORG_ID,
      shareToken: SHARE_TOKEN,
      inviteCode: undefined,
    });
  });

  it("parses a combined share+invite link with both tokens intact (§6.4)", () => {
    const base = buildCollabSessionShareLink({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      orgId: ORG_ID,
      shareToken: SHARE_TOKEN,
    });
    const combined = `${base}&invite=${INVITE}`;
    // Share resolves first (read-only import); the invite only powers the
    // post-import "join this org" CTA.
    expect(parseCollabShareDeepLink(combined)).toEqual({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      orgId: ORG_ID,
      shareToken: SHARE_TOKEN,
      inviteCode: INVITE,
    });
    // A combined link is NOT a join deep link — it must never route into the
    // JOIN flow directly.
    expect(parseCollabJoinDeepLink(combined)).toBeNull();
  });

  it("returns null when the share token is missing", () => {
    expect(
      parseCollabShareDeepLink(
        `orgii://collaboration/session?org=${ORG_ID}&invite=${INVITE}`
      )
    ).toBeNull();
  });

  it("returns null for join links and malformed input", () => {
    expect(
      parseCollabShareDeepLink(`orgii://collaboration/join?invite=${INVITE}`)
    ).toBeNull();
    expect(parseCollabShareDeepLink("orgii://")).toBeNull();
    expect(parseCollabShareDeepLink("not a url")).toBeNull();
  });
});

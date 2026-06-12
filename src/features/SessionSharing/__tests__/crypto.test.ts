import { describe, expect, it } from "vitest";

import {
  computeShareChallengeResponse,
  createShareChallenge,
  decryptSharePayload,
  encryptSharePayload,
  validateSharePin,
  verifyShareChallengeResponse,
} from "../crypto";
import { SESSION_SHARE_CODE_PREFIX } from "../types";

describe("SessionSharing crypto", () => {
  it("validates 4-8 digit PINs", () => {
    expect(validateSharePin("1234")).toBeNull();
    expect(validateSharePin("12345678")).toBeNull();
    expect(validateSharePin("123")).toBeTruthy();
    expect(validateSharePin("123456789")).toBeTruthy();
    expect(validateSharePin("12a4")).toBeTruthy();
  });

  it("encrypts and decrypts share payloads", async () => {
    const plaintext = JSON.stringify({ type: "offer", sdp: "test-sdp" });
    const code = await encryptSharePayload(plaintext, "123456");

    expect(code.startsWith(`${SESSION_SHARE_CODE_PREFIX}.`)).toBe(true);
    await expect(decryptSharePayload(code, "123456")).resolves.toBe(plaintext);
  });

  it("rejects decrypting with the wrong PIN", async () => {
    const code = await encryptSharePayload("secret", "123456");

    await expect(decryptSharePayload(code, "654321")).rejects.toThrow();
  });

  it("computes and verifies PIN-derived challenge responses", async () => {
    const challenge = createShareChallenge();
    const response = await computeShareChallengeResponse(
      challenge,
      "123456",
      "share-test"
    );

    await expect(
      verifyShareChallengeResponse(challenge, response, "123456", "share-test")
    ).resolves.toBe(true);
    await expect(
      verifyShareChallengeResponse(challenge, response, "654321", "share-test")
    ).resolves.toBe(false);
  });
});

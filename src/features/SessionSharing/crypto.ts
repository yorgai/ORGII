import {
  type EncryptedShareCodePayload,
  SESSION_SHARE_CODE_PREFIX,
  SESSION_SHARE_PROTOCOL_VERSION,
} from "./types";

const PIN_PATTERN = /^\d{4,8}$/;
const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AES_KEY_LENGTH_BITS = 256;
const HMAC_KEY_LENGTH_BITS = 256;

function getCrypto(): Crypto {
  if (globalThis.crypto?.subtle) return globalThis.crypto;
  throw new Error("WebCrypto is not available in this environment.");
}

function getSubtle(): SubtleCrypto {
  return getCrypto().subtle;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  getCrypto().getRandomValues(bytes);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function textToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function toCryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

function bytesToText(value: Uint8Array | ArrayBuffer): string {
  return new TextDecoder().decode(
    value instanceof Uint8Array ? toCryptoBytes(value) : value
  );
}

async function importPinMaterial(pin: string): Promise<CryptoKey> {
  return getSubtle().importKey(
    "raw",
    toCryptoBytes(textToBytes(pin)),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
}

async function deriveAesKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await importPinMaterial(pin);
  return getSubtle().deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toCryptoBytes(salt),
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    { name: "AES-GCM", length: AES_KEY_LENGTH_BITS },
    false,
    ["encrypt", "decrypt"]
  );
}

async function deriveHmacKey(
  pin: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const material = await importPinMaterial(pin);
  return getSubtle().deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toCryptoBytes(salt),
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    { name: "HMAC", hash: "SHA-256", length: HMAC_KEY_LENGTH_BITS },
    false,
    ["sign", "verify"]
  );
}

export function validateSharePin(pin: string): string | null {
  if (!PIN_PATTERN.test(pin)) {
    return "PIN must be 4–8 digits.";
  }
  return null;
}

export function assertValidSharePin(pin: string): void {
  const error = validateSharePin(pin);
  if (error) throw new Error(error);
}

export async function encryptSharePayload(
  plaintext: string,
  pin: string
): Promise<string> {
  assertValidSharePin(pin);
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveAesKey(pin, salt);
  const ciphertext = await getSubtle().encrypt(
    { name: "AES-GCM", iv: toCryptoBytes(iv) },
    key,
    toCryptoBytes(textToBytes(plaintext))
  );
  const payload: EncryptedShareCodePayload = {
    version: SESSION_SHARE_PROTOCOL_VERSION,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
  return `${SESSION_SHARE_CODE_PREFIX}.${bytesToBase64(textToBytes(JSON.stringify(payload)))}`;
}

export async function decryptSharePayload(
  code: string,
  pin: string
): Promise<string> {
  assertValidSharePin(pin);
  const prefix = `${SESSION_SHARE_CODE_PREFIX}.`;
  if (!code.startsWith(prefix)) {
    throw new Error("Invalid share code prefix.");
  }
  const encodedPayload = code.slice(prefix.length);
  const payload = JSON.parse(
    bytesToText(base64ToBytes(encodedPayload))
  ) as EncryptedShareCodePayload;
  if (payload.version !== SESSION_SHARE_PROTOCOL_VERSION) {
    throw new Error(`Unsupported share code version: ${payload.version}`);
  }
  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const key = await deriveAesKey(pin, salt);
  const plaintext = await getSubtle().decrypt(
    { name: "AES-GCM", iv: toCryptoBytes(iv) },
    key,
    toCryptoBytes(base64ToBytes(payload.ciphertext))
  );
  return bytesToText(plaintext);
}

export function createShareChallenge(): string {
  return bytesToBase64(randomBytes(32));
}

export async function computeShareChallengeResponse(
  challenge: string,
  pin: string,
  shareId: string
): Promise<string> {
  assertValidSharePin(pin);
  const salt = textToBytes(`orgii-share-auth:${shareId}`);
  const key = await deriveHmacKey(pin, salt);
  const signature = await getSubtle().sign(
    "HMAC",
    key,
    toCryptoBytes(textToBytes(challenge))
  );
  return bytesToBase64(new Uint8Array(signature));
}

export async function verifyShareChallengeResponse(
  challenge: string,
  response: string,
  pin: string,
  shareId: string
): Promise<boolean> {
  const expected = await computeShareChallengeResponse(challenge, pin, shareId);
  return expected === response;
}

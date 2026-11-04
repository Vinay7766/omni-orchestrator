/**
 * Node side of C17: verifies signed person decisions against the public keys in the desktop app's
 * trust file (outside every project), and signs with a key held in memory (tests, the extension).
 * Keys are Ed25519; public keys are stored raw (32 bytes) in base64.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SignatureCheck, Signer, Trust } from "./integrity.js";

/** `trust.json` in the app's data folder: `{ "formatVersion": 1, "keys": [{ "id", "publicKey", "holder" }] }`. */
export const TRUST_FILE = "trust.json";

/** The app's data folder, as the desktop app computes it (StorageManager::resolve_default_dir). */
export function appDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.APPDATA) return join(env.APPDATA, "AgentOrchestrator");
  return join(env.HOME ?? homedir(), ".config", "AgentOrchestrator");
}

// DER prefix of an Ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function publicKeyFromRaw(base64: string): KeyObject | null {
  const raw = Buffer.from(base64, "base64");
  if (raw.length !== 32) return null;
  try {
    return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: "der", type: "spki" });
  } catch {
    return null;
  }
}

/** Reads the trusted public keys; a missing or malformed file trusts no key (fails closed). */
export async function readTrustedKeys(file: string): Promise<Map<string, KeyObject>> {
  const keys = new Map<string, KeyObject>();
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as { formatVersion?: unknown; keys?: unknown };
    if (parsed.formatVersion !== 1 || !Array.isArray(parsed.keys)) return keys;
    for (const k of parsed.keys as { id?: unknown; publicKey?: unknown }[]) {
      if (typeof k?.id !== "string" || typeof k.publicKey !== "string") continue;
      const key = publicKeyFromRaw(k.publicKey);
      if (key) keys.set(k.id, key);
    }
  } catch {
    // No file yet, or unreadable: nothing is trusted.
  }
  return keys;
}

function check(keys: Map<string, KeyObject>, item: SignatureCheck): boolean {
  const key = keys.get(item.keyId);
  if (!key) return false;
  try {
    return verify(null, Buffer.from(item.message, "utf8"), key, Buffer.from(item.signature, "base64"));
  } catch {
    return false;
  }
}

/** A Trust over the app's trust file, read on each check so a new key is seen at once. */
export function createFileTrust(file: string = join(appDataDir(), TRUST_FILE)): Trust {
  return {
    async verify(items) {
      const keys = await readTrustedKeys(file);
      return items.map((item) => check(keys, item));
    },
  };
}

/** A Trust over keys given directly (tests). */
export function createKeyTrust(publicKeys: Record<string, string>): Trust {
  const keys = new Map<string, KeyObject>();
  for (const [id, raw] of Object.entries(publicKeys)) {
    const key = publicKeyFromRaw(raw);
    if (key) keys.set(id, key);
  }
  return { verify: async (items) => items.map((item) => check(keys, item)) };
}

/** A new Ed25519 key pair: the private key as PKCS#8 DER (base64), the public key raw (base64). */
export function generateSigningKey(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return {
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    publicKey: spki.subarray(SPKI_PREFIX.length).toString("base64"),
  };
}

/**
 * Signs with a private key (PKCS#8 DER, base64) after `confirm` returns true; the caller asks the
 * person. Used by tests and by tools that keep their own key in a secure store.
 */
export function createKeySigner(keyId: string, privateKey: string, confirm: (summary: string) => Promise<boolean> = async () => true): Signer {
  const key = createPrivateKey({ key: Buffer.from(privateKey, "base64"), format: "der", type: "pkcs8" });
  return {
    async sign(request) {
      if (!(await confirm(request.summary))) return null;
      return { keyId, value: sign(null, Buffer.from(request.message, "utf8"), key).toString("base64") };
    },
  };
}

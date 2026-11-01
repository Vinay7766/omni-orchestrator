import { describe, it, expect } from "vitest";
import { redactText, redactJson } from "./redact.js";

// Fake secrets are assembled at runtime so no secret-shaped literal sits in the repo.
const rep = (chars: string, n: number) => chars.repeat(Math.ceil(n / chars.length)).slice(0, n);
const mixed = (n: number) => rep("aB3dE5gH7jK9mN1pQ2rS4tU6vW8xY0z", n);
const fake = {
  openai: "sk" + "-proj-" + mixed(48),
  anthropic: "sk" + "-ant-" + "api03-" + mixed(40),
  google: "AI" + "za" + mixed(35),
  githubClassic: "gh" + "p_" + mixed(36),
  githubFineGrained: "github" + "_pat_" + mixed(60),
  gitlab: "glp" + "at-" + mixed(20),
  aws: "AK" + "IA" + rep("ABCDEFGHIJKLMNOP", 16),
  slack: "xo" + "xb-" + rep("1234567890", 12) + "-" + mixed(24),
  stripe: "sk" + "_live_" + mixed(24),
  jwt: "ey" + "J" + mixed(20) + ".ey" + "J" + mixed(30) + "." + mixed(43),
  privateKey: "-----BEGIN " + "RSA PRIVATE KEY-----\n" + mixed(64) + "\n" + mixed(64) + "\n-----END " + "RSA PRIVATE KEY-----",
  madeUpProviderKey: "zq" + "_live_" + mixed(40),
};

const redacted = (text: string) => redactText(text).text;

describe("redactText: known credential formats", () => {
  for (const [name, secret] of Object.entries(fake)) {
    it(`removes a ${name} secret`, () => {
      const out = redacted(`here is my key: ${secret} thanks`);
      expect(out).not.toContain(secret);
      expect(out).toMatch(/\[REDACTED:[a-z0-9-]+\]/);
    });
  }

  it("removes a multi-line private key block entirely", () => {
    const out = redacted(`before\n${fake.privateKey}\nafter`);
    expect(out).toBe("before\n[REDACTED:private-key]\nafter");
  });
});

describe("redactText: generic structures (providers nobody named)", () => {
  it("removes values assigned to key-like names", () => {
    const value = "Zx9" + mixed(20);
    for (const line of [`api_key = "${value}"`, `SECRET: ${value}`, `"password": "${value}"`, `token=${value}`, `client-secret ${value}`]) {
      expect(redacted(line), line).not.toContain(value);
    }
  });

  it("removes a password embedded in a URL but keeps the rest of the URL", () => {
    const out = redacted("postgres://admin:" + "S3cretPass" + "word@db.example.com:5432/app");
    expect(out).toBe("postgres://admin:[REDACTED:url-password]@db.example.com:5432/app");
  });

  it("removes a bearer token but keeps the header name", () => {
    const token = mixed(32);
    expect(redacted(`Authorization: Bearer ${token}`)).toBe("Authorization: Bearer [REDACTED:bearer-token]");
  });

  it("removes a long high-entropy token from an unknown provider", () => {
    const token = "Qm7" + mixed(45);
    expect(redacted(`use ${token} to connect`)).not.toContain(token);
  });
});

describe("redactText: keeps useful data intact", () => {
  const keep = [
    "commit 4fa3cb92e2942d6594200fa8d2c800708e086072 fixed it",
    "short sha a1b2c3d in the log",
    "id 550e8400-e29b-41d4-a716-446655440000",
    "the token count is too high and the password field is empty",
    "const apiKey = process.env.OPENAI_API_KEY;",
    'password: "${DB_PASSWORD}"',
    "token = os.environ['TOKEN']",
    "https://example.com/docs/getting-started?page=2",
    "function computeChecksum(input: string): number { return input.length; }",
    "C:/Users/someone/Projects/app/src/index.ts",
    "already handled: [REDACTED:openai-key]",
  ];
  for (const text of keep) {
    it(`does not change: ${text.slice(0, 50)}`, () => {
      expect(redacted(text)).toBe(text);
    });
  }
});

describe("redactText: behaviour", () => {
  it("handles several secrets on one line and at the edges of the text", () => {
    const text = `${fake.githubClassic} and ${fake.aws}`;
    const out = redacted(text);
    expect(out).not.toContain(fake.githubClassic);
    expect(out).not.toContain(fake.aws);
    expect(out.startsWith("[REDACTED:")).toBe(true);
  });

  it("is idempotent", () => {
    const once = redacted(`key ${fake.openai} and url https://u:` + "p4ssw0rdValue" + "@h.example.com");
    expect(redacted(once)).toBe(once);
  });

  it("is idempotent when a marker sits where a secret value would be", () => {
    for (const once of ["api_key = [REDACTED:openai-key]", 'password: "[REDACTED:assigned-secret]"', "token [REDACTED:high-entropy]"]) {
      expect(redacted(once), once).toBe(once);
    }
  });

  it("reports findings with rule and position but never the secret", () => {
    const text = `x ${fake.google} y`;
    const { findings } = redactText(text);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({ rule: "google-api-key", start: 2, end: 2 + fake.google.length });
    expect(JSON.stringify(findings)).not.toContain(fake.google);
  });

  it("stays fast on a large input (no catastrophic backtracking)", () => {
    const big = ("ordinary words and symbols = : // @ " + "a".repeat(200) + "\n").repeat(5000);
    const started = performance.now();
    redactText(big);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("redactJson", () => {
  it("redacts strings anywhere in nested objects and arrays, keeping structure", () => {
    const input = {
      note: "fine",
      config: { headers: [`Authorization: Bearer ${mixed(32)}`], key: fake.stripe },
      count: 3,
      ok: true,
      nothing: null,
    };
    const { value, findings } = redactJson(input);
    expect(value).toEqual({
      note: "fine",
      config: { headers: ["Authorization: Bearer [REDACTED:bearer-token]"], key: "[REDACTED:stripe-key]" },
      count: 3,
      ok: true,
      nothing: null,
    });
    expect(findings.map((f) => f.path).sort()).toEqual(["/config/headers/0", "/config/key"]);
  });

  it("does not modify the input object", () => {
    const input = { key: fake.openai };
    redactJson(input);
    expect(input.key).toBe(fake.openai);
  });
});

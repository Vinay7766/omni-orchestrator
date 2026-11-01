/**
 * Removes secrets from text and JSON before anything is written to project memory or a
 * handoff package (MEM-6, HND-5). Results report which rule matched and where, never the
 * secret itself. Redaction is idempotent: redacting already-redacted text changes nothing.
 *
 * Best effort, not a guarantee: it catches known credential formats and common structures
 * (assignments, URLs, headers, key blocks, long random tokens). It cannot recognise a secret
 * with no detectable shape, such as a short password written in a sentence. Docs and UI must
 * describe it that way (HON-3).
 */

export interface TextFinding {
  rule: string;
  /** Position of the redacted span in the original text. */
  start: number;
  end: number;
}

export interface JsonFinding {
  rule: string;
  /** JSON Pointer to the string that contained the secret. */
  path: string;
}

interface Rule {
  name: string;
  /** Must use the g and d flags. */
  pattern: RegExp;
  /** Capture group holding the secret; 0 (default) means the whole match. */
  group?: number;
  /** Return true to keep a candidate (for example an environment-variable reference). */
  keep?: (secret: string) => boolean;
}

const MARKER = /^\[REDACTED:[a-z0-9-]+\]/;

/** Values that point at a secret rather than contain one. */
const isReference = (value: string) =>
  MARKER.test(value) ||
  /^(process\.env|import\.meta\.env|os\.environ|os\.getenv|env\(|System\.getenv|\$\{|\$[A-Z_]|%[A-Z_]+%|<[^>]*>)/i.test(value);

const KEY_NAMES =
  "api[_-]?key|apikey|secret|client[_-]?secret|token|access[_-]?token|auth[_-]?token|refresh[_-]?token|password|passwd|pwd|access[_-]?key|secret[_-]?key|private[_-]?key";

/** Shannon entropy in bits per character. */
function entropy(text: string): number {
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/**
 * Ordered: when two rules match the same span, the earlier, more specific rule names it.
 * Exact formats come first, generic structures after, the entropy heuristic last.
 */
const RULES: Rule[] = [
  {
    name: "private-key",
    pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/dg,
  },
  { name: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/dg },
  { name: "openai-key", pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/dg },
  { name: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/dg },
  { name: "github-token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}\b/dg },
  { name: "github-token", pattern: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/dg },
  { name: "gitlab-token", pattern: /\bglpat-[A-Za-z0-9_-]{20,}/dg },
  { name: "aws-access-key", pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/dg },
  { name: "slack-token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/dg },
  { name: "stripe-key", pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/dg },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/dg },
  { name: "bearer-token", pattern: /(\bBearer\s+)([A-Za-z0-9._~+/=-]{16,})/dgi, group: 2, keep: isReference },
  {
    name: "url-password",
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(@)/dgi,
    group: 2,
    keep: isReference,
  },
  {
    // key = value, key: value, "key": "value"
    name: "assigned-secret",
    pattern: new RegExp(`\\b(?:${KEY_NAMES})\\b["']?\\s*[:=]\\s*["']?([^\\s"',;)}\\]]{8,})`, "dgi"),
    group: 1,
    keep: isReference,
  },
  {
    // key value (no separator): only when the value looks machine-generated, so prose
    // such as "the password field" or "token expiration" is left alone.
    name: "assigned-secret",
    pattern: new RegExp(`\\b(?:${KEY_NAMES})\\b\\s+((?=[^\\s]*\\d)(?=[^\\s]*[A-Za-z])[^\\s"',;]{12,})`, "dgi"),
    group: 1,
    keep: isReference,
  },
  {
    // Long, random-looking tokens from providers nobody listed. Requires upper, lower and
    // digits plus high entropy, so commit SHAs, UUIDs, words and paths are kept.
    name: "high-entropy",
    pattern: /(?<![A-Za-z0-9+_=-])[A-Za-z0-9+_=-]{32,}(?![A-Za-z0-9+_=-])/dg,
    keep: (s) => !(/[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s) && entropy(s) >= 3.5),
  },
];

interface Span {
  rule: string;
  start: number;
  end: number;
  order: number;
}

function findSpans(text: string): Span[] {
  const spans: Span[] = [];
  RULES.forEach((rule, order) => {
    for (const match of text.matchAll(rule.pattern)) {
      const group = rule.group ?? 0;
      const range = match.indices?.[group];
      const secret = match[group];
      if (!range || secret === undefined || rule.keep?.(secret)) continue;
      // Never re-redact an existing marker (keeps redaction idempotent).
      if (MARKER.test(text.slice(range[0]))) continue;
      spans.push({ rule: rule.name, start: range[0], end: range[1], order });
    }
  });
  // Earliest first; for the same start, the longest span; for equal spans, the earlier rule.
  spans.sort((a, b) => a.start - b.start || b.end - a.end || a.order - b.order);
  const chosen: Span[] = [];
  let reachedEnd = -1;
  for (const span of spans) {
    if (span.start >= reachedEnd) {
      chosen.push(span);
      reachedEnd = span.end;
    }
  }
  return chosen;
}

/** Returns the text with every detected secret replaced by [REDACTED:<rule>]. */
export function redactText(text: string): { text: string; findings: TextFinding[] } {
  const spans = findSpans(text);
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += text.slice(cursor, span.start) + `[REDACTED:${span.rule}]`;
    cursor = span.end;
  }
  out += text.slice(cursor);
  return { text: out, findings: spans.map(({ rule, start, end }) => ({ rule, start, end })) };
}

const escapePointer = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");

/** Returns a redacted copy of any JSON value; the input is not modified. */
export function redactJson<T>(value: T): { value: T; findings: JsonFinding[] } {
  const findings: JsonFinding[] = [];
  const walk = (node: unknown, path: string): unknown => {
    if (typeof node === "string") {
      const result = redactText(node);
      for (const f of result.findings) findings.push({ rule: f.rule, path });
      return result.text;
    }
    if (Array.isArray(node)) return node.map((item, i) => walk(item, `${path}/${i}`));
    if (node !== null && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node).map(([k, v]) => [k, walk(v, `${path}/${escapePointer(k)}`)]),
      );
    }
    return node;
  };
  return { value: walk(value, "") as T, findings };
}

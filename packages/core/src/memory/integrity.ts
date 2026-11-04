/**
 * Integrity of the event log (C17; red-team findings RT-1, RT-2; threats T2.1, T2.2).
 *
 * - Every new line carries `prev`, the SHA-256 of the line before it (of "" for the first), so an
 *   edited, inserted or removed earlier line breaks the chain and is reported.
 * - A person's gate decision is signed by the desktop app after the person confirms it in a native
 *   dialog. The private key stays in the operating system's key store; the public keys are in the
 *   app's trust file, outside the project. A program that can write the project folder can still
 *   append lines, but it cannot sign them.
 * - With a Trust (the app, the MCP server, the extension), a decision counts only when its
 *   signature verifies. Unsigned decisions written before the log was chained (projects from
 *   before C17) still count and are reported as not signed. Without a Trust (a library caller),
 *   nothing is verified: decisions count as before, and chain breaks are still reported.
 */
import type { Event } from "../generated/types.js";

/** The decisions only a person may make: they move a gate. */
export const PERSON_DECISIONS: ReadonlySet<Event["type"]> = new Set([
  "phase_approved",
  "changes_requested",
  "phase_skipped",
  "approval_withdrawn",
]);

export interface SignatureCheck {
  keyId: string;
  message: string;
  /** base64 */
  signature: string;
}

/** Verifies signatures against trusted public keys (Rust in the app, node:crypto elsewhere). */
export interface Trust {
  verify(items: SignatureCheck[]): Promise<boolean[]>;
}

export interface SignRequest {
  /** The exact text signed (decisionMessage). */
  message: string;
  projectName: string;
  /** What the person is asked to confirm, in plain words. */
  summary: string;
}

/** Signs a person's decision after they confirm it; null when they decline. */
export interface Signer {
  sign(request: SignRequest): Promise<{ keyId: string; value: string } | null>;
}

export type IntegrityFinding =
  | { kind: "chain_broken"; line: number; eventId?: string }
  | { kind: "duplicate_id"; line: number; eventId: string }
  | { kind: "bad_signature"; line: number; eventId: string; type: Event["type"] }
  | { kind: "unsigned_decision"; line: number; eventId: string; type: Event["type"]; counted: boolean };

export interface IntegrityReport {
  /** Ids of events that must not change the state (unverified decisions, repeated ids). */
  uncounted: Set<string>;
  findings: IntegrityFinding[];
  /** True when the log has chained lines (written by C17 or later). */
  chained: boolean;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/**
 * The text a person's decision is signed over. It names the project and the event's id, so a
 * signed decision cannot be copied into another project or replayed as a new event.
 */
export function decisionMessage(projectId: string, event: Pick<Event, "id" | "time" | "type" | "actor" | "payload">): string {
  return (
    "omni-decision-v1\n" +
    JSON.stringify({
      project: projectId,
      id: event.id,
      time: event.time,
      type: event.type,
      actor: { kind: event.actor.kind, tool: event.actor.tool },
      payload: sortKeys(event.payload),
    })
  );
}

/** SHA-256 of text (UTF-8), lowercase hex. Web Crypto: the same in Node and the web view. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The `prev` for a line appended after `logText` (the whole file as it is). */
export async function prevFor(logText: string): Promise<string> {
  const lines = logText.split("\n").filter((l) => l.trim() !== "");
  return sha256Hex(lines.length > 0 ? lines[lines.length - 1] : "");
}

/**
 * Checks the log: the chain, repeated ids, and (with a Trust) each person decision's signature.
 * `rawLines` are the file's lines (split on \n; line n is rawLines[n - 1]); `events` the valid ones
 * with their line number.
 */
export async function checkIntegrity(
  projectId: string,
  rawLines: string[],
  events: { event: Event; line: number }[],
  trust?: Trust,
): Promise<IntegrityReport> {
  const findings: IntegrityFinding[] = [];
  const uncounted = new Set<string>();
  const byLine = new Map(events.map((e) => [e.line, e.event]));

  // Chain: each line that carries prev must follow the (non-blank) line before it exactly.
  let firstChained = -1;
  let previous = "";
  for (let i = 0; i < rawLines.length; i++) {
    if (rawLines[i].trim() === "") continue;
    const event = byLine.get(i + 1);
    if (event?.prev) {
      if (firstChained === -1) firstChained = i + 1;
      if (event.prev !== (await sha256Hex(previous))) findings.push({ kind: "chain_broken", line: i + 1, eventId: event.id });
    }
    previous = rawLines[i];
  }
  // An unchained line after the chain began was not written by the store.
  for (const { event, line } of events) {
    if (firstChained !== -1 && line > firstChained && !event.prev) findings.push({ kind: "chain_broken", line, eventId: event.id });
  }

  // A repeated id is a copy (for example a signed decision replayed): only the first counts.
  const seen = new Set<string>();
  for (const { event, line } of events) {
    if (seen.has(event.id)) {
      findings.push({ kind: "duplicate_id", line, eventId: event.id });
      uncounted.add(event.id);
    }
    seen.add(event.id);
  }

  const decisions = events.filter(({ event }) => PERSON_DECISIONS.has(event.type) && !uncounted.has(event.id));
  const signed = decisions.filter(({ event }) => event.signature);
  const results = trust && signed.length > 0
    ? await trust.verify(signed.map(({ event }) => ({ keyId: event.signature!.keyId, message: decisionMessage(projectId, event), signature: event.signature!.value })))
    : signed.map(() => false);
  const valid = new Set(signed.filter((_, i) => results[i]).map(({ event }) => event.id));

  for (const { event, line } of decisions) {
    if (valid.has(event.id)) continue;
    if (event.signature) {
      findings.push({ kind: "bad_signature", line, eventId: event.id, type: event.type });
      if (trust) uncounted.add(event.id);
      continue;
    }
    // Unsigned: counts only when written before the log was chained (projects from before C17).
    const legacy = firstChained === -1 || line < firstChained;
    const counted = !trust || legacy;
    findings.push({ kind: "unsigned_decision", line, eventId: event.id, type: event.type, counted });
    if (!counted) uncounted.add(event.id);
  }

  findings.sort((a, b) => a.line - b.line);
  return { uncounted, findings, chained: firstChained !== -1 };
}

/** One sentence per finding, for people (dashboard, gate review, incident response). */
export function describeFinding(f: IntegrityFinding): string {
  switch (f.kind) {
    case "chain_broken":
      return `Line ${f.line}: the history was changed here (an earlier line was edited, removed or inserted by hand).`;
    case "duplicate_id":
      return `Line ${f.line}: a copy of an earlier event (${f.eventId}); only the first one counts.`;
    case "bad_signature":
      return `Line ${f.line}: a ${f.type} whose signature does not match; it does not count.`;
    case "unsigned_decision":
      return f.counted
        ? `Line ${f.line}: a ${f.type} that is not signed (recorded before signing existed, or by a tool that cannot sign).`
        : `Line ${f.line}: a ${f.type} that is not signed by the app; it does not count.`;
  }
}

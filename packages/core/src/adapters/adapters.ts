/**
 * Optional adapters (TOOL-5): known details for one tool each, as data files in
 * packages/core/adapters/. Nothing here is needed for a tool to work; an adapter only adds
 * its exact MCP config locations and the project files it reads instructions from.
 */
import type { Adapter } from "../generated/types.js";
import { validateMemoryFile } from "../validate.js";

export type { Adapter };

export interface AdapterIssue {
  file: string;
  message: string;
}

/** Validates adapter files. Invalid ones are reported and left out; the rest are returned. */
export function parseAdapters(files: { name: string; text: string }[]): { adapters: Adapter[]; issues: AdapterIssue[] } {
  const adapters: Adapter[] = [];
  const issues: AdapterIssue[] = [];
  const claimed = new Map<string, string>();
  for (const { name, text } of files) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      issues.push({ file: name, message: "not valid JSON" });
      continue;
    }
    const result = validateMemoryFile("adapter", data);
    if (!result.ok) {
      issues.push({ file: name, message: result.issues.map((i) => `${i.path} ${i.message}`).join("; ") });
      continue;
    }
    const adapter = result.value;
    if (name !== `${adapter.id}.json`) {
      issues.push({ file: name, message: `the file for adapter "${adapter.id}" must be named ${adapter.id}.json` });
      continue;
    }
    const taken = adapter.matches.find((id) => claimed.has(id));
    if (taken) {
      issues.push({ file: name, message: `tool id "${taken}" is already covered by adapter "${claimed.get(taken)}"` });
      continue;
    }
    for (const id of adapter.matches) claimed.set(id, adapter.id);
    adapters.push(adapter);
  }
  return { adapters, issues };
}

/** The adapter for a discovered tool id, if any. */
export function adapterFor(toolId: string, adapters: readonly Adapter[]): Adapter | undefined {
  return adapters.find((a) => a.matches.includes(toolId));
}

export const MANAGED_BEGIN = "<!-- omni:begin (managed by OmniOrchestrator, safe to delete) -->";
export const MANAGED_END = "<!-- omni:end -->";

export type ManagedBlockStatus = "created" | "appended" | "replaced" | "unchanged" | "unterminated";

/**
 * Puts `body` inside the managed block of an instruction file. The user's content outside the
 * markers is never changed; a begin marker without an end marker is left alone, not guessed.
 * Behaviour is pinned by test-data/managed-block-cases.json, shared with the Rust launcher.
 */
export function applyManagedBlock(existing: string | null, body: string): { text: string; status: ManagedBlockStatus } {
  const nl = existing?.includes("\r\n") ? "\r\n" : "\n";
  const block = `${MANAGED_BEGIN}${nl}${body}${nl}${MANAGED_END}${nl}`;
  if (existing === null) return { text: block, status: "created" };

  const begin = existing.indexOf(MANAGED_BEGIN);
  if (begin >= 0) {
    const endMarker = existing.indexOf(MANAGED_END, begin);
    if (endMarker < 0) return { text: existing, status: "unterminated" };
    let end = endMarker + MANAGED_END.length;
    if (existing.startsWith(nl, end)) end += nl.length;
    const text = existing.slice(0, begin) + block + existing.slice(end);
    return { text, status: text === existing ? "unchanged" : "replaced" };
  }
  if (existing === "") return { text: block, status: "appended" };
  const ending = existing.endsWith(nl) ? "" : nl;
  return { text: existing + ending + nl + block, status: "appended" };
}

export interface McpServerCommand {
  name: string;
  command: string;
  args: string[];
}

export interface McpSnippet {
  /** JSON to merge into the tool's MCP configuration. */
  json: string;
  /** Where that configuration lives, from the adapter; empty when unknown. */
  locations: string[];
  /** True when no adapter was used: the common "mcpServers" form and generic directions. */
  generic: boolean;
}

/** The MCP configuration entry for our server, in the tool's own format when an adapter knows it. */
export function mcpSetupSnippet(server: McpServerCommand, adapter?: Adapter): McpSnippet {
  const format = adapter?.mcp?.format ?? "mcpServers";
  const json = JSON.stringify({ [format]: { [server.name]: { command: server.command, args: server.args } } }, null, 2);
  const locations = [
    ...(adapter?.mcp?.userConfig ?? []),
    ...(adapter?.mcp?.projectConfig ? [`<project>/${adapter.mcp.projectConfig}`] : []),
  ];
  return { json, locations, generic: !adapter?.mcp };
}

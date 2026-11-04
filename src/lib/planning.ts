/**
 * The planning workspace (E5, PLAN-1, PLAN-2): a project starts in the app from the person's
 * idea, and the planning phases run with the person's own model. Phase rules come from
 * @omni/core (the same engine the MCP server uses); documents go to docs/planning/ through the
 * write_planning_document command, which allows nothing else.
 */
import { createInvokeFs, isAbsolutePath, MemoryStore, normalizePath, type Invoke, desktopStoreOptions } from "@omni/core";
import type { BYOKConfig } from "./types";
import { DESKTOP_PERSON } from "./decisions";
import { conversationMarkdown, type ChatMessage } from "./idea-chat";

export type CreateResult = { ok: true; root: string } | { ok: false; error: string };

const MAX_IDEA_CHARS = 20_000;

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The project folder's name: lowercase letters and digits joined by single dashes. */
export function projectFolderName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Whether any provider is set up (a key or a local address); the backend picks the same way. */
export function hasProvider(byok: BYOKConfig): boolean {
  const set = (v?: string) => !!v && v.trim() !== "";
  return [byok.geminiApiKey, byok.anthropicApiKey, byok.openaiApiKey, byok.compatibleBaseUrl, byok.ollamaEndpoint].some(set);
}

/** Creates `<parent>/<folder name>` as a project (flow "build") and saves the idea in it. */
export async function createProjectFromIdea(
  invoke: Invoke,
  input: {
    parent: string;
    name: string;
    idea: string;
    /** The conversation before planning (C); saved as the idea so every phase reads it. */
    conversation?: ChatMessage[];
    /** The idea in one sentence, when the AI said it had understood. */
    summary?: string | null;
    /** Simple mode for a person who asked for guidance (G, NTU-2). */
    mode?: "full" | "simple";
  },
): Promise<CreateResult> {
  const name = input.name.trim();
  const idea = input.idea.trim();
  const folder = projectFolderName(name);
  if (!isAbsolutePath(input.parent)) return { ok: false, error: "Choose the parent folder as a full path (for example C:/Projects)." };
  if (!folder) return { ok: false, error: "Give the project a name with at least one letter or digit." };
  if (!idea) return { ok: false, error: "Describe your idea first." };
  if (idea.length > MAX_IDEA_CHARS) return { ok: false, error: `Keep the idea under ${MAX_IDEA_CHARS} characters.` };

  const root = normalizePath(`${input.parent}/${folder}`);
  try {
    const created = await MemoryStore.create(createInvokeFs(invoke), root, { name, flow: "build", mode: input.mode ?? "full", actor: DESKTOP_PERSON }, desktopStoreOptions(invoke));
    if (!created.ok) {
      const text = created.issues.map((i) => i.message).join("; ");
      return { ok: false, error: /already exists/.test(text) ? `A project already exists in ${root}.` : text };
    }
    const content =
      input.conversation && input.conversation.length > 1
        ? conversationMarkdown(name, input.conversation, input.summary ?? null)
        : `# ${name}: the idea\n\n${idea}\n`;
    await invoke("write_planning_document", { root, name: "idea.md", content });
    return { ok: true, root };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}

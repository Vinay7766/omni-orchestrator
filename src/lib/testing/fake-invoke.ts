/**
 * Tests only: the app's Tauri commands run on real files. memfs_* behave as the Rust side does
 * (C9's contract); find_projects returns what the Rust scan would for the given folders.
 */
import type { Invoke } from "@omni/core";
import { createNodeFs } from "@omni/core/node";

const node = createNodeFs();

export function fakeInvoke(roots: string[] = [], errors: string[] = []): Invoke {
  const a = (args: Record<string, unknown>, key: string) => args[key] as string;
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    find_projects: async () => ({ roots, errors }),
    memfs_read_text: (x) => node.readText(a(x, "path")),
    memfs_write_text: (x) => node.writeText(a(x, "path"), a(x, "content")),
    memfs_append_text: (x) => node.appendText(a(x, "path"), a(x, "content")),
    memfs_create_exclusive: (x) => node.createExclusive(a(x, "path"), a(x, "content")),
    memfs_exists: (x) => node.exists(a(x, "path")),
    memfs_mkdir: (x) => node.mkdir(a(x, "path")),
    memfs_rename: (x) => node.rename(a(x, "from"), a(x, "to")),
    memfs_remove: (x) => node.remove(a(x, "path")),
    memfs_list: (x) => node.list(a(x, "path")),
    // E5: the Rust command also checks the name and refuses links; the tests here cover the app.
    write_planning_document: async (x) => {
      if (!(await node.exists(`${a(x, "root")}/.agents/project.json`))) throw `${a(x, "root")} is not an OmniOrchestrator project`;
      await node.mkdir(`${a(x, "root")}/docs/planning`);
      await node.writeText(`${a(x, "root")}/docs/planning/${a(x, "name")}`, a(x, "content"));
    },
    read_planning_document: (x) => node.readText(`${a(x, "root")}/docs/planning/${a(x, "name")}`),
  };
  return (command, args) => {
    const handler = handlers[command];
    return handler ? handler(args) : Promise.reject(`Unexpected command: ${command}`);
  };
}

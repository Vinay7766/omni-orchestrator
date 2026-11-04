/**
 * Tests only: the app's Tauri commands run on real files. memfs_* behave as the Rust side does
 * (C9's contract); find_projects returns what the Rust scan would for the given folders.
 */
import type { Invoke } from "@omni/core";
import { createKeySigner, createKeyTrust, createNodeFs, generateSigningKey } from "@omni/core/node";
import { statSync } from "node:fs";

const node = createNodeFs();

// Stands in for the app's signing key in the credential store (C17). The native dialog is
// confirmed unless a test says otherwise with `confirmDecisions`.
const appKey = generateSigningKey();
const appTrust = createKeyTrust({ "omni-desktop-test": appKey.publicKey });
let confirming = true;
const appSigner = createKeySigner("omni-desktop-test", appKey.privateKey, async () => confirming);

/** What the person answers in the native confirmation dialog (C17), until changed again. */
export function confirmDecisions(answer: boolean): void {
  confirming = answer;
}

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
    memfs_stamp: async (x) => {
      const info = statSync(a(x, "path"), { throwIfNoEntry: false });
      return info ? `${info.size}:${info.mtimeMs}` : null;
    },
    // E5: the Rust command also checks the name and refuses links; the tests here cover the app.
    write_planning_document: async (x) => {
      if (!(await node.exists(`${a(x, "root")}/.agents/project.json`))) throw `${a(x, "root")} is not an OmniOrchestrator project`;
      await node.mkdir(`${a(x, "root")}/docs/planning`);
      await node.writeText(`${a(x, "root")}/docs/planning/${a(x, "name")}`, a(x, "content"));
    },
    // C17: Rust signs after the native dialog and verifies against the trust file.
    sign_decision: (x) => appSigner.sign({ message: a(x, "message"), projectName: a(x, "projectName"), summary: "" }),
    verify_decisions: (x) => appTrust.verify(x.items as { keyId: string; message: string; signature: string }[]),
    read_planning_document: (x) => node.readText(`${a(x, "root")}/docs/planning/${a(x, "name")}`),
  };
  return (command, args) => {
    const handler = handlers[command];
    return handler ? handler(args) : Promise.reject(`Unexpected command: ${command}`);
  };
}

/** Store options for test setup that writes as the app would: the same key fakeInvoke signs with. */
export function appStoreOptions() {
  return { trust: appTrust, signer: appSigner };
}

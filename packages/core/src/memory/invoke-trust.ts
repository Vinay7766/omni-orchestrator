/**
 * The desktop app's Trust and Signer (C17): both run in Rust, reached through Tauri commands.
 * `sign_decision` shows a native dialog and signs only when the person confirms; the private key
 * never reaches the web view. `verify_decisions` checks signatures against the app's trust file.
 */
import type { Invoke } from "./invoke-fs.js";
import type { Signer, Trust } from "./integrity.js";

export function createInvokeTrust(invoke: Invoke): Trust {
  return {
    verify: async (items) => (items.length === 0 ? [] : ((await invoke("verify_decisions", { items })) as boolean[])),
  };
}

export function createInvokeSigner(invoke: Invoke): Signer {
  return {
    sign: async ({ message, projectName }) =>
      ((await invoke("sign_decision", { message, projectName })) as { keyId: string; value: string } | null) ?? null,
  };
}

/** Store options for the desktop app: every project is opened with both. */
export function desktopStoreOptions(invoke: Invoke): { trust: Trust; signer: Signer } {
  return { trust: createInvokeTrust(invoke), signer: createInvokeSigner(invoke) };
}

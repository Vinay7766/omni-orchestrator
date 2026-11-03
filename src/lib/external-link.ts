/**
 * Links to the web from text the app does not control (skills' sources, documents, memory): only
 * https links without a user name or password become links (RT-9, threat T4.2), and they open in
 * the system browser through the opener, which the app's capability limits to https (P-A10-08).
 * See docs/design-notes/2026-11-03-links-and-opener.md.
 */
import { openUrl } from "@tauri-apps/plugin-opener";

/** The link, normalised, when it is safe to offer; null for anything else. */
export function safeExternalUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return null;
  return url.href;
}

/** Opens a safe link in the system browser; an unsafe one is refused, never opened. */
export async function openExternal(raw: string): Promise<void> {
  const safe = safeExternalUrl(raw);
  if (!safe) throw new Error(`The link was not opened: only https links are opened (${raw.slice(0, 80)}).`);
  await openUrl(safe);
}

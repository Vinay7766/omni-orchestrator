import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAdapters, type Adapter, type AdapterIssue } from "./adapters.js";

/** Reads every <id>.json adapter in a folder. A missing or empty folder means no adapters. */
export async function loadAdapterDirectory(dir: string): Promise<{ adapters: Adapter[]; issues: AdapterIssue[] }> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return { adapters: [], issues: [] };
  }
  const files = await Promise.all(names.map(async (name) => ({ name, text: await readFile(join(dir, name), "utf8") })));
  return parseAdapters(files);
}

/** The adapters shipped with this package (packages/core/adapters). */
export function bundledAdaptersDir(): string {
  // src/adapters/node-source.ts and dist/adapters/node-source.js are both two levels below.
  return fileURLToPath(new URL("../../adapters", import.meta.url));
}

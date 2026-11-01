/**
 * Platform-neutral path helpers. They work on strings only (no Node "path" module), so the
 * same code runs in Node and the desktop web view. Output always uses "/" separators, which
 * every supported OS accepts. Handles POSIX roots ("/"), drive roots ("C:/") and UNC roots
 * ("//server/share").
 */

interface ParsedPath {
  /** "/", "C:/", "//server/share", or "" for a relative path. */
  root: string;
  segments: string[];
}

function parse(path: string): ParsedPath {
  const p = path.replace(/\\/g, "/");
  let root = "";
  let rest = p;
  const unc = /^\/\/([^/]+)\/([^/]+)/.exec(p);
  const drive = /^([A-Za-z]:)(\/|$)/.exec(p);
  if (unc) {
    root = `//${unc[1]}/${unc[2]}`;
    rest = p.slice(unc[0].length);
  } else if (drive) {
    root = `${drive[1]}/`;
    rest = p.slice(drive[0].length);
  } else if (p.startsWith("/")) {
    root = "/";
    rest = p.slice(1);
  }
  const segments: string[] = [];
  for (const part of rest.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") segments.pop();
      else if (root === "") segments.push(".."); // a relative path may start above its base
      continue; // ".." above an absolute root stays at the root
    }
    segments.push(part);
  }
  return { root, segments };
}

function format({ root, segments }: ParsedPath): string {
  const body = segments.join("/");
  if (root === "") return body || ".";
  if (root.startsWith("//")) return body ? `${root}/${body}` : root;
  return root + body; // "/" and "C:/" already end with a slash
}

/** Normalizes separators, "." and ".." segments, duplicate and trailing slashes. */
export function normalizePath(path: string): string {
  return format(parse(path));
}

/** True for "/x", "C:/x", "C:\x" and "//server/share" forms. */
export function isAbsolutePath(path: string): boolean {
  return /^([A-Za-z]:[\\/]|[\\/])/.test(path);
}

/** The containing folder, or null when `path` is already a root. */
export function parentDir(path: string): string | null {
  const parsed = parse(path);
  if (parsed.segments.length === 0) return null;
  return format({ root: parsed.root, segments: parsed.segments.slice(0, -1) });
}

/** Resolves `child` against `base`; an absolute `child` is returned as is (normalized). */
export function joinPath(base: string, child: string): string {
  return isAbsolutePath(child) ? normalizePath(child) : normalizePath(`${base}/${child}`);
}

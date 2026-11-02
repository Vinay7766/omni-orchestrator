// STK-1..3 (A10, C16): checks that a stack ADR has the parts the stack-selection skill requires.
// Pure (no file access), so the MCP server, the app and the repository's own tests share one rule set.

/** Sections every stack ADR needs, in the order the stack-selection skill writes them. */
export const STACK_ADR_SECTIONS = [
  "Status",
  "Context and constraints",
  "Options considered",
  "Decision",
  "Why the others lost",
  "Switch conditions",
  "Sources",
] as const;

/** Splits an ADR into its "## " sections, keyed by heading text. */
function sections(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^## (.+?)\s*$/);
    if (heading) {
      current = heading[1];
      out.set(current, "");
    } else if (current !== null) {
      out.set(current, out.get(current) + line + "\n");
    }
  }
  return out;
}

/** Problems with a stack ADR's text; an empty list means it passes. */
export function checkStackAdr(text: string): string[] {
  const parts = sections(text);
  const problems = STACK_ADR_SECTIONS.filter((name) => !parts.has(name)).map((name) => `missing section: ${name}`);

  const sources = parts.get("Sources");
  if (sources !== undefined && !/https:\/\/\S+/.test(sources)) problems.push("Sources has no https link");

  const decision = parts.get("Decision");
  if (decision !== undefined && !/best fit for these constraints/i.test(decision)) {
    problems.push("Decision must say 'best fit for these constraints', not a universal best");
  }
  return problems;
}

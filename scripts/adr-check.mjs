// A10 / STK-2, STK-3: checks that a stack ADR has the parts the stack-selection skill requires.
// Returns a list of problems; an empty list means the ADR passes.

export const ADR_DIR = "docs/decisions";

const REQUIRED = ["Status", "Context and constraints", "Options considered", "Decision", "Why the others lost", "Switch conditions", "Sources"];

/** Splits an ADR into its "## " sections, keyed by heading text. */
function sections(text) {
  const out = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    const heading = line.match(/^## (.+?)\s*$/);
    if (heading) {
      current = heading[1];
      out.set(current, "");
    } else if (current) {
      out.set(current, out.get(current) + line + "\n");
    }
  }
  return out;
}

export function checkStackAdr(text) {
  const parts = sections(text);
  const problems = REQUIRED.filter((name) => !parts.has(name)).map((name) => `missing section: ${name}`);

  const sources = parts.get("Sources");
  if (sources !== undefined && !/https:\/\/\S+/.test(sources)) problems.push("Sources has no https link");

  const decision = parts.get("Decision");
  if (decision !== undefined && !/best fit for these constraints/i.test(decision)) {
    problems.push("Decision must say 'best fit for these constraints', not a universal best");
  }
  return problems;
}

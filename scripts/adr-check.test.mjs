import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkStackAdr, ADR_DIR } from "./adr-check.mjs";

// A10 / STK-2, STK-3: a stack ADR states its constraints, compares options with sources,
// says why the others lost and what would change the decision, and stays Proposed until a person accepts it.

const complete = `# ADR-007: Stack for a thing

## Status
Proposed

## Context and constraints
Hard filters: runs offline.

## Options considered
| Criterion | A | B |
|---|---|---|
| Offline | yes | no |

## Decision
A is the best fit for these constraints.

## Why the others lost
- B: needs a network connection.

## Switch conditions
- If offline use is dropped, B wins.

## Sources
- https://example.org/a
`;

describe("checkStackAdr", () => {
  it("accepts an ADR with every required section and a linked source", () => {
    expect(checkStackAdr(complete)).toEqual([]);
  });

  it("names each missing section", () => {
    const withoutSwitch = complete.replace(/## Switch conditions[\s\S]*?(?=## Sources)/, "");
    expect(checkStackAdr(withoutSwitch)).toContain("missing section: Switch conditions");
  });

  it("requires at least one https link under Sources", () => {
    const noLink = complete.replace("- https://example.org/a", "- the vendor website");
    expect(checkStackAdr(noLink)).toContain("Sources has no https link");
  });

  it("refuses a universal 'best stack' claim", () => {
    const universal = complete.replace("A is the best fit for these constraints.", "A is the best stack.");
    expect(checkStackAdr(universal)).toContain("Decision must say 'best fit for these constraints', not a universal best");
  });

  it("requires a status", () => {
    expect(checkStackAdr(complete.replace(/## Status\nProposed\n/, ""))).toContain("missing section: Status");
  });
});

describe("stack ADRs in this repository", () => {
  const files = readdirSync(join(process.cwd(), ADR_DIR)).filter((f) => /^ADR-\d+-.*stack.*\.md$/.test(f));

  it("include the stack-selection dry run", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s passes the check", (file) => {
    const text = readFileSync(join(process.cwd(), ADR_DIR, file), "utf8").replace(/\r\n/g, "\n");
    expect(checkStackAdr(text)).toEqual([]);
  });
});

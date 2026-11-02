import { describe, it, expect } from "vitest";
import { checkStackAdr } from "./stack-adr.js";

// STK-1..3 (C16): a stack ADR states its constraints, compares options with sources,
// says why the others lost and what would change the decision.

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
    expect(checkStackAdr(withoutSwitch)).toEqual(["missing section: Switch conditions"]);
  });

  it("names every section of an empty file", () => {
    expect(checkStackAdr("")).toEqual([
      "missing section: Status",
      "missing section: Context and constraints",
      "missing section: Options considered",
      "missing section: Decision",
      "missing section: Why the others lost",
      "missing section: Switch conditions",
      "missing section: Sources",
    ]);
  });

  it("requires at least one https link under Sources", () => {
    const noLink = complete.replace("- https://example.org/a", "- the vendor website");
    expect(checkStackAdr(noLink)).toEqual(["Sources has no https link"]);
  });

  it("refuses a universal 'best stack' claim", () => {
    const universal = complete.replace("A is the best fit for these constraints.", "A is the best stack.");
    expect(checkStackAdr(universal)).toEqual(["Decision must say 'best fit for these constraints', not a universal best"]);
  });

  it("requires a status", () => {
    expect(checkStackAdr(complete.replace(/## Status\nProposed\n/, ""))).toEqual(["missing section: Status"]);
  });

  it("reads a file saved with Windows line endings", () => {
    expect(checkStackAdr(complete.replace(/\n/g, "\r\n"))).toEqual([]);
  });

  it("does not count a heading that only appears inside another section's text", () => {
    const quoted = complete.replace(/## Sources\n- https:\/\/example.org\/a\n/, "").replace("Hard filters: runs offline.", "Hard filters: runs offline. See ## Sources below.");
    expect(checkStackAdr(quoted)).toEqual(["missing section: Sources"]);
  });
});

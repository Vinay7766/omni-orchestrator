import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// One rule set: the same check the MCP server applies to an architecture submission (C16).
// Its unit tests live next to it in packages/core/src/engine/stack-adr.test.ts.
import { checkStackAdr } from "../packages/core/src/engine/stack-adr.ts";

const ADR_DIR = "docs/decisions";

describe("stack ADRs in this repository", () => {
  const files = readdirSync(join(process.cwd(), ADR_DIR)).filter((f) => /^ADR-\d+-.*stack.*\.md$/.test(f));

  it("include the stack-selection dry run", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s passes the check", (file) => {
    expect(checkStackAdr(readFileSync(join(process.cwd(), ADR_DIR, file), "utf8"))).toEqual([]);
  });
});

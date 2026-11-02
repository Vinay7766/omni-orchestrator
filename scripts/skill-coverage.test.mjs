import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderCoverage, REPORT_PATH } from "./skill-coverage.mjs";

// A7 / SKL-7 / SKL-9: the coverage report shows every domain with its function, the phases that
// function works in, and the skills covering it; gaps are listed. Generated, never hand-edited.

const read = (p) => JSON.parse(readFileSync(resolve(process.cwd(), p), "utf8"));
const real = () => ({ catalog: read("skills/catalog.json"), domains: read("skills/domains.json") });

const tiny = {
  catalog: [
    { id: "made-up-skill", domains: ["made-up-domain"] },
    { id: "another-skill", domains: ["made-up-domain", "second-domain"] },
  ],
  domains: {
    functions: [{ id: "made-up-function", description: "A function", phases: ["alpha", "beta"] }],
    domains: [
      { id: "made-up-domain", description: "First", function: "made-up-function" },
      { id: "second-domain", description: "Second", function: "made-up-function" },
      { id: "empty-domain", description: "Nobody covers it", function: "made-up-function" },
    ],
    pendingGaps: ["empty-domain"],
    sources: [{ name: "A yardstick", url: "https://example.org/yardstick" }],
  },
};

describe("renderCoverage", () => {
  it("lists each domain with its function, that function's phases, and its skills", () => {
    const md = renderCoverage(tiny.catalog, tiny.domains);
    expect(md).toContain("| made-up-domain | made-up-function | alpha, beta | another-skill, made-up-skill |");
    expect(md).toContain("| second-domain | made-up-function | alpha, beta | another-skill |");
  });

  it("marks an uncovered domain as a gap, in the table and in the gap list", () => {
    const md = renderCoverage(tiny.catalog, tiny.domains);
    expect(md).toContain("| empty-domain | made-up-function | alpha, beta | **gap** |");
    expect(md).toMatch(/## Gaps[\s\S]*- empty-domain: Nobody covers it/);
  });

  it("cites the yardsticks", () => {
    expect(renderCoverage(tiny.catalog, tiny.domains)).toContain("[A yardstick](https://example.org/yardstick)");
  });

  it("is up to date in the repository (run npm run skills:coverage after changing the catalog or domains)", () => {
    const { catalog, domains } = real();
    expect(readFileSync(resolve(process.cwd(), REPORT_PATH), "utf8").replace(/\r\n/g, "\n")).toBe(renderCoverage(catalog, domains));
  });
});

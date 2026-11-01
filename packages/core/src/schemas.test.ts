import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

// The contract lives at the repository root, shared with the Rust app.
const schemasDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "schemas");
const fixturesDir = join(schemasDir, "fixtures");

function loadValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const file of readdirSync(schemasDir).filter((f) => f.endsWith(".schema.json"))) {
    ajv.addSchema(JSON.parse(readFileSync(join(schemasDir, file), "utf8")));
  }
  return ajv;
}

const ajv = loadValidator();
const schemaNames = readdirSync(fixturesDir);

describe("project memory schemas", () => {
  it("has fixtures for every schema except the shared definitions", () => {
    const schemas = readdirSync(schemasDir)
      .filter((f) => f.endsWith(".schema.json"))
      .map((f) => f.replace(".schema.json", ""))
      .filter((name) => name !== "common");
    expect(schemaNames.sort()).toEqual(schemas.sort());
  });

  for (const name of schemaNames) {
    const validate = ajv.getSchema(`urn:omni:schema:${name}`);

    describe(name, () => {
      it("compiles", () => {
        expect(validate, `schema urn:omni:schema:${name} not found`).toBeDefined();
      });

      for (const kind of ["valid", "invalid"] as const) {
        for (const file of readdirSync(join(fixturesDir, name, kind))) {
          it(`${kind}: ${file}`, () => {
            const data = JSON.parse(readFileSync(join(fixturesDir, name, kind, file), "utf8"));
            const ok = validate!(data);
            if (kind === "valid") {
              expect(ok, JSON.stringify(validate!.errors, null, 2)).toBe(true);
            } else {
              expect(ok, `${file} should be rejected but was accepted`).toBe(false);
            }
          });
        }
      }
    });
  }
});

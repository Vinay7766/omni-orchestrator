// Generates the TypeScript side of the project-memory contract from /schemas:
//   src/generated/validators.ts  ajv "standalone" validators (no runtime eval, so
//                                they work under the desktop app's strict CSP)
//   src/generated/types.ts       TypeScript types for every memory file
//   src/generated/contract.ts    schema names, validator export names, phase ids
// Run: npm run generate -w @omni/core. A test fails if the committed output is stale.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import { compile } from "json-schema-to-typescript";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemasDir = join(packageDir, "..", "..", "schemas");
const URN = "urn:omni:schema:";
const BANNER = "// GENERATED from /schemas by scripts/generate-contract.mjs. Do not edit by hand.\n";

const exportName = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const pascal = (name) => exportName(name).replace(/^[a-z]/, (c) => c.toUpperCase());

function loadSchemas() {
  const files = readdirSync(schemasDir).filter((f) => f.endsWith(".schema.json")).sort();
  return files.map((file) => ({
    name: file.replace(".schema.json", ""),
    schema: JSON.parse(readFileSync(join(schemasDir, file), "utf8")),
  }));
}

// ajv's string-length helper (MIT, ajv/lib/runtime/ucs2length.ts), inlined so the
// generated module needs no require() and runs as a plain ES module in any runtime.
const UCS2LENGTH = `function __ucs2length(str) {
  let length = 0, pos = 0, value;
  while (pos < str.length) {
    length++;
    value = str.charCodeAt(pos++);
    if (value >= 0xd800 && value <= 0xdbff && pos < str.length) {
      value = str.charCodeAt(pos);
      if ((value & 0xfc00) === 0xdc00) pos++;
    }
  }
  return length;
}
`;

function buildValidators(schemas, fileNames) {
  const ajv = new Ajv2020({ allErrors: true, strict: true, code: { source: true, esm: true } });
  for (const { schema } of schemas) ajv.addSchema(schema);
  const refs = Object.fromEntries(fileNames.map((n) => [exportName(n), `${URN}${n}`]));
  // Shared definitions get validators too (exported as common<Name>), so code can check a
  // single value, such as a path or commit SHA, with exactly the schema's rule.
  const common = schemas.find((s) => s.name === "common");
  for (const def of Object.keys(common?.schema.$defs ?? {})) {
    refs[`common${pascal(def)}`] = `${URN}common#/$defs/${def}`;
  }
  const code = standaloneCode(ajv, refs).replaceAll('require("ajv/dist/runtime/ucs2length").default', "__ucs2length");
  const leftover = code.match(/require\("[^"]+"\)/g);
  if (leftover) {
    throw new Error(`generated validators still need ${[...new Set(leftover)].join(", ")}; adjust the schemas so they don't`);
  }
  return BANNER + "// @ts-nocheck\n/* eslint-disable */\n" + UCS2LENGTH + code + "\n";
}

// json-schema-to-typescript cannot resolve urn: refs, so bundle every schema into one
// document with prefixed $defs and local refs, then compile it once (one set of types).
function bundleForTypes(schemas, fileNames) {
  const defs = {};
  const rewrite = (node, owner) => {
    if (Array.isArray(node)) return node.map((n) => rewrite(n, owner));
    if (!node || typeof node !== "object") return node;
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "$id" || key === "$schema") continue;
      if (key === "$ref" && typeof value === "string") {
        if (value.startsWith(URN)) {
          const [doc, pointer] = value.slice(URN.length).split("#/$defs/");
          out.$ref = pointer ? `#/$defs/${doc}_${pointer}` : `#/$defs/${pascal(doc)}`;
        } else {
          out.$ref = value.replace("#/$defs/", `#/$defs/${owner}_`);
        }
        continue;
      }
      if (key === "$defs") continue;
      out[key] = rewrite(value, owner);
    }
    return out;
  };
  for (const { name, schema } of schemas) {
    for (const [defName, def] of Object.entries(schema.$defs ?? {})) {
      defs[`${name}_${defName}`] = { title: pascal(`${name}-${defName}`), ...rewrite(def, name) };
    }
    if (fileNames.includes(name)) defs[pascal(name)] = rewrite(schema, name);
  }
  return {
    title: "MemoryFileTypes",
    description: "Every project-memory file type, keyed by schema name.",
    type: "object",
    additionalProperties: false,
    required: fileNames,
    properties: Object.fromEntries(fileNames.map((n) => [n, { $ref: `#/$defs/${pascal(n)}` }])),
    $defs: defs,
  };
}

function buildContract(fileNames) {
  const phases = JSON.parse(readFileSync(join(schemasDir, "phases.json"), "utf8"));
  const phaseIds = [...new Set(Object.values(phases.flows).flat())];
  return (
    BANNER +
    `export const SCHEMA_NAMES = ${JSON.stringify(fileNames)} as const;\n` +
    `export const VALIDATOR_EXPORTS = ${JSON.stringify(Object.fromEntries(fileNames.map((n) => [n, exportName(n)])))} as const;\n` +
    `export const FLOWS = ${JSON.stringify(phases.flows)} as const;\n` +
    `export const PHASE_IDS = ${JSON.stringify(phaseIds)} as const;\n` +
    `/** Phases that need a confirmed Understanding check when submitted (UND-1). */\n` +
    `export const PLANNING_PHASES = ${JSON.stringify(phases.planning ?? [])} as const;\n`
  );
}

/** Returns { "src/generated/<file>": content } without writing anything. */
export async function generateContract() {
  const schemas = loadSchemas();
  // "common" holds shared definitions only; every other schema describes a memory file.
  const fileNames = schemas.map((s) => s.name).filter((n) => n !== "common");
  const types = await compile(bundleForTypes(schemas, fileNames), "MemoryFileTypes", {
    bannerComment: BANNER.trim(),
    additionalProperties: false,
    unreachableDefinitions: true,
    style: { singleQuote: false, printWidth: 100 },
  });
  return {
    "src/generated/validators.ts": buildValidators(schemas, fileNames),
    "src/generated/types.ts": types.replace(/\r\n/g, "\n"),
    "src/generated/contract.ts": buildContract(fileNames),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = await generateContract();
  mkdirSync(join(packageDir, "src", "generated"), { recursive: true });
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(packageDir, rel), content);
  console.log(`wrote ${Object.keys(files).join(", ")}`);
}

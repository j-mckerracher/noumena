/**
 * Tests for fixture-loading helpers.
 * AC-006: Fixture loading helpers importable in test code.
 */

import { describe, it, expect } from "vitest";
import {
  fixturePath,
  readFixture,
  readFixtureBytes,
  readFixtureJson,
  schemaPath,
  readSchema,
  loadNativeFixture,
  loadMalformedFixture,
  loadPatchFixture,
  loadExpectedFixture,
  loadValidFixture,
  loadInvalidFixture,
} from "../src/fixtures.js";

describe("fixturePath", () => {
  it("resolves native fixture path", () => {
    const p = fixturePath("native", "research-note-empty.html");
    expect(p).toContain("fixtures/native/research-note-empty.html");
  });

  it("resolves validation/valid fixture path", () => {
    const p = fixturePath("validation/valid", "research-note-empty.valid.html");
    expect(p).toContain("fixtures/validation/valid/research-note-empty.valid.html");
  });
});

describe("readFixture", () => {
  it("reads native fixture as string", () => {
    const content = readFixture("native", "research-note-empty.html");
    expect(content).toContain("<!doctype html>");
    expect(content).toContain("noumena.html.v1");
  });

  it("reads malformed fixture", () => {
    const content = readFixture("malformed", "invalid-metadata-json.html");
    expect(content).toContain("noumena:schema");
  });
});

describe("readFixtureBytes", () => {
  it("reads fixture as Buffer", () => {
    const buf = readFixtureBytes("native", "research-note-empty.html");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });
});

describe("readFixtureJson", () => {
  it("reads and parses patch fixture JSON", () => {
    const patch = readFixtureJson<{ schema: string }>("patches", "append-evidence.valid.json");
    expect(patch.schema).toBe("noumena.patch.v1");
  });
});

describe("schemaPath", () => {
  it("resolves schema file path", () => {
    const p = schemaPath("noumena-patch-v1.schema.json");
    expect(p).toContain("schemas/noumena-patch-v1.schema.json");
  });
});

describe("readSchema", () => {
  it("reads and parses JSON Schema", () => {
    const schema = readSchema<{ title: string }>("noumena-patch-v1.schema.json");
    expect(schema.title).toBe("Noumena Patch v1");
  });

  it("reads CLI result schema", () => {
    const schema = readSchema<{ title: string }>("noumena-cli-result-v1.schema.json");
    expect(schema.title).toBe("Noumena CLI Result v1");
  });
});

describe("convenience loaders", () => {
  it("loadNativeFixture reads native HTML", () => {
    const html = loadNativeFixture("research-note-empty.html");
    expect(html).toContain("data-noumena-document");
  });

  it("loadMalformedFixture reads malformed HTML", () => {
    const html = loadMalformedFixture("missing-required-role.html");
    expect(html).toContain("noumena:schema");
  });

  it("loadPatchFixture reads and parses patch JSON", () => {
    const patch = loadPatchFixture<{ ops: unknown[] }>("append-note.valid.json");
    expect(patch.ops).toBeInstanceOf(Array);
    expect(patch.ops.length).toBe(1);
  });

  it("loadExpectedFixture reads expected golden HTML", () => {
    const html = loadExpectedFixture("append-evidence.after.html");
    expect(html).toContain("data-noumena-document");
  });

  it("loadValidFixture reads valid validation fixture", () => {
    const html = loadValidFixture("research-note-empty.valid.html");
    expect(html).toContain("noumena.html.v1");
  });

  it("loadInvalidFixture reads invalid validation fixture", () => {
    const html = loadInvalidFixture("missing-doctype.invalid.html");
    expect(html).toBeDefined();
    expect(html.length).toBeGreaterThan(0);
  });
});

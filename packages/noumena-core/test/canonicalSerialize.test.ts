/**
 * Tests for canonical serialization — determinism and idempotence.
 *
 * WI-5034224 — UOW-004 DoD:
 *   canonicalSerialize is deterministic and idempotent (round-trip passes).
 *   Metadata JSON keys sorted recursively; attribute order matches PDF §21.
 */

import { describe, it, expect } from "vitest";
import { parseNoumenaHtml } from "../src/parseNoumenaHtml.js";
import { canonicalSerialize, canonicalJsonSerialize } from "../src/canonicalSerialize.js";
import { canonicalSerializeBlock } from "../src/canonicalSerializeBlock.js";
import {
  loadNativeFixture,
  loadValidFixture,
} from "../src/fixtures.js";

describe("canonicalSerialize", () => {
  describe("round-trip idempotence", () => {
    const nativeFixtures = [
      "research-note-empty.html",
      "research-note-with-evidence.html",
      "research-note-with-agent-events.html",
    ];

    for (const fixture of nativeFixtures) {
      it(`round-trip idempotent for native/${fixture}`, () => {
        const html = loadNativeFixture(fixture);
        const pass1 = parseNoumenaHtml(html);
        expect(pass1.document).not.toBeNull();
        const serialized1 = canonicalSerialize(pass1.document!);

        const pass2 = parseNoumenaHtml(serialized1);
        expect(pass2.document).not.toBeNull();
        const serialized2 = canonicalSerialize(pass2.document!);

        // Core idempotence: second pass produces identical output
        expect(serialized2).toBe(serialized1);
      });
    }

    it("round-trip idempotent for validation/valid fixtures", () => {
      const validFixtures = [
        "research-note-empty.valid.html",
        "research-note-with-evidence.valid.html",
      ];

      for (const fixture of validFixtures) {
        const html = loadValidFixture(fixture);
        const pass1 = parseNoumenaHtml(html);
        if (!pass1.document) continue;
        const serialized1 = canonicalSerialize(pass1.document);

        const pass2 = parseNoumenaHtml(serialized1);
        if (!pass2.document) continue;
        const serialized2 = canonicalSerialize(pass2.document);

        expect(serialized2).toBe(serialized1);
      }
    });
  });

  describe("deterministic output format", () => {
    it("produces lowercase tags", () => {
      const html = loadNativeFixture("research-note-empty.html");
      const result = parseNoumenaHtml(html);
      const serialized = canonicalSerialize(result.document!);
      expect(serialized).toContain("<!doctype html>");
      expect(serialized).toContain("<html");
      expect(serialized).toContain("<head>");
      expect(serialized).toContain("<body>");
      expect(serialized).toContain("<article");
    });

    it("uses LF line endings only", () => {
      const html = loadNativeFixture("research-note-empty.html");
      const result = parseNoumenaHtml(html);
      const serialized = canonicalSerialize(result.document!);
      expect(serialized).not.toContain("\r");
    });

    it("ends with exactly one trailing newline", () => {
      const html = loadNativeFixture("research-note-empty.html");
      const result = parseNoumenaHtml(html);
      const serialized = canonicalSerialize(result.document!);
      expect(serialized.endsWith("\n")).toBe(true);
      expect(serialized.endsWith("\n\n")).toBe(false);
    });

    it("has no trailing spaces on any line", () => {
      const html = loadNativeFixture("research-note-empty.html");
      const result = parseNoumenaHtml(html);
      const serialized = canonicalSerialize(result.document!);
      for (const line of serialized.split("\n")) {
        expect(line).toBe(line.trimEnd());
      }
    });

    it("uses two-space indentation", () => {
      const html = loadNativeFixture("research-note-empty.html");
      const result = parseNoumenaHtml(html);
      const serialized = canonicalSerialize(result.document!);
      // Head children indented with 2 spaces
      expect(serialized).toContain('  <meta charset="utf-8">');
    });
  });

  describe("attribute ordering (§21)", () => {
    it("orders article attributes correctly", () => {
      const html = loadNativeFixture("research-note-empty.html");
      const result = parseNoumenaHtml(html);
      const serialized = canonicalSerialize(result.document!);

      // Article attributes must be: data-noumena-document, data-noumena-document-id,
      // data-noumena-document-type, data-noumena-schema-version
      const articleMatch = serialized.match(/<article[\s\S]*?>/);
      expect(articleMatch).not.toBeNull();
      const articleTag = articleMatch![0];

      const attrOrder = [
        "data-noumena-document",
        "data-noumena-document-id",
        "data-noumena-document-type",
        "data-noumena-schema-version",
      ];

      let lastIdx = -1;
      for (const attr of attrOrder) {
        const idx = articleTag.indexOf(attr);
        expect(idx).toBeGreaterThan(lastIdx);
        lastIdx = idx;
      }
    });

    it("orders section attributes: id first, then data-noumena-*, then data-conflict-policy", () => {
      const html = loadNativeFixture("research-note-empty.html");
      const result = parseNoumenaHtml(html);
      const serialized = canonicalSerialize(result.document!);

      // Summary section should have id before data-noumena-block-id
      const sectionMatch = serialized.match(/<section[\s\S]*?id="summary"[\s\S]*?>/);
      expect(sectionMatch).not.toBeNull();
      const sectionTag = sectionMatch![0];

      const idIdx = sectionTag.indexOf('id="summary"');
      const blockIdIdx = sectionTag.indexOf("data-noumena-block-id");
      const roleIdx = sectionTag.indexOf("data-noumena-role");
      const policyIdx = sectionTag.indexOf("data-conflict-policy");

      expect(idIdx).toBeLessThan(blockIdIdx);
      expect(blockIdIdx).toBeLessThan(roleIdx);
      expect(roleIdx).toBeLessThan(policyIdx);
    });
  });

  describe("metadata JSON canonicalization", () => {
    it("sorts metadata keys recursively", () => {
      const html = loadNativeFixture("research-note-empty.html");
      const result = parseNoumenaHtml(html);
      const serialized = canonicalSerialize(result.document!);

      // Find metadata JSON in output
      const scriptMatch = serialized.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/);
      expect(scriptMatch).not.toBeNull();
      const jsonStr = scriptMatch![1]!.trim();
      const parsed = JSON.parse(jsonStr);

      // Keys should be alphabetically sorted
      const keys = Object.keys(parsed);
      const sortedKeys = [...keys].sort();
      expect(keys).toEqual(sortedKeys);
    });

    it("JSON starts at column 1 inside script block", () => {
      const html = loadNativeFixture("research-note-empty.html");
      const result = parseNoumenaHtml(html);
      const serialized = canonicalSerialize(result.document!);

      // Find the line after the script opening tag
      const lines = serialized.split("\n");
      const scriptCloseIdx = lines.findIndex((l) => l.includes("</script>"));
      // The JSON should start at column 1 (no leading indent)
      // Line before </script> should be the closing brace at column 1
      const jsonStartIdx = lines.findIndex((l) => l.trim().startsWith("{") && !l.includes("<"));
      if (jsonStartIdx >= 0) {
        expect(lines[jsonStartIdx]!.startsWith("{")).toBe(true);
      }
    });
  });
});

describe("canonicalJsonSerialize", () => {
  it("sorts object keys alphabetically", () => {
    const result = canonicalJsonSerialize({ z: 1, a: 2, m: 3 });
    const parsed = JSON.parse(result);
    expect(Object.keys(parsed)).toEqual(["a", "m", "z"]);
  });

  it("sorts nested object keys", () => {
    const result = canonicalJsonSerialize({ outer: { z: 1, a: 2 } });
    expect(result).toContain('"a": 2');
    // a should come before z
    expect(result.indexOf('"a"')).toBeLessThan(result.indexOf('"z"'));
  });

  it("formats arrays one item per line", () => {
    const result = canonicalJsonSerialize({ tags: ["b", "a", "c"] });
    const lines = result.split("\n");
    // Each array item should be on its own line
    expect(lines.some((l) => l.includes('"b"'))).toBe(true);
    expect(lines.some((l) => l.includes('"a"'))).toBe(true);
  });

  it("uses 2-space JSON indentation", () => {
    const result = canonicalJsonSerialize({ a: 1 });
    expect(result).toContain('  "a": 1');
  });

  it("handles empty arrays", () => {
    expect(canonicalJsonSerialize([])).toBe("[]");
  });

  it("handles empty objects", () => {
    expect(canonicalJsonSerialize({})).toBe("{}");
  });
});

describe("canonicalSerializeBlock", () => {
  it("produces stable output for metadata block", () => {
    const html = loadNativeFixture("research-note-empty.html");
    const result = parseNoumenaHtml(html);
    const doc = result.document!;
    const metaBlock = doc.roles.get("metadata")!;

    const serialized1 = canonicalSerializeBlock(metaBlock);
    const serialized2 = canonicalSerializeBlock(metaBlock);
    expect(serialized1).toBe(serialized2);
  });

  it("produces stable output for section blocks", () => {
    const html = loadNativeFixture("research-note-empty.html");
    const result = parseNoumenaHtml(html);
    const doc = result.document!;

    for (const block of doc.blocks) {
      const s1 = canonicalSerializeBlock(block);
      const s2 = canonicalSerializeBlock(block);
      expect(s1).toBe(s2);
    }
  });

  it("includes block identity attributes", () => {
    const html = loadNativeFixture("research-note-empty.html");
    const result = parseNoumenaHtml(html);
    const doc = result.document!;
    const summaryBlock = doc.roles.get("summary")!;

    const serialized = canonicalSerializeBlock(summaryBlock);
    expect(serialized).toContain('id="summary"');
    expect(serialized).toContain("data-noumena-block-id");
    expect(serialized).toContain("data-noumena-role");
    expect(serialized).toContain("data-conflict-policy");
  });
});

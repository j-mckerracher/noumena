/**
 * Tests for parseNoumenaHtml — HTML parsing and file classification.
 *
 * WI-5034224 — UOW-004 DoD:
 *   parseNoumenaHtml correctly classifies all fixture files.
 *
 * Dynamically discovers all fixtures via readdirSync to ensure coverage
 * of every HTML file across native, validation/valid, validation/invalid,
 * and malformed directories.
 */

import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNoumenaHtml } from "../src/parseNoumenaHtml.js";
import {
  loadNativeFixture,
  loadMalformedFixture,
  loadValidFixture,
  loadInvalidFixture,
} from "../src/fixtures.js";

// ---------------------------------------------------------------------------
// Fixture discovery
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const FIXTURES_ROOT = join(REPO_ROOT, "fixtures");

/** List all .html files in a fixture subdirectory, sorted. */
function listHtmlFiles(subdir: string): string[] {
  try {
    return readdirSync(join(FIXTURES_ROOT, subdir))
      .filter((f) => f.endsWith(".html"))
      .sort();
  } catch {
    return [];
  }
}

const nativeFiles = listHtmlFiles("native");
const validFiles = listHtmlFiles("validation/valid");
const invalidFiles = listHtmlFiles("validation/invalid");
const malformedFiles = listHtmlFiles("malformed");

// ---------------------------------------------------------------------------
// Classification tests — all fixture files
// ---------------------------------------------------------------------------

describe("parseNoumenaHtml", () => {
  describe("file classification — native fixtures", () => {
    it.each(nativeFiles)(
      "classifies native/%s as noumena_native",
      (file) => {
        const html = loadNativeFixture(file);
        const result = parseNoumenaHtml(html);
        expect(result.fileClass).toBe("noumena_native");
        expect(result.document).not.toBeNull();
      },
    );
  });

  describe("file classification — valid validation fixtures", () => {
    it.each(validFiles)(
      "classifies validation/valid/%s as noumena_native",
      (file) => {
        const html = loadValidFixture(file);
        const result = parseNoumenaHtml(html);
        expect(result.fileClass).toBe("noumena_native");
        expect(result.document).not.toBeNull();
      },
    );
  });

  describe("file classification — invalid validation fixtures", () => {
    it.each(invalidFiles)(
      "classifies validation/invalid/%s as invalid_noumena",
      (file) => {
        const html = loadInvalidFixture(file);
        const result = parseNoumenaHtml(html);
        expect(result.fileClass).toBe("invalid_noumena");
        expect(result.document).toBeNull();
      },
    );
  });

  describe("file classification — malformed fixtures", () => {
    it.each(malformedFiles)(
      "classifies malformed/%s as invalid_noumena",
      (file) => {
        const html = loadMalformedFixture(file);
        const result = parseNoumenaHtml(html);
        expect(result.fileClass).toBe("invalid_noumena");
        expect(result.document).toBeNull();
      },
    );
  });

  describe("file classification — synthetic inputs", () => {
    it("classifies plain HTML without noumena markers as raw_html", () => {
      const html =
        "<!doctype html><html><head><title>Plain</title></head><body></body></html>";
      const result = parseNoumenaHtml(html);
      expect(result.fileClass).toBe("raw_html");
      expect(result.document).toBeNull();
    });

    it("classifies HTML with noumena meta but no article as invalid_noumena", () => {
      const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Test</title>
  <meta name="noumena:schema" content="noumena.html.v1">
</head>
<body><p>No article here</p></body>
</html>`;
      const result = parseNoumenaHtml(html);
      expect(result.fileClass).toBe("invalid_noumena");
      expect(result.document).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Document model extraction (from native fixtures)
  // -----------------------------------------------------------------------

  describe("document model extraction", () => {
    it("extracts correct document ID", () => {
      const html = loadNativeFixture("research-note-empty.html");
      const result = parseNoumenaHtml(html);
      expect(result.document?.documentId).toBe(
        "doc_01JZ9A7V6QK8M3X2T5N4R1B0CY",
      );
    });

    it("extracts metadata from metadata block", () => {
      const html = loadNativeFixture("research-note-empty.html");
      const result = parseNoumenaHtml(html);
      expect(result.document?.metadata.title).toBe("Empty Research Note");
      expect(result.document?.metadata.status).toBe("draft");
      expect(result.document?.metadata.createdAt).toBe("2026-05-29T23:00:00Z");
    });

    it("extracts all five roles", () => {
      const html = loadNativeFixture("research-note-empty.html");
      const result = parseNoumenaHtml(html);
      const doc = result.document!;
      expect(doc.roles.has("metadata")).toBe(true);
      expect(doc.roles.has("summary")).toBe(true);
      expect(doc.roles.has("notes")).toBe(true);
      expect(doc.roles.has("evidence")).toBe(true);
      expect(doc.roles.has("agent_events")).toBe(true);
      expect(doc.blocks.length).toBe(5);
    });

    it("extracts block IDs and policies", () => {
      const html = loadNativeFixture("research-note-empty.html");
      const result = parseNoumenaHtml(html);
      const doc = result.document!;

      const metaBlock = doc.roles.get("metadata")!;
      expect(metaBlock.blockId).toBe("blk_01JZ9A7Y8METADATA00000");
      expect(metaBlock.policy).toBe("merge_text");

      const summaryBlock = doc.roles.get("summary")!;
      expect(summaryBlock.policy).toBe("replace_requires_clean_base");

      const notesBlock = doc.roles.get("notes")!;
      expect(notesBlock.policy).toBe("append_only");
    });

    it("parses evidence items from research-note-with-evidence", () => {
      const html = loadNativeFixture("research-note-with-evidence.html");
      const result = parseNoumenaHtml(html);
      const doc = result.document!;
      const evidenceBlock = doc.roles.get("evidence")!;

      const olChild = evidenceBlock.element.children.find(
        (c) => c.type === "element" && c.element.tagName === "ol",
      );
      expect(olChild).toBeDefined();
    });

    it("parses agent event items", () => {
      const html = loadNativeFixture("research-note-with-agent-events.html");
      const result = parseNoumenaHtml(html);
      const doc = result.document!;
      const eventsBlock = doc.roles.get("agent_events")!;

      const olChild = eventsBlock.element.children.find(
        (c) => c.type === "element" && c.element.tagName === "ol",
      );
      expect(olChild).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Buffer input
  // -----------------------------------------------------------------------

  describe("handles Buffer input", () => {
    it("accepts Buffer input", () => {
      const html = loadNativeFixture("research-note-empty.html");
      const buf = Buffer.from(html, "utf-8");
      const result = parseNoumenaHtml(buf);
      expect(result.fileClass).toBe("noumena_native");
    });
  });

  // -----------------------------------------------------------------------
  // Fixture coverage sanity checks
  // -----------------------------------------------------------------------

  describe("fixture coverage", () => {
    it("has at least 3 native fixtures", () => {
      expect(nativeFiles.length).toBeGreaterThanOrEqual(3);
    });

    it("has at least 4 valid validation fixtures", () => {
      expect(validFiles.length).toBeGreaterThanOrEqual(4);
    });

    it("has at least 22 invalid validation fixtures", () => {
      expect(invalidFiles.length).toBeGreaterThanOrEqual(22);
    });

    it("has at least 4 malformed fixtures", () => {
      expect(malformedFiles.length).toBeGreaterThanOrEqual(4);
    });
  });
});

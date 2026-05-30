/**
 * Tests for parseNoumenaHtml — HTML parsing and file classification.
 *
 * WI-5034224 — UOW-004 DoD:
 *   parseNoumenaHtml correctly classifies all fixture files.
 */

import { describe, it, expect } from "vitest";
import { parseNoumenaHtml } from "../src/parseNoumenaHtml.js";
import {
  loadNativeFixture,
  loadMalformedFixture,
  loadValidFixture,
  loadInvalidFixture,
} from "../src/fixtures.js";

describe("parseNoumenaHtml", () => {
  describe("file classification", () => {
    it("classifies native research-note-empty as noumena_native", () => {
      const html = loadNativeFixture("research-note-empty.html");
      const result = parseNoumenaHtml(html);
      expect(result.fileClass).toBe("noumena_native");
      expect(result.document).not.toBeNull();
    });

    it("classifies native research-note-with-evidence as noumena_native", () => {
      const html = loadNativeFixture("research-note-with-evidence.html");
      const result = parseNoumenaHtml(html);
      expect(result.fileClass).toBe("noumena_native");
      expect(result.document).not.toBeNull();
    });

    it("classifies native research-note-with-agent-events as noumena_native", () => {
      const html = loadNativeFixture("research-note-with-agent-events.html");
      const result = parseNoumenaHtml(html);
      expect(result.fileClass).toBe("noumena_native");
      expect(result.document).not.toBeNull();
    });

    it("classifies plain HTML without noumena meta as raw_html", () => {
      const html = "<!doctype html><html><head><title>Plain</title></head><body></body></html>";
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

    it("classifies valid validation fixtures as noumena_native", () => {
      const validFiles = [
        "research-note-empty.valid.html",
        "research-note-with-evidence.valid.html",
      ];
      for (const file of validFiles) {
        const html = loadValidFixture(file);
        const result = parseNoumenaHtml(html);
        expect(result.fileClass).toBe("noumena_native");
      }
    });
  });

  describe("document model extraction", () => {
    it("extracts correct document ID", () => {
      const html = loadNativeFixture("research-note-empty.html");
      const result = parseNoumenaHtml(html);
      expect(result.document?.documentId).toBe("doc_01JZ9A7V6QK8M3X2T5N4R1B0CY");
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

      // Evidence block should have an <ol> child with <li> children
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

  describe("handles Buffer input", () => {
    it("accepts Buffer input", () => {
      const html = loadNativeFixture("research-note-empty.html");
      const buf = Buffer.from(html, "utf-8");
      const result = parseNoumenaHtml(buf);
      expect(result.fileClass).toBe("noumena_native");
    });
  });
});

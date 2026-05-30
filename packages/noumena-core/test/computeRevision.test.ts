/**
 * Tests for revision and block hash computation.
 *
 * WI-5034224 — UOW-004 DoD:
 *   computeRevision and computeBlockHash produce stable sha256 digests.
 */

import { describe, it, expect } from "vitest";
import {
  sha256,
  computeRevision,
  computeRevisionFromDocument,
  computeBlockHash,
  computeAllBlockHashes,
} from "../src/computeRevision.js";
import { parseNoumenaHtml } from "../src/parseNoumenaHtml.js";
import { canonicalSerialize } from "../src/canonicalSerialize.js";
import { loadNativeFixture } from "../src/fixtures.js";

describe("sha256", () => {
  it("produces consistent hashes", () => {
    const h1 = sha256("hello");
    const h2 = sha256("hello");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // hex digest
  });

  it("different inputs produce different hashes", () => {
    expect(sha256("hello")).not.toBe(sha256("world"));
  });
});

describe("computeRevision", () => {
  it("produces stable digest for native fixture", () => {
    const html = loadNativeFixture("research-note-empty.html");
    const rev1 = computeRevision(html);
    const rev2 = computeRevision(html);
    expect(rev1).toBe(rev2);
    expect(rev1).toHaveLength(64);
  });

  it("same revision for same content regardless of whitespace differences", () => {
    // Parse and re-serialize to canonical form, then compare revision
    const html = loadNativeFixture("research-note-empty.html");
    const parsed = parseNoumenaHtml(html);
    const canonical = canonicalSerialize(parsed.document!);

    const revFromOriginal = computeRevision(html);
    const revFromCanonical = computeRevision(canonical);

    // Both should produce same revision because computeRevision
    // canonicalizes before hashing for native docs
    expect(revFromOriginal).toBe(revFromCanonical);
  });

  it("different documents produce different revisions", () => {
    const empty = loadNativeFixture("research-note-empty.html");
    const withEvidence = loadNativeFixture("research-note-with-evidence.html");

    expect(computeRevision(empty)).not.toBe(computeRevision(withEvidence));
  });

  it("raw HTML uses raw bytes hash", () => {
    const rawHtml = "<html><body>test</body></html>";
    const rev = computeRevision(rawHtml);
    expect(rev).toBe(sha256(rawHtml));
  });

  it("accepts Buffer input", () => {
    const html = loadNativeFixture("research-note-empty.html");
    const buf = Buffer.from(html, "utf-8");
    const rev = computeRevision(buf);
    expect(rev).toBe(computeRevision(html));
  });
});

describe("computeRevisionFromDocument", () => {
  it("matches computeRevision for same input", () => {
    const html = loadNativeFixture("research-note-empty.html");
    const parsed = parseNoumenaHtml(html);
    const doc = parsed.document!;

    const rev1 = computeRevision(html);
    const rev2 = computeRevisionFromDocument(doc);
    expect(rev1).toBe(rev2);
  });
});

describe("computeBlockHash", () => {
  it("produces stable hash for metadata block", () => {
    const html = loadNativeFixture("research-note-empty.html");
    const doc = parseNoumenaHtml(html).document!;
    const metaBlock = doc.roles.get("metadata")!;

    const h1 = computeBlockHash(metaBlock);
    const h2 = computeBlockHash(metaBlock);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it("different blocks produce different hashes", () => {
    const html = loadNativeFixture("research-note-empty.html");
    const doc = parseNoumenaHtml(html).document!;

    const metaHash = computeBlockHash(doc.roles.get("metadata")!);
    const summaryHash = computeBlockHash(doc.roles.get("summary")!);
    expect(metaHash).not.toBe(summaryHash);
  });
});

describe("computeAllBlockHashes", () => {
  it("populates blockHash on all blocks", () => {
    const html = loadNativeFixture("research-note-empty.html");
    const doc = parseNoumenaHtml(html).document!;

    const hashes = computeAllBlockHashes(doc);
    expect(hashes.size).toBe(5);

    for (const block of doc.blocks) {
      expect(block.blockHash).toHaveLength(64);
      expect(hashes.get(block.blockId)).toBe(block.blockHash);
    }
  });

  it("hashes are stable across calls", () => {
    const html = loadNativeFixture("research-note-empty.html");

    const doc1 = parseNoumenaHtml(html).document!;
    const hashes1 = computeAllBlockHashes(doc1);

    const doc2 = parseNoumenaHtml(html).document!;
    const hashes2 = computeAllBlockHashes(doc2);

    for (const [blockId, hash] of hashes1) {
      expect(hashes2.get(blockId)).toBe(hash);
    }
  });

  it("block hashes change when content changes", () => {
    const empty = loadNativeFixture("research-note-empty.html");
    const withEvidence = loadNativeFixture("research-note-with-evidence.html");

    const doc1 = parseNoumenaHtml(empty).document!;
    computeAllBlockHashes(doc1);

    const doc2 = parseNoumenaHtml(withEvidence).document!;
    computeAllBlockHashes(doc2);

    // Evidence block should have different hash (one has items, one doesn't)
    const ev1 = doc1.roles.get("evidence")!.blockHash;
    const ev2 = doc2.roles.get("evidence")!.blockHash;
    expect(ev1).not.toBe(ev2);
  });
});

import { describe, it, expect } from "vitest";
import {
  generateId,
  generateTestId,
  createTestClock,
  advanceTestClock,
  isValidId,
  ID_PATTERNS,
} from "../src/ids.js";
import type { IdPrefix } from "../src/ids.js";

const ALL_PREFIXES: IdPrefix[] = ["doc", "blk", "ev", "evt", "note"];

describe("ID_PATTERNS", () => {
  it.each(ALL_PREFIXES)("regex for '%s' matches valid IDs", (prefix) => {
    const re = ID_PATTERNS[prefix];
    // Valid examples
    expect(re.test(`${prefix}_01JZ9A7V6QK8M3X2T5N4R1B0CY`)).toBe(true);
    // Invalid: wrong length
    expect(re.test(`${prefix}_01JZ9A7V6QK8M3X2T5N4R1B0C`)).toBe(false);
    // Invalid: contains excluded letter I
    expect(re.test(`${prefix}_01JZ9A7V6QK8M3X2T5N4R1B0CI`)).toBe(false);
    // Invalid: contains excluded letter L
    expect(re.test(`${prefix}_01JZ9A7V6QK8M3X2T5N4R1B0CL`)).toBe(false);
    // Invalid: contains excluded letter O
    expect(re.test(`${prefix}_01JZ9A7V6QK8M3X2T5N4R1B0CO`)).toBe(false);
    // Invalid: contains excluded letter U
    expect(re.test(`${prefix}_01JZ9A7V6QK8M3X2T5N4R1B0CU`)).toBe(false);
    // Invalid: lowercase
    expect(re.test(`${prefix}_01jz9a7v6qk8m3x2t5n4r1b0cy`)).toBe(false);
  });
});

describe("generateId (production)", () => {
  it.each(ALL_PREFIXES)("generates valid '%s' IDs", (prefix) => {
    const id = generateId(prefix);
    expect(isValidId(id, prefix)).toBe(true);
    expect(id.startsWith(`${prefix}_`)).toBe(true);
  });

  it("generates unique IDs on successive calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId("doc")));
    expect(ids.size).toBe(100);
  });

  it("maintains monotonic sort order within same millisecond", () => {
    // Generate several IDs quickly to trigger same-ms path
    const ids = Array.from({ length: 10 }, () => generateId("doc"));
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]! > ids[i - 1]!).toBe(true);
    }
  });
});

describe("Deterministic test clock", () => {
  it("produces reproducible IDs from same clock state", () => {
    const clock1 = createTestClock(1716940800000);
    const clock2 = createTestClock(1716940800000);

    const id1 = generateTestId(clock1, "doc");
    const id2 = generateTestId(clock2, "doc");
    expect(id1).toBe(id2);
  });

  it.each(ALL_PREFIXES)("test IDs for '%s' match the ID pattern", (prefix) => {
    const clock = createTestClock();
    const id = generateTestId(clock, prefix);
    expect(isValidId(id, prefix)).toBe(true);
  });

  it("increments counter for successive calls at same time", () => {
    const clock = createTestClock();
    const id1 = generateTestId(clock, "blk");
    const id2 = generateTestId(clock, "blk");
    expect(id1).not.toBe(id2);
    // Counter-based: second ID should sort after first
    expect(id2 > id1).toBe(true);
  });

  it("advanceTestClock moves time forward and resets counter", () => {
    const clock = createTestClock(1000);
    generateTestId(clock, "doc");
    expect(clock.counter).toBe(1);

    advanceTestClock(clock, 500);
    expect(clock.now).toBe(1500);
    expect(clock.counter).toBe(0);
  });

  it("IDs after clock advance sort after IDs before", () => {
    const clock = createTestClock();
    const before = generateTestId(clock, "ev");
    advanceTestClock(clock, 1000);
    const after = generateTestId(clock, "ev");
    expect(after > before).toBe(true);
  });
});

describe("isValidId", () => {
  it("accepts valid IDs without prefix filter", () => {
    const clock = createTestClock();
    for (const prefix of ALL_PREFIXES) {
      expect(isValidId(generateTestId(clock, prefix))).toBe(true);
    }
  });

  it("rejects garbage strings", () => {
    expect(isValidId("not-an-id")).toBe(false);
    expect(isValidId("")).toBe(false);
    expect(isValidId("doc_")).toBe(false);
    expect(isValidId("doc_short")).toBe(false);
  });

  it("rejects wrong prefix when prefix specified", () => {
    const clock = createTestClock();
    const docId = generateTestId(clock, "doc");
    expect(isValidId(docId, "blk")).toBe(false);
    expect(isValidId(docId, "doc")).toBe(true);
  });
});

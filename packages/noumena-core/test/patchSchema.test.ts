/**
 * Tests for patch schema validation.
 * AC-006: Schema validation rejects malformed patch JSON with exit 3.
 */

import { describe, it, expect } from "vitest";
import {
  validatePatchSchema,
  assertPatchSchema,
  PatchSchemaValidationError,
} from "../src/patchSchema.js";
import { loadPatchFixture } from "../src/fixtures.js";

describe("validatePatchSchema", () => {
  it("accepts a valid append-evidence patch", () => {
    const patch = loadPatchFixture("append-evidence.valid.json");
    const result = validatePatchSchema(patch);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts a valid append-note patch", () => {
    const patch = loadPatchFixture("append-note.valid.json");
    const result = validatePatchSchema(patch);
    expect(result.valid).toBe(true);
  });

  it("accepts a valid set-status patch", () => {
    const patch = loadPatchFixture("set-status.valid.json");
    const result = validatePatchSchema(patch);
    expect(result.valid).toBe(true);
  });

  it("accepts a valid set-metadata patch", () => {
    const patch = loadPatchFixture("set-metadata.valid.json");
    const result = validatePatchSchema(patch);
    expect(result.valid).toBe(true);
  });

  it("accepts a valid append-agent-event patch", () => {
    const patch = loadPatchFixture("append-agent-event.valid.json");
    const result = validatePatchSchema(patch);
    expect(result.valid).toBe(true);
  });

  it("accepts a valid propose-summary patch", () => {
    const patch = loadPatchFixture("propose-summary.queues-review.json");
    const result = validatePatchSchema(patch);
    expect(result.valid).toBe(true);
  });

  it("rejects a patch with missing ops field", () => {
    const patch = loadPatchFixture("invalid-schema.rejects.json");
    const result = validatePatchSchema(patch);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects an empty object", () => {
    const result = validatePatchSchema({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects a non-object", () => {
    const result = validatePatchSchema("not an object");
    expect(result.valid).toBe(false);
  });

  it("rejects wrong schema value", () => {
    const result = validatePatchSchema({
      schema: "wrong.schema.v1",
      base: { revision: "sha256:abc" },
      author: { type: "agent", name: "Test" },
      intent: "Test intent",
      ops: [],
    });
    expect(result.valid).toBe(false);
  });
});

describe("assertPatchSchema", () => {
  it("does not throw for valid patch", () => {
    const patch = loadPatchFixture("append-evidence.valid.json");
    expect(() => assertPatchSchema(patch)).not.toThrow();
  });

  it("throws PatchSchemaValidationError for invalid patch", () => {
    const patch = loadPatchFixture("invalid-schema.rejects.json");
    expect(() => assertPatchSchema(patch)).toThrow(PatchSchemaValidationError);
  });

  it("thrown error has exitCode 3", () => {
    const patch = loadPatchFixture("invalid-schema.rejects.json");
    try {
      assertPatchSchema(patch);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PatchSchemaValidationError);
      expect((err as PatchSchemaValidationError).exitCode).toBe(3);
    }
  });

  it("thrown error contains error details", () => {
    try {
      assertPatchSchema({});
      expect.fail("Should have thrown");
    } catch (err) {
      const pErr = err as PatchSchemaValidationError;
      expect(pErr.errors.length).toBeGreaterThan(0);
      expect(pErr.errors[0]!.message).toBeDefined();
    }
  });
});

describe("schema validates stale-base patch structure", () => {
  it("accepts stale-base patch (schema-valid, domain-level rejection is separate)", () => {
    const patch = loadPatchFixture("stale-base.rejects.json");
    const result = validatePatchSchema(patch);
    // stale-base has valid schema structure, it's rejected at domain level
    expect(result.valid).toBe(true);
  });
});

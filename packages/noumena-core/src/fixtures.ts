/**
 * Fixture-loading helpers for Noumena test utilities.
 *
 * Provides functions to load fixture files from the fixtures/ directory
 * for use in test suites. All paths are resolved relative to the repo root.
 *
 * AC-006 / AC-008: Fixture corpus supports validation and golden fixture testing.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Root of the noumena repository (two levels up from packages/noumena-core/src/). */
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

/** Root of the fixtures directory. */
const FIXTURES_ROOT = join(REPO_ROOT, "fixtures");

/** Root of the schemas directory. */
const SCHEMAS_ROOT = join(REPO_ROOT, "schemas");

// ---------------------------------------------------------------------------
// Fixture subdirectories
// ---------------------------------------------------------------------------

export type FixtureCategory =
  | "native"
  | "malformed"
  | "patches"
  | "expected"
  | "validation/valid"
  | "validation/invalid";

/**
 * Resolve the absolute path to a fixture file.
 */
export function fixturePath(category: FixtureCategory, filename: string): string {
  return join(FIXTURES_ROOT, category, filename);
}

/**
 * Read a fixture file as a UTF-8 string.
 */
export function readFixture(category: FixtureCategory, filename: string): string {
  return readFileSync(fixturePath(category, filename), "utf-8");
}

/**
 * Read a fixture file as a Buffer (raw bytes).
 */
export function readFixtureBytes(category: FixtureCategory, filename: string): Buffer {
  return readFileSync(fixturePath(category, filename));
}

/**
 * Read and parse a JSON fixture file.
 */
export function readFixtureJson<T = unknown>(category: FixtureCategory, filename: string): T {
  const content = readFixture(category, filename);
  return JSON.parse(content) as T;
}

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to a schema file.
 */
export function schemaPath(filename: string): string {
  return join(SCHEMAS_ROOT, filename);
}

/**
 * Read and parse a JSON Schema file.
 */
export function readSchema<T = unknown>(filename: string): T {
  const content = readFileSync(schemaPath(filename), "utf-8");
  return JSON.parse(content) as T;
}

// ---------------------------------------------------------------------------
// Convenience loaders by fixture type
// ---------------------------------------------------------------------------

/** Load a native fixture HTML file. */
export function loadNativeFixture(filename: string): string {
  return readFixture("native", filename);
}

/** Load a malformed fixture HTML file. */
export function loadMalformedFixture(filename: string): string {
  return readFixture("malformed", filename);
}

/** Load a patch fixture JSON file (parsed). */
export function loadPatchFixture<T = unknown>(filename: string): T {
  return readFixtureJson<T>("patches", filename);
}

/** Load an expected golden output fixture HTML file. */
export function loadExpectedFixture(filename: string): string {
  return readFixture("expected", filename);
}

/** Load a valid validation fixture HTML file. */
export function loadValidFixture(filename: string): string {
  return readFixture("validation/valid", filename);
}

/** Load an invalid validation fixture HTML file. */
export function loadInvalidFixture(filename: string): string {
  return readFixture("validation/invalid", filename);
}

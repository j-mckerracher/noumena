/**
 * Patch JSON schema validation.
 *
 * Validates patch documents against noumena-patch-v1.schema.json.
 * Returns validation result or throws with exit code 3 on schema failure.
 *
 * AC-006: Schema validation rejects malformed patch JSON with exit 3.
 * PDF §7.1: Exit code 3 = patch JSON parse/schema error.
 */

import Ajv, { type ValidateFunction } from "ajv";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Root of the noumena repository. */
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SCHEMA_PATH = join(REPO_ROOT, "schemas", "noumena-patch-v1.schema.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatchSchemaError {
  path: string;
  message: string;
}

export interface PatchValidationResult {
  valid: boolean;
  errors: PatchSchemaError[];
}

/**
 * Error thrown when patch JSON fails schema validation.
 * CLI layer should catch this and exit with code 3.
 */
export class PatchSchemaValidationError extends Error {
  public readonly exitCode = 3;
  public readonly errors: PatchSchemaError[];

  constructor(errors: PatchSchemaError[]) {
    const messages = errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    super(`Patch schema validation failed: ${messages}`);
    this.name = "PatchSchemaValidationError";
    this.errors = errors;
  }
}

// ---------------------------------------------------------------------------
// Validator singleton
// ---------------------------------------------------------------------------

let cachedValidator: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  if (!cachedValidator) {
    const schemaJson = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8"));
    // Handle ESM default export quirks with Ajv
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AjvCtor = (Ajv as any).default ?? Ajv;
    const ajv = new AjvCtor({ allErrors: true, strict: false, validateSchema: false, discriminator: true });
    cachedValidator = ajv.compile(schemaJson) as ValidateFunction;
  }
  return cachedValidator;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a parsed patch object against the noumena-patch-v1 JSON Schema.
 * Returns a result with valid flag and error details.
 */
export function validatePatchSchema(patch: unknown): PatchValidationResult {
  const validate = getValidator();
  const valid = validate(patch) as boolean;

  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors: PatchSchemaError[] = (validate.errors ?? []).map((err) => ({
    path: err.instancePath || "/",
    message: err.message ?? "Unknown validation error",
  }));

  return { valid: false, errors };
}

/**
 * Validate a patch object and throw PatchSchemaValidationError if invalid.
 * Used in the patch submit/dry-run pipeline.
 */
export function assertPatchSchema(patch: unknown): void {
  const result = validatePatchSchema(patch);
  if (!result.valid) {
    throw new PatchSchemaValidationError(result.errors);
  }
}

/**
 * Read a patch JSON file from disk, parse it, and validate against schema.
 * Throws PatchSchemaValidationError (exit 3) on schema failure.
 * Throws on JSON parse failure (also exit 3).
 */
export function readAndValidatePatchJson(patchFilePath: string): unknown {
  let content: string;
  try {
    content = readFileSync(patchFilePath, "utf-8");
  } catch (err) {
    throw new PatchSchemaValidationError([
      { path: "/", message: `Failed to read patch file: ${(err as Error).message}` },
    ]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new PatchSchemaValidationError([
      { path: "/", message: `Invalid JSON: ${(err as Error).message}` },
    ]);
  }

  assertPatchSchema(parsed);
  return parsed;
}

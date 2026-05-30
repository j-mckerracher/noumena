/**
 * Path safety utilities for Noumena vault operations.
 *
 * Phase 1 Implementation Plan §7.3 — Path rules:
 *   - Must not be absolute
 *   - Must not contain ..
 *   - Must not resolve outside the vault after canonicalization
 *   - Must not be inside .noumena/
 *   - Symlink escape detection required
 *   - Path escape returns exit 4 with path_escapes_vault
 */

import * as path from "node:path";
import * as fs from "node:fs";

/** Result of path validation. */
export type PathValidationResult =
  | { valid: true; resolvedPath: string; relativePath: string }
  | { valid: false; code: "path_escapes_vault"; message: string };

/**
 * Validate that a vault-relative path is safe.
 *
 * Canonicalises the path, rejects absolute paths, rejects `..` traversal,
 * rejects .noumena/ targets, and detects symlink escapes.
 *
 * @param vaultRoot - Absolute path to the vault root directory.
 * @param relPath   - Vault-relative POSIX path (e.g. "research/local-llms.html").
 */
export function validateVaultRelativePath(
  vaultRoot: string,
  relPath: string,
): PathValidationResult {
  // Reject absolute paths
  if (path.isAbsolute(relPath)) {
    return {
      valid: false,
      code: "path_escapes_vault",
      message: `Absolute paths are not allowed: ${relPath}`,
    };
  }

  // Reject .. traversal (check raw segments before normalization)
  const segments = relPath.split(/[/\\]/);
  if (segments.some((s) => s === "..")) {
    return {
      valid: false,
      code: "path_escapes_vault",
      message: `Path traversal (..) is not allowed: ${relPath}`,
    };
  }

  // Normalize and check it stays within vault
  const normalized = path.normalize(relPath);

  // Reject .noumena/ targets
  if (
    normalized === ".noumena" ||
    normalized.startsWith(".noumena" + path.sep) ||
    normalized.startsWith(".noumena/")
  ) {
    return {
      valid: false,
      code: "path_escapes_vault",
      message: `Paths inside .noumena/ are not allowed: ${relPath}`,
    };
  }

  // Resolve to absolute path
  const resolvedAbsolute = path.resolve(vaultRoot, normalized);
  const canonicalVault = path.resolve(vaultRoot);

  // Check the resolved path is within the vault
  if (
    !resolvedAbsolute.startsWith(canonicalVault + path.sep) &&
    resolvedAbsolute !== canonicalVault
  ) {
    return {
      valid: false,
      code: "path_escapes_vault",
      message: `Resolved path escapes the vault: ${relPath}`,
    };
  }

  // Symlink escape detection: if the file/directory exists, resolve symlinks
  // and verify the real path is still within the vault
  try {
    const realVault = fs.realpathSync(canonicalVault);

    // Check each existing ancestor for symlink escapes
    let checkPath = resolvedAbsolute;
    while (checkPath !== canonicalVault && checkPath !== path.dirname(checkPath)) {
      if (fs.existsSync(checkPath)) {
        const realCheck = fs.realpathSync(checkPath);
        if (
          !realCheck.startsWith(realVault + path.sep) &&
          realCheck !== realVault
        ) {
          return {
            valid: false,
            code: "path_escapes_vault",
            message: `Symlink at ${checkPath} escapes the vault`,
          };
        }
        break; // Found existing ancestor, it's safe
      }
      checkPath = path.dirname(checkPath);
    }
  } catch {
    // If we can't resolve symlinks (vault doesn't exist yet), skip check
  }

  return {
    valid: true,
    resolvedPath: resolvedAbsolute,
    relativePath: normalized,
  };
}

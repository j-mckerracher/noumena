import { initVault } from "@noumena/core";
import { writeJsonResult, writeJsonError } from "../output.js";

export function runVaultInit(vaultPath: string): never {
  const result = initVault(vaultPath);
  if (!result.ok) {
    writeJsonError("vault.init", result.code, result.message, 5);
  }

  result.vault.db.close();
  writeJsonResult({
    schema: "noumena.cli.result.v1",
    command: "vault.init",
    status: result.created ? "initialized" : "already_initialized",
    vault: result.vault.root,
    created: result.created,
    documentChanged: false,
  });
}

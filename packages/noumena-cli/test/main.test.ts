import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const CLI_PATH = resolve(import.meta.dirname, "../dist/main.js");

function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync("node", [CLI_PATH, ...args], {
      encoding: "utf-8",
      timeout: 5000,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.status ?? 1,
    };
  }
}

describe("noumena CLI entrypoint", () => {
  it("exits 2 with no arguments", () => {
    const result = runCli([]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Usage:");
  });

  it("exits 2 with --help", () => {
    const result = runCli(["--help"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Usage:");
  });

  it("exits 2 on unknown command", () => {
    const result = runCli(["frobnicate"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown command: frobnicate");
    expect(result.stderr).toContain("Usage:");
  });

  it("exits 2 on unknown subcommand", () => {
    const result = runCli(["vault", "explode"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown command: vault explode");
  });
});

export function writeJsonResult(result: Record<string, unknown>, exitCode = 0): never {
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(exitCode);
}

export function writeJsonError(
  command: string,
  code: string,
  message: string,
  exitCode: number,
  extra: Record<string, unknown> = {},
): never {
  process.stdout.write(JSON.stringify({
    schema: "noumena.cli.result.v1",
    command,
    status: "error",
    ok: false,
    documentChanged: false,
    error: { code, message },
    ...extra,
  }) + "\n");
  process.exit(exitCode);
}

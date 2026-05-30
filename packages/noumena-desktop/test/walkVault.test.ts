import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { walkVault } from "../src/main/ipc";

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "noumena-desktop-test-"));
  fs.mkdirSync(path.join(tmp, "research"));
  fs.writeFileSync(path.join(tmp, "research", "a.html"), "<html></html>");
  fs.writeFileSync(path.join(tmp, "b.html"), "<html></html>");
  fs.mkdirSync(path.join(tmp, ".noumena"));
  fs.writeFileSync(path.join(tmp, ".noumena", "index.sqlite"), "");
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("walkVault", () => {
  it("excludes .noumena and includes html files only", () => {
    const tree = walkVault(tmp);
    const paths = JSON.stringify(tree);
    expect(paths).toContain("a.html");
    expect(paths).toContain("b.html");
    expect(paths).not.toContain(".noumena");
  });
});

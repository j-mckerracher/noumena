import { describe, it, expect } from "vitest";
import { extractArticle } from "../src/main/ipc";

describe("extractArticle", () => {
  it("returns the article subtree", () => {
    const html = `<!doctype html><html><head></head><body><article data-noumena-document>hi</article></body></html>`;
    expect(extractArticle(html)).toBe(`<article data-noumena-document>hi</article>`);
  });

  it("returns null when no article", () => {
    expect(extractArticle("<html><body></body></html>")).toBeNull();
  });
});

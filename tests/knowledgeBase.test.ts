import { describe, it, expect } from "vitest";
import { knowledgeBase } from "@/data/knowledgeBase";
import { retrieveTopChunks } from "@/lib/retrieval";

describe("knowledgeBase data", () => {
  it("exposes a non-empty dataset", () => {
    expect(knowledgeBase.length).toBeGreaterThan(0);
  });

  it("assigns a unique id to every chunk", () => {
    const ids = knowledgeBase.map((chunk) => chunk.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every chunk a non-empty title, content, and source", () => {
    for (const chunk of knowledgeBase) {
      expect(chunk.title.trim().length).toBeGreaterThan(0);
      expect(chunk.content.trim().length).toBeGreaterThan(0);
      expect(chunk.source.trim().length).toBeGreaterThan(0);
    }
  });

  it("references a markdown doc under the docs directory", () => {
    for (const chunk of knowledgeBase) {
      expect(chunk.source).toMatch(/^docs\/[a-z-]+\.md$/);
    }
  });

  it("keeps chunk content long enough for meaningful lexical scoring", () => {
    for (const chunk of knowledgeBase) {
      expect(chunk.content.split(/\s+/).length).toBeGreaterThan(10);
    }
  });

  it("stays in sync with the retrieval pipeline (every chunk is retrievable)", () => {
    // Pull a distinctive term from each chunk's own title and confirm the
    // retrieval pipeline can still find the chunk it came from.
    for (const chunk of knowledgeBase) {
      const distinctiveTitleWord = chunk.title.split(/\s+/)[0].toLowerCase();
      const { chunks } = retrieveTopChunks(distinctiveTitleWord, 6);
      const ids = chunks.map((hit) => hit.id);
      expect(ids, `chunk ${chunk.id} should be retrievable via "${distinctiveTitleWord}"`).toContain(chunk.id);
    }
  });
});
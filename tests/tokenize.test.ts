import { describe, expect, it } from "vitest";
import { retrieveTopChunks } from "@/lib/retrieval";
import { tokenize } from "@/lib/tokenize";

describe("shared tokenizer", () => {
  it("lowercases and strips punctuation", () => {
    expect(tokenize("Hello, World! It's 2026.")).toEqual(["hello", "world", "it", "s", "2026"]);
  });

  it("returns an empty array for symbol-only input", () => {
    expect(tokenize("!!! ???")).toEqual([]);
  });
});

describe("retrieveTopChunks", () => {
  it("ranks the most on-topic chunk first", () => {
    const { chunks } = retrieveTopChunks("streaming responses user experience", 3);
    expect(chunks[0].id).toBe("streaming-ux-1");
  });

  it("returns no more than topK results with positive scores", () => {
    const { chunks } = retrieveTopChunks("retrieval evaluation latency", 2);
    expect(chunks.length).toBeLessThanOrEqual(2);
    for (const chunk of chunks) {
      expect(chunk.score).toBeGreaterThan(0);
    }
  });
});

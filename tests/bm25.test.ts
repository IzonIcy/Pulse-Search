import { describe, expect, it } from "vitest";
import { retrieveTopBm25 } from "@/lib/bm25";
import { retrieveTopChunks } from "@/lib/retrieval";

describe("retrieveTopBm25", () => {
  it("ranks the most on-topic chunk first", () => {
    const { chunks } = retrieveTopBm25("streaming responses user experience", 3);
    expect(chunks[0].id).toBe("streaming-ux-1");
  });

  it("rewards multi-term matches more than raw frequency does", () => {
    const query = "grounding hallucinations context model";
    const bm25 = retrieveTopBm25(query, 1);
    expect(bm25.chunks[0].id).toBe("rag-grounding-1");
  });

  it("caps results at topK with positive scores", () => {
    const { chunks } = retrieveTopBm25("retrieval scoring pipeline", 2);
    expect(chunks.length).toBeLessThanOrEqual(2);
    for (const chunk of chunks) {
      expect(chunk.score).toBeGreaterThan(0);
    }
  });

  it("returns an empty list when nothing matches", () => {
    const { chunks } = retrieveTopBm25("zxq wvv kkk", 3);
    expect(chunks).toEqual([]);
  });

  it("agrees with the tf retriever on the trivial single-word case", () => {
    expect(retrieveTopBm25("streaming", 1).chunks[0].id).toBe(
      retrieveTopChunks("streaming", 1).chunks[0].id,
    );
  });
});

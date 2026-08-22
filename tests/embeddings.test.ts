import { describe, expect, it } from "vitest";
import { cosineSimilarity, loadEmbeddings, rankByCosine, type EmbeddingsFile } from "@/lib/embeddings";

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors and 0 for orthogonal ones", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("handles zero vectors without exploding", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("rankByCosine", () => {
  const file: EmbeddingsFile = {
    model: "test-model",
    dim: 3,
    items: [
      { id: "close", vector: [1, 0, 0] },
      { id: "closer", vector: [0.9, 0.1, 0] },
      { id: "orthogonal", vector: [0, 1, 0] },
      { id: "wrong-dim", vector: [1, 1] },
    ],
  };

  it("sorts by similarity descending and skips dimension mismatches", () => {
    const result = rankByCosine([1, 0, 0], file);
    expect(result.chunks.map((c) => c.id)).toEqual(["close", "closer", "orthogonal"]);
    expect(result.chunks[0].score).toBeCloseTo(1);
  });

  it("reports retrieval latency as a number", () => {
    const result = rankByCosine([1, 0, 0], file);
    expect(typeof result.retrievalLatencyMs).toBe("number");
  });
});

describe("loadEmbeddings", () => {
  it("returns null for a missing or malformed file instead of throwing", () => {
    expect(loadEmbeddings("/definitely/not/here/embeddings.json")).toBeNull();
  });
});

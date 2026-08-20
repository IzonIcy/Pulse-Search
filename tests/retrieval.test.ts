import { describe, it, expect } from "vitest";
import { retrieveTopChunks } from "@/lib/retrieval";
import { knowledgeBase } from "@/data/knowledgeBase";

// Expected scores below are computed from the actual knowledgeBase data with
// the scoring formula: sum(1 + ln(freq)) for each matching query token,
// normalized by sqrt(total chunk tokens), rounded to 4 decimals.

describe("retrieveTopChunks", () => {
  describe("happy path", () => {
    it("returns the most relevant chunk first for a keyword query", () => {
      const { chunks } = retrieveTopChunks("streaming");
      expect(chunks[0].id).toBe("streaming-ux-1");
      expect(chunks[0].score).toBe(0.2784);
    });

    it("matches terms found only in a chunk title", () => {
      const { chunks } = retrieveTopChunks("evaluating");
      expect(chunks[0].id).toBe("evaluation-1");
    });

    it("matches terms found only in a chunk body", () => {
      const { chunks } = retrieveTopChunks("hallucinations");
      expect(chunks[0].id).toBe("rag-grounding-1");
      expect(chunks[0].score).toBe(0.169);
    });

    it("ranks chunks by descending score", () => {
      const { chunks } = retrieveTopChunks("retrieval");
      const scores = chunks.map((chunk) => chunk.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
      expect(chunks.map((chunk) => chunk.id)).toEqual([
        "evaluation-1",
        "retrieval-pipeline-1",
        "latency-breakdown-1",
      ]);
    });

    it("returns at most topK chunks with a default of 3", () => {
      const { chunks } = retrieveTopChunks("retrieval");
      expect(chunks).toHaveLength(3);
    });

    it("respects a custom topK limit", () => {
      const { chunks } = retrieveTopChunks("retrieval", 2);
      expect(chunks).toHaveLength(2);
    });

    it("returns every matching chunk when topK exceeds the dataset size", () => {
      const { chunks } = retrieveTopChunks("retrieval", 10);
      expect(chunks).toHaveLength(3);
      expect(chunks.length).toBeLessThanOrEqual(knowledgeBase.length);
    });

    it("is case-insensitive", () => {
      const lower = retrieveTopChunks("streaming");
      const upper = retrieveTopChunks("STREAMING");
      expect(upper.chunks).toEqual(lower.chunks);
    });

    it("sums per-term matches for multi-term queries", () => {
      const { chunks } = retrieveTopChunks("retrieval pipeline");
      expect(chunks[0].id).toBe("retrieval-pipeline-1");
      expect(chunks[0].score).toBe(0.5493);
    });

    it("splits hyphenated query terms into separate tokens", () => {
      const hyphenated = retrieveTopChunks("top-k");
      const spaced = retrieveTopChunks("top k");
      expect(hyphenated.chunks).toEqual(spaced.chunks);
      expect(hyphenated.chunks[0].id).toBe("evaluation-1");
    });

    it("rounds every score to four decimal places", () => {
      const { chunks } = retrieveTopChunks("streaming latency");
      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        expect(Number(chunk.score.toFixed(4))).toBe(chunk.score);
      }
    });

    it("reports a non-negative numeric retrieval latency", () => {
      const { retrievalLatencyMs } = retrieveTopChunks("streaming");
      expect(typeof retrievalLatencyMs).toBe("number");
      expect(retrievalLatencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("edge cases", () => {
    it("returns no chunks for an empty query", () => {
      const { chunks, retrievalLatencyMs } = retrieveTopChunks("");
      expect(chunks).toEqual([]);
      expect(retrievalLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it("returns no chunks for a whitespace-only query", () => {
      expect(retrieveTopChunks("   ").chunks).toEqual([]);
    });

    it("returns no chunks for a punctuation-only query", () => {
      expect(retrieveTopChunks("!!! ???").chunks).toEqual([]);
    });

    it("returns no chunks when no term is known to the dataset", () => {
      expect(retrieveTopChunks("xyzzy quux").chunks).toEqual([]);
    });

    it("returns an empty result when topK is zero", () => {
      expect(retrieveTopChunks("streaming", 0).chunks).toEqual([]);
    });

    it("requires exact token matches rather than substrings or stems", () => {
      // "stream" is a real token, but it must not match "streaming"
      const { chunks } = retrieveTopChunks("streaming");
      const ids = chunks.map((chunk) => chunk.id);
      expect(ids).toContain("streaming-ux-1");
      expect(ids).not.toContain("scope-guidance-1");
    });
  });

  describe("regressions", () => {
    it("does not mutate the knowledge base chunks", () => {
      const before = knowledgeBase.map((chunk) => ({ ...chunk }));
      retrieveTopChunks("streaming latency", 10);
      expect(knowledgeBase).toEqual(before);
      expect("score" in knowledgeBase[0]).toBe(false);
    });

    it("returns copies of chunks, not references into the dataset", () => {
      const { chunks } = retrieveTopChunks("streaming");
      const source = knowledgeBase.find((chunk) => chunk.id === "streaming-ux-1");
      expect(chunks[0]).not.toBe(source);
    });

    it("produces identical chunk results on repeated calls", () => {
      const first = retrieveTopChunks("retrieval pipeline");
      const second = retrieveTopChunks("retrieval pipeline");
      expect(second.chunks).toEqual(first.chunks);
      expect(typeof second.retrievalLatencyMs).toBe("number");
    });
  });
});
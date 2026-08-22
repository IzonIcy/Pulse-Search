import { knowledgeBase, type KnowledgeChunk } from "@/data/knowledgeBase";
import type { RetrievedChunk } from "@/lib/retrieval";
import { tokenize } from "@/lib/tokenize";

export type Bm25Options = {
  k1?: number;
  b?: number;
};

type IndexedChunk = {
  chunk: KnowledgeChunk;
  termFrequency: Map<string, number>;
  length: number;
};

function buildIndex(): { index: IndexedChunk[]; avgLength: number; documentFrequency: Map<string, number> } {
  const index: IndexedChunk[] = knowledgeBase.map((chunk) => {
    const tokens = tokenize(`${chunk.title} ${chunk.content}`);
    const termFrequency = new Map<string, number>();
    for (const token of tokens) {
      termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
    }
    return { chunk, termFrequency, length: tokens.length };
  });

  const documentFrequency = new Map<string, number>();
  let totalLength = 0;
  for (const entry of index) {
    totalLength += entry.length;
    for (const term of entry.termFrequency.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  return { index, avgLength: index.length > 0 ? totalLength / index.length : 0, documentFrequency };
}

const lazyIndex: { value: ReturnType<typeof buildIndex> | null } = { value: null };

function getIndex() {
  if (!lazyIndex.value) {
    lazyIndex.value = buildIndex();
  }
  return lazyIndex.value;
}

/**
 * Okapi BM25 scoring over the local knowledge base.
 * Handles length normalization and term saturation that raw term
 * frequency ignores, which typically ranks multi-term queries better.
 */
export function retrieveTopBm25(
  query: string,
  topK = 3,
  options: Bm25Options = {},
): { chunks: RetrievedChunk[]; retrievalLatencyMs: number } {
  const startedAt = performance.now();
  const k1 = options.k1 ?? 1.5;
  const b = options.b ?? 0.75;
  const queryTokens = tokenize(query);
  const { index, avgLength, documentFrequency } = getIndex();

  const scored = index.map(({ chunk, termFrequency, length }) => {
    let score = 0;
    for (const term of new Set(queryTokens)) {
      const frequency = termFrequency.get(term) ?? 0;
      if (frequency === 0) continue;

      const idf = Math.log(
        1 + (index.length - documentFrequency.get(term)! + 0.5) / (documentFrequency.get(term)! + 0.5),
      );
      score +=
        idf *
        ((frequency * (k1 + 1)) / (frequency + k1 * (1 - b + b * (length / (avgLength || 1)))));
    }
    return { ...chunk, score };
  });

  const ranked = scored
    .filter((chunk) => chunk.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, topK)
    .map((chunk) => ({ ...chunk, score: Number(chunk.score.toFixed(4)) }));

  return { chunks: ranked, retrievalLatencyMs: Number((performance.now() - startedAt).toFixed(2)) };
}

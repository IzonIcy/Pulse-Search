import { knowledgeBase, type KnowledgeChunk } from "@/data/knowledgeBase";
import { tokenize } from "@/lib/tokenize";

export type RetrievedChunk = KnowledgeChunk & {
  score: number;
};

function frequencyMap(tokens: string[]): Map<string, number> {
  const frequency = new Map<string, number>();

  for (const token of tokens) {
    frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }

  return frequency;
}

function scoreChunk(queryTokens: string[], chunk: KnowledgeChunk): number {
  const contentTokens = tokenize(`${chunk.title} ${chunk.content}`);

  if (queryTokens.length === 0 || contentTokens.length === 0) {
    return 0;
  }

  const tokenFrequency = frequencyMap(contentTokens);

  let score = 0;
  for (const queryToken of queryTokens) {
    const matches = tokenFrequency.get(queryToken) ?? 0;
    score += matches > 0 ? 1 + Math.log(matches) : 0;
  }

  const normalization = Math.sqrt(contentTokens.length);
  return score / normalization;
}

export function retrieveTopChunks(
  query: string,
  topK = 3,
): { chunks: RetrievedChunk[]; retrievalLatencyMs: number } {
  const startedAt = performance.now();
  const queryTokens = tokenize(query);

  const ranked = knowledgeBase
    .map((chunk) => ({ ...chunk, score: scoreChunk(queryTokens, chunk) }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((chunk) => ({
      ...chunk,
      score: Number(chunk.score.toFixed(4)),
    }));

  const retrievalLatencyMs = Number((performance.now() - startedAt).toFixed(2));

  return { chunks: ranked, retrievalLatencyMs };
}

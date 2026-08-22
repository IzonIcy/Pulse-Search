import fs from "node:fs";
import path from "node:path";

/**
 * Embeddings index built by `npm run embeddings` (scripts/build-embeddings.mjs).
 * Kept out of the bundle: loaded lazily server-side only when the route is
 * asked to use RETRIEVER=embeddings.
 */
export type EmbeddingsFile = {
  model: string;
  dim: number;
  items: Array<{ id: string; contentHash?: string; vector: number[] }>;
};

export function defaultEmbeddingsPath(): string {
  return path.join(process.cwd(), "src", "data", "embeddings.json");
}

export function loadEmbeddings(filePath: string = defaultEmbeddingsPath()): EmbeddingsFile | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as EmbeddingsFile;
    if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export type EmbeddingRankerResult = {
  chunks: Array<{ id: string; score: number }>;
  retrievalLatencyMs: number;
};

/**
 * Rank stored chunk vectors against a query vector by cosine similarity.
 * Pure and synchronous so it is trivially testable.
 */
export function rankByCosine(
  queryVector: number[],
  file: EmbeddingsFile,
): EmbeddingRankerResult {
  const startedAt = performance.now();

  const chunks = file.items
    .filter((item) => Array.isArray(item.vector) && item.vector.length === queryVector.length)
    .map((item) => ({ id: item.id, score: Number(cosineSimilarity(queryVector, item.vector).toFixed(4)) }))
    .sort((a, b) => b.score - a.score);

  return { chunks, retrievalLatencyMs: Number((performance.now() - startedAt).toFixed(2)) };
}

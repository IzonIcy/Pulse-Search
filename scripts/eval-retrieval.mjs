// Retrieval quality eval: golden query -> expected chunk pairs.
//
//   npm run eval
//
// Prints precision@3 for each lexical retriever. Informational — a warning
// is printed when bm25 underperforms tf on this set.
import { retrieveTopChunks } from "../src/lib/retrieval.ts";
import { retrieveTopBm25 } from "../src/lib/bm25.ts";

const GOLDEN = [
  { query: "why do streaming responses feel faster", expected: "streaming-ux-1" },
  { query: "how does a retrieval pipeline work", expected: "retrieval-pipeline-1" },
  { query: "reducing hallucinations with context", expected: "rag-grounding-1" },
  { query: "which latency numbers matter for debugging", expected: "latency-breakdown-1" },
  { query: "how much context should I include", expected: "scope-guidance-1" },
  { query: "measuring retrieval quality", expected: "evaluation-1" },
  { query: "token streaming and perceived speed", expected: "streaming-ux-1" },
  { query: "lexical scoring for early stage systems", expected: "retrieval-pipeline-1" },
];

const K = 3;

function precisionAtK(retrieve) {
  let hits = 0;
  const perQuery = [];
  for (const { query, expected } of GOLDEN) {
    const { chunks } = retrieve(query, K);
    const hit = chunks.slice(0, K).some((chunk) => chunk.id === expected);
    if (hit) hits += 1;
    perQuery.push({ query, expected, hit });
  }
  return { score: hits / GOLDEN.length, perQuery };
}

const retrievers = [
  ["tf", retrieveTopChunks],
  ["bm25", retrieveTopBm25],
];

console.log(`precision@${K} over ${GOLDEN.length} golden queries\n`);
const results = {};
for (const [name, retrieve] of retrievers) {
  const { score, perQuery } = precisionAtK(retrieve);
  results[name] = score;
  console.log(`${name.padEnd(6)} ${(score * 100).toFixed(0)}%`);
  for (const entry of perQuery.filter((q) => !q.hit)) {
    console.log(`  miss: "${entry.query}" (expected ${entry.expected})`);
  }
}

if (results.bm25 < results.tf) {
  console.log(
    "\nwarning: bm25 scored below tf on this golden set — inspect before switching RETRIEVER=bm25.",
  );
}

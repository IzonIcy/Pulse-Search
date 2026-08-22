// Builds src/data/embeddings.json from the local knowledge base.
//
//   OPENAI_API_KEY=sk-... npm run embeddings
//
// Incremental: chunks whose content hash already exists in the output file
// are skipped, so re-running only embeds new or changed chunks.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

const EMBEDDING_MODEL = "text-embedding-3-small";
const OUT_PATH = path.join(process.cwd(), "src", "data", "embeddings.json");

function contentHashOf(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY is required to build embeddings.");
    process.exit(1);
  }

  // tsx (via `npm run embeddings`) lets this script import the TS data module.
  const { knowledgeBase } = await import("../src/data/knowledgeBase.ts");

  let file = { model: EMBEDDING_MODEL, dim: 0, items: [] };
  try {
    file = JSON.parse(fs.readFileSync(OUT_PATH, "utf8"));
    console.log(`Loaded existing index: ${file.items.length} items.`);
  } catch {
    console.log("No existing index; starting fresh.");
  }

  const existing = new Map(file.items.map((item) => [item.id, item]));
  const client = new OpenAI({ apiKey });

  for (const chunk of knowledgeBase) {
    const hash = contentHashOf(chunk.content);
    const previous = existing.get(chunk.id);
    if (previous && previous.contentHash === hash) {
      continue;
    }

    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: `${chunk.title}\n\n${chunk.content}`,
    });
    const vector = response.data[0].embedding;
    existing.set(chunk.id, { id: chunk.id, contentHash: hash, vector });
    file.dim = vector.length;
    console.log(`embedded ${chunk.id} (${vector.length} dims)`);
  }

  file.model = EMBEDDING_MODEL;
  file.items = [...existing.values()];

  const tmp = `${OUT_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file));
  fs.renameSync(tmp, OUT_PATH);
  console.log(`Wrote ${file.items.length} embeddings to ${OUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

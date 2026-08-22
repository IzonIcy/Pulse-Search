import OpenAI from "openai";
import { retrieveTopChunks } from "@/lib/retrieval";
import { retrieveTopBm25 } from "@/lib/bm25";
import { loadEmbeddings, rankByCosine } from "@/lib/embeddings";
import { knowledgeBase } from "@/data/knowledgeBase";

export const runtime = "nodejs";

const MODEL = "gpt-4.1-mini";
const EMBEDDING_MODEL = "text-embedding-3-small";

type RetrieverName = "tf" | "bm25" | "embeddings";

function resolveRetriever(): RetrieverName {
  const requested = (process.env.RETRIEVER ?? "").toLowerCase();
  if (requested === "bm25" || requested === "tf" || requested === "embeddings") {
    return requested;
  }
  return "tf";
}

type AskBody = {
  query?: string;
};

type StreamMetrics = {
  startedAt: number;
  firstTokenLatencyMs: number | null;
};

async function parseAskBody(request: Request): Promise<AskBody | null> {
  try {
    const body = await request.json();

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }

    return body as AskBody;
  } catch {
    return null;
  }
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function latencySince(startedAt: number): number {
  return Number((performance.now() - startedAt).toFixed(2));
}

function markFirstToken(metrics: StreamMetrics) {
  if (metrics.firstTokenLatencyMs === null) {
    metrics.firstTokenLatencyMs = latencySince(metrics.startedAt);
  }
}

function sendEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  payload: unknown,
) {
  controller.enqueue(encoder.encode(sseEvent(event, payload)));
}

async function streamFallbackAnswer(
  answer: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  metrics: StreamMetrics,
) {
  const tokens = answer.split(/(\s+)/);

  for (const token of tokens) {
    markFirstToken(metrics);
    sendEvent(controller, encoder, "token", token);
    await new Promise((resolve) => setTimeout(resolve, 14));
  }
}

async function streamModelAnswer(
  query: string,
  contextText: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  metrics: StreamMetrics,
) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const completion = await client.responses.create({
    model: MODEL,
    stream: true,
    input: [
      {
        role: "system",
        content:
          "You answer using only retrieved context. If context is missing, say what is unknown and avoid inventing details.",
      },
      {
        role: "user",
        content: `Question: ${query}\n\nRetrieved context:\n${contextText}`,
      },
    ],
  });

  for await (const event of completion) {
    if (event.type === "response.output_text.delta" && event.delta) {
      markFirstToken(metrics);
      sendEvent(controller, encoder, "token", event.delta);
    }
  }
}

function buildFallbackAnswer(query: string, contextText: string): string {
  return [
    `You asked: "${query}".`,
    "",
    "I could not find OPENAI_API_KEY, so this is a local fallback answer generated from retrieved context.",
    "",
    "Most relevant context:",
    contextText,
  ].join("\n");
}

async function retrieveChunks(
  query: string,
  topK: number,
): Promise<{ chunks: Awaited<ReturnType<typeof retrieveTopChunks>>["chunks"]; retrievalLatencyMs: number; retriever: RetrieverName }> {
  const retriever = resolveRetriever();

  if (retriever === "embeddings") {
    const file = loadEmbeddings();
    if (!file || !process.env.OPENAI_API_KEY) {
      console.warn(
        "[ask] RETRIEVER=embeddings needs src/data/embeddings.json (npm run embeddings) and OPENAI_API_KEY; falling back to tf.",
      );
    } else {
      try {
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const embedded = await client.embeddings.create({
          model: EMBEDDING_MODEL,
          input: query,
        });
        const queryVector = embedded.data[0].embedding;
        if (queryVector.length !== file.dim) {
          throw new Error(`dim mismatch: index ${file.dim} vs model ${queryVector.length}`);
        }
        const ranked = rankByCosine(queryVector, file);
        const byId = new Map(knowledgeBase.map((chunk) => [chunk.id, chunk]));
        const chunks = ranked.chunks
          .filter((item) => item.score > 0)
          .slice(0, topK)
          .flatMap((item) => {
            const chunk = byId.get(item.id);
            return chunk ? [{ ...chunk, score: item.score }] : [];
          });
        if (chunks.length > 0) {
          return { chunks, retrievalLatencyMs: ranked.retrievalLatencyMs, retriever };
        }
      } catch (error) {
        console.warn(
          `[ask] embeddings retrieval failed (${error instanceof Error ? error.message : "unknown"}); falling back to tf.`,
        );
      }
    }
  }

  if (retriever === "bm25") {
    const result = retrieveTopBm25(query, topK);
    return { ...result, retriever: "bm25" };
  }

  const result = retrieveTopChunks(query, topK);
  return { ...result, retriever: "tf" };
}

export async function POST(request: Request): Promise<Response> {
  const body = await parseAskBody(request);

  if (!body) {
    return Response.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }

  const query = body.query?.trim() ?? "";

  if (!query) {
    return Response.json({ error: "Query is required." }, { status: 400 });
  }

  const { chunks, retrievalLatencyMs, retriever } = await retrieveChunks(query, 4);

  const contextText =
    chunks.length > 0
      ? chunks
          .map((chunk, index) => `(${index + 1}) [${chunk.source}] ${chunk.content}`)
          .join("\n")
      : "No relevant chunks found in local dataset.";

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const metrics: StreamMetrics = {
        startedAt: performance.now(),
        firstTokenLatencyMs: null,
      };

      sendEvent(controller, encoder, "diagnostics", {
        chunks,
        retrievalLatencyMs,
        retriever,
        model: process.env.OPENAI_API_KEY ? MODEL : "fallback-local",
      });

      const usingFallback = !process.env.OPENAI_API_KEY;

      try {
        if (usingFallback) {
          const fallbackAnswer = buildFallbackAnswer(query, contextText);
          await streamFallbackAnswer(fallbackAnswer, controller, encoder, metrics);
        } else {
          await streamModelAnswer(query, contextText, controller, encoder, metrics);
        }

        sendEvent(controller, encoder, "done", {
          firstTokenLatencyMs: metrics.firstTokenLatencyMs,
          totalLatencyMs: latencySince(metrics.startedAt),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        sendEvent(controller, encoder, "error", { message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

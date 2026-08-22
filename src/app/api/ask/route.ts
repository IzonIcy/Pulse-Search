import OpenAI from "openai";
import { retrieveTopChunks } from "@/lib/retrieval";

export const runtime = "nodejs";

const MODEL = "gpt-4.1-mini";

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

export async function POST(request: Request): Promise<Response> {
  const body = await parseAskBody(request);

  if (!body) {
    return Response.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }

  const query = body.query?.trim() ?? "";

  if (!query) {
    return Response.json({ error: "Query is required." }, { status: 400 });
  }

  const { chunks, retrievalLatencyMs } = retrieveTopChunks(query, 4);

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

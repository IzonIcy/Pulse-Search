"use client";

import { FormEvent, useState } from "react";
import { applySsePayload, type StreamHandlers } from "@/lib/sse-client";

type RetrievedChunk = {
  id: string;
  title: string;
  content: string;
  source: string;
  score: number;
};

type DiagnosticsState = {
  chunks: RetrievedChunk[];
  retrievalLatencyMs: number;
  retriever: string;
  model: string;
  firstTokenLatencyMs: number | null;
  totalLatencyMs: number | null;
};

function createInitialDiagnosticsState(): DiagnosticsState {
  return {
    chunks: [],
    retrievalLatencyMs: 0,
    retriever: "",
    model: "",
    firstTokenLatencyMs: null,
    totalLatencyMs: null,
  };
}

async function readRequestError(result: Response): Promise<string> {
  const contentType = result.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const payload = (await result.json()) as { error?: string; message?: string };
      return payload.error ?? payload.message ?? `Request failed with status ${result.status}.`;
    } catch {
      return `Request failed with status ${result.status}.`;
    }
  }

  const message = await result.text();
  return message.trim() || `Request failed with status ${result.status}.`;
}


function ChunkCard({ chunk, rank }: { chunk: RetrievedChunk; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = `chunk-content-${chunk.id}`;

  return (
    <div className="chunk-card">
      <header>
        <h3 style={{ display: "inline" }}>
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            aria-controls={contentId}
            style={{ all: "unset", cursor: "pointer" }}
            className="chunk-toggle"
          >
            [{rank}] {chunk.title}
          </button>
        </h3>
        <span>relevance {chunk.score}</span>
      </header>
      <p id={contentId} hidden={!expanded}>
        {chunk.content}
      </p>
      <small>{expanded ? chunk.source : `${chunk.source} · click title to expand`}</small>
    </div>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [diagnosticsState, setDiagnosticsState] = useState<DiagnosticsState>(
    createInitialDiagnosticsState,
  );

  const canSubmit = query.trim().length > 0 && !isLoading;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!query.trim() || isLoading) {
      return;
    }

    setIsLoading(true);
    setError("");
    setResponse("");
    setDiagnosticsState(createInitialDiagnosticsState());

    const streamHandlers: StreamHandlers = {
      onDiagnostics(payload) {
        setDiagnosticsState((current) => ({ ...current, ...(payload as Partial<DiagnosticsState>) }));
      },
      onToken(token) {
        setResponse((current) => current + token);
      },
      onDone(payload) {
        setDiagnosticsState((current) => ({ ...current, ...(payload as Partial<DiagnosticsState>) }));
      },
      onError(payload) {
        setError(
          typeof payload === "object" && payload !== null && "message" in payload
            ? String((payload as { message: unknown }).message)
            : "The answer service reported an error.",
        );
      },
    };

    try {
      const result = await fetch("/api/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });

      if (!result.ok) {
        throw new Error(await readRequestError(result));
      }

      if (!result.body) {
        throw new Error("Could not start stream.");
      }

      const reader = result.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const boundaries = buffer.split("\n\n");
        buffer = boundaries.pop() ?? "";

        const completeBlocks = boundaries.join("\n\n");
        if (!completeBlocks) {
          continue;
        }

        applySsePayload(completeBlocks, streamHandlers);
      }

      if (buffer) {
        applySsePayload(buffer, streamHandlers);
      }
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : "Unexpected request failure.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="hero-strip">
        <p className="eyebrow">Streaming Retrieval Playground</p>
        <h1>Evaluate Retrieval with Live Model Output</h1>
        <p className="hero-copy">
          Submit a question, inspect retrieved evidence, and observe the generated response as it streams in real time.
        </p>
      </section>

      <section className="panel-grid">
        <article className="panel question-panel">
          <h2>Question</h2>
          <form onSubmit={handleSubmit} className="prompt-form">
            <textarea
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Example: Which latency metrics are most useful when diagnosing retrieval quality issues?"
              rows={4}
            />
            <button type="submit" disabled={!canSubmit}>
              {isLoading ? "Streaming response..." : "Run Query"}
            </button>
          </form>
          {error && <p className="error-text">Request failed: {error}</p>}
        </article>

        <article className="panel response-panel">
          <h2>Response Stream</h2>
          {/* aria-live lets screen readers follow the stream as tokens arrive. */}
          <pre aria-live="polite">{response || "The streamed response will appear here."}</pre>
        </article>

        <article className="panel diagnostics-panel">
          <h2>Diagnostics</h2>
          <div className="metrics-row">
            <span>Model: {diagnosticsState.model || "-"}</span>
            <span>Retriever: {diagnosticsState.retriever || "-"}</span>
            <span>Retrieval: {diagnosticsState.retrievalLatencyMs || 0} ms</span>
            <span>First token latency: {diagnosticsState.firstTokenLatencyMs ?? "-"} ms</span>
            <span>Total latency: {diagnosticsState.totalLatencyMs ?? "-"} ms</span>
          </div>

          <div className="chunk-list">
            {diagnosticsState.chunks.length === 0 ? (
              <p className="empty-note">Retrieved chunks and relevance scores will appear here.</p>
            ) : (
              diagnosticsState.chunks.map((chunk, index) => (
                <ChunkCard key={chunk.id} chunk={chunk} rank={index + 1} />
              ))
            )}
          </div>
        </article>
      </section>
    </main>
  );
}

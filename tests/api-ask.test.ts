import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "@/app/api/ask/route";

// These tests exercise the local fallback path: with no OPENAI_API_KEY the
// route must never call an external service, so no mocking is required.
// The suite also covers all request-validation error paths.

type SseEvent = { event: string; data: string };

function parseSse(text: string): SseEvent[] {
  return text
    .split("\n\n")
    .filter((block) => block.trim().length > 0)
    .map((block) => ({
      event: block.match(/^event: (.+)$/m)?.[1] ?? "",
      data: block.match(/^data: (.+)$/m)?.[1] ?? "",
    }));
}

function askRequest(body: string | null): Request {
  return new Request("http://localhost:3000/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("POST /api/ask", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  describe("error paths", () => {
    it("returns 400 when the request body is not valid JSON", async () => {
      const res = await POST(askRequest("{not json"));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Request body must be a JSON object.",
      });
    });

    it("returns 400 when the body is a JSON array", async () => {
      const res = await POST(askRequest("[1, 2, 3]"));
      expect(res.status).toBe(400);
    });

    it("returns 400 when the body is JSON null", async () => {
      const res = await POST(askRequest("null"));
      expect(res.status).toBe(400);
    });

    it("returns 400 when the query field is missing", async () => {
      const res = await POST(askRequest("{}"));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Query is required." });
    });

    it("returns 400 when the query is an empty string", async () => {
      const res = await POST(askRequest(JSON.stringify({ query: "" })));
      expect(res.status).toBe(400);
    });

    it("returns 400 when the query is only whitespace", async () => {
      const res = await POST(askRequest(JSON.stringify({ query: "   " })));
      expect(res.status).toBe(400);
    });
  });

  describe("happy path (local fallback, no API key)", () => {
    it("returns an SSE response for a valid query", async () => {
      const res = await POST(askRequest(JSON.stringify({ query: "streaming" })));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      expect(res.headers.get("cache-control")).toContain("no-cache");
    });

    it("emits diagnostics, then token events, then a done event", async () => {
      const res = await POST(askRequest(JSON.stringify({ query: "streaming" })));
      const names = parseSse(await res.text()).map((event) => event.event);

      expect(names[0]).toBe("diagnostics");
      expect(names).toContain("token");
      expect(names[names.length - 1]).toBe("done");
      expect(names).not.toContain("error");
    });

    it("reports the local fallback model and retrieved chunks in diagnostics", async () => {
      const res = await POST(askRequest(JSON.stringify({ query: "streaming" })));
      const events = parseSse(await res.text());
      const diagnostics = JSON.parse(
        events.find((event) => event.event === "diagnostics")!.data,
      );

      expect(diagnostics.model).toBe("fallback-local");
      expect(diagnostics.chunks[0].id).toBe("streaming-ux-1");
      expect(diagnostics.retrievalLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it("streams the fallback answer text as token events", async () => {
      const res = await POST(askRequest(JSON.stringify({ query: "streaming" })));
      const events = parseSse(await res.text());
      const streamedText = events
        .filter((event) => event.event === "token")
        .map((event) => JSON.parse(event.data) as string)
        .join("");

      expect(streamedText).toContain("local fallback answer");
      expect(streamedText).toContain("[docs/streaming.md]");
    });

    it("emits a done event with latency metrics", async () => {
      const res = await POST(askRequest(JSON.stringify({ query: "streaming" })));
      const events = parseSse(await res.text());
      const done = JSON.parse(events[events.length - 1].data);

      expect(done.firstTokenLatencyMs).toBeGreaterThanOrEqual(0);
      expect(done.totalLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it("handles a query with no matching chunks without an error event", async () => {
      const res = await POST(askRequest(JSON.stringify({ query: "xyzzy quux" })));
      const events = parseSse(await res.text());
      const diagnostics = JSON.parse(
        events.find((event) => event.event === "diagnostics")!.data,
      );

      expect(diagnostics.chunks).toEqual([]);
      expect(events.some((event) => event.event === "error")).toBe(false);
      expect(events[events.length - 1].event).toBe("done");
    });
  });
});
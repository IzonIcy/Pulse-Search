import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/ask/route";

// These tests cover the OpenAI-backed path of the route. OpenAI is mocked at
// the module boundary so no network call is ever made.

const { createMock } = vi.hoisted(() => {
  type CreateParams = {
    model: string;
    stream: boolean;
    input: Array<{ role: string; content: string }>;
  };
  const create = vi.fn(async function* (_params: CreateParams) {
    yield { type: "response.output_text.delta", delta: "Model " };
    yield { type: "response.output_text.delta", delta: "answer" };
  });
  return { createMock: create };
});

vi.mock("openai", () => ({
  default: class MockOpenAI {
    responses = { create: createMock };
  },
}));

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

function askRequest(query: string): Request {
  return new Request("http://localhost:3000/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
}

describe("POST /api/ask with an OpenAI API key", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    createMock.mockClear();
  });

  it("reports the streaming model in diagnostics when an API key is set", async () => {
    const res = await POST(askRequest("streaming"));
    const events = parseSse(await res.text());
    const diagnostics = JSON.parse(
      events.find((event) => event.event === "diagnostics")!.data,
    );

    expect(diagnostics.model).toBe("gpt-4.1-mini");
  });

  it("streams model deltas as token events", async () => {
    const res = await POST(askRequest("streaming"));
    const events = parseSse(await res.text());
    const tokens = events
      .filter((event) => event.event === "token")
      .map((event) => JSON.parse(event.data) as string);

    expect(tokens.join("")).toBe("Model answer");
  });

  it("passes the query and retrieved context to the model", async () => {
    await POST(askRequest("streaming"));

    expect(createMock).toHaveBeenCalledTimes(1);
    const [args] = createMock.mock.calls[0]!;
    expect(args.model).toBe("gpt-4.1-mini");
    expect(args.stream).toBe(true);

    const userContent: string = args.input[1].content;
    expect(userContent).toContain("Question: streaming");
    expect(userContent).toContain("[docs/streaming.md]");
  });

  it("emits an error event when the model stream fails mid-way", async () => {
    createMock.mockImplementationOnce(async function* () {
      yield { type: "response.output_text.delta", delta: "Partial " };
      throw new Error("upstream failure");
    });

    const res = await POST(askRequest("streaming"));
    const events = parseSse(await res.text());

    const errorEvent = events.find((event) => event.event === "error");
    expect(errorEvent).toBeDefined();
    expect(JSON.parse(errorEvent!.data).message).toBe("upstream failure");
  });
});
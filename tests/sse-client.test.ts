import { describe, expect, it } from "vitest";
import { applySsePayload, type StreamHandlers } from "@/lib/sse-client";

function recordingHandlers() {
  const events: Array<{ kind: string; payload: unknown }> = [];
  const handlers: StreamHandlers = {
    onDiagnostics: (payload) => events.push({ kind: "diagnostics", payload }),
    onToken: (payload) => events.push({ kind: "token", payload }),
    onDone: (payload) => events.push({ kind: "done", payload }),
    onError: (payload) => events.push({ kind: "error", payload }),
  };
  return { events, handlers };
}

describe("applySsePayload", () => {
  it("dispatches each block to its handler", () => {
    const { events, handlers } = recordingHandlers();
    applySsePayload(
      [
        'event: diagnostics\ndata: {"model":"gpt"}',
        'event: token\ndata: "hello"',
        'event: done\ndata: {"totalLatencyMs":12}',
      ].join("\n\n"),
      handlers,
    );
    expect(events).toEqual([
      { kind: "diagnostics", payload: { model: "gpt" } },
      { kind: "token", payload: "hello" },
      { kind: "done", payload: { totalLatencyMs: 12 } },
    ]);
  });

  it("joins multi-line data fields before JSON parsing", () => {
    const { events, handlers } = recordingHandlers();
    applySsePayload('event: token\ndata: {"text":\ndata: "hello"}', handlers);
    expect(events).toEqual([{ kind: "token", payload: { text: "hello" } }]);
  });

  it("skips malformed blocks and keeps dispatching later ones", () => {
    const { events, handlers } = recordingHandlers();
    applySsePayload(
      ['event: token\ndata: not-json', 'event: token\ndata: "still here"'].join(
        "\n\n",
      ),
      handlers,
    );
    expect(events).toEqual([{ kind: "token", payload: "still here" }]);
  });

  it("ignores blocks missing an event or data line", () => {
    const { events, handlers } = recordingHandlers();
    applySsePayload("event: token\n\n: keep-alive comment\ndata: {}", handlers);
    expect(events).toEqual([]);
  });

  it("routes error events to onError", () => {
    const { events, handlers } = recordingHandlers();
    applySsePayload('event: error\ndata: {"message":"boom"}', handlers);
    expect(events).toEqual([
      { kind: "error", payload: { message: "boom" } },
    ]);
  });
});

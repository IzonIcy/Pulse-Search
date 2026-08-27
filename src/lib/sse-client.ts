/**
 * Client-side SSE parsing for the /api/ask stream.
 *
 * Extracted from the page component so the block-boundary and malformed-input
 * behavior is unit-testable. Per the SSE spec, `data:` may span multiple
 * lines; they are joined with newlines before JSON parsing.
 */

export type StreamHandlers = {
  onDiagnostics: (payload: unknown) => void;
  onToken: (payload: string) => void;
  onDone: (payload: unknown) => void;
  onError: (payload: unknown) => void;
};

function applySseBlock(block: string, handlers: StreamHandlers): void {
  const lines = block.split("\n");
  const eventLine = lines.find((line) => line.startsWith("event: "));
  const dataLines = lines
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length));

  if (!eventLine || dataLines.length === 0) {
    return;
  }

  const eventType = eventLine.replace("event: ", "").trim();
  let payload: unknown;
  try {
    // One malformed block must not throw out of the read loop and silently
    // discard every buffered block after it.
    payload = JSON.parse(dataLines.join("\n"));
  } catch {
    return;
  }

  if (eventType === "diagnostics") {
    handlers.onDiagnostics(payload);
  } else if (eventType === "token") {
    handlers.onToken(payload as string);
  } else if (eventType === "done") {
    handlers.onDone(payload);
  } else if (eventType === "error") {
    handlers.onError(payload);
  }
}

export function applySsePayload(raw: string, handlers: StreamHandlers): void {
  const blocks = raw.split("\n\n").filter(Boolean);
  for (const block of blocks) {
    applySseBlock(block, handlers);
  }
}

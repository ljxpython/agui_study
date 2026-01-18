import type { SSEFrame } from "./types";

export async function streamSSE(opts: {
  url: string;
  body: unknown;
  signal?: AbortSignal;
  onFrame: (frame: SSEFrame) => void;
}): Promise<void> {
  const res = await fetch(opts.url, {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(opts.body),
    signal: opts.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${res.statusText}${text ? `\n${text}` : ""}`);
  }

  if (!res.body) {
    throw new Error("Missing response body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let currentEvent = "";
  let currentId = "";
  let dataLines: string[] = [];

  const dispatch = () => {
    if (!currentEvent && dataLines.length === 0 && !currentId) return;
    opts.onFrame({
      event: currentEvent || undefined,
      id: currentId || undefined,
      data: dataLines.length ? dataLines.join("\n") : undefined,
    });
    currentEvent = "";
    currentId = "";
    dataLines = [];
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Parse complete lines from buffer.
    while (true) {
      const nl = buffer.indexOf("\n");
      if (nl === -1) break;
      let line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);

      if (line.endsWith("\r")) line = line.slice(0, -1);

      if (line === "") {
        dispatch();
        continue;
      }

      // Comment line
      if (line.startsWith(":")) continue;

      const idx = line.indexOf(":");
      const field = idx === -1 ? line : line.slice(0, idx);
      let valueStr = idx === -1 ? "" : line.slice(idx + 1);
      if (valueStr.startsWith(" ")) valueStr = valueStr.slice(1);

      if (field === "event") currentEvent = valueStr;
      else if (field === "data") dataLines.push(valueStr);
      else if (field === "id") currentId = valueStr;
      // retry is ignored
    }
  }

  // Flush the last pending event if the stream ends without a blank line.
  dispatch();
}

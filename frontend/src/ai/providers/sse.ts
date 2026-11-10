// Minimal Server-Sent Events reader. Every provider in v1 streams SSE, but the
// wire details differ (`data:` JSON shapes), so this module only extracts the
// `data:` payload of each event and leaves interpretation to the adapters.
//
// Handles CRLF, comment/`event:` lines, multi-line data fields, and a final
// event that arrives without the trailing blank line. No dependency.

/** Yield each SSE event's `data:` payload (multi-line data joined with "\n"). */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  const payloadOf = (raw: string): string =>
    raw
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");

  /** Pull every complete `\n\n`-terminated event out of the buffer. */
  const drain = (): string[] => {
    const out: string[] = [];
    for (let idx = buf.indexOf("\n\n"); idx >= 0; idx = buf.indexOf("\n\n")) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = payloadOf(raw);
      if (data.length > 0) out.push(data);
    }
    return out;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf = (buf + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
      for (const data of drain()) yield data;
    }
    buf = (buf + decoder.decode()).replace(/\r\n/g, "\n");
    // Providers normally end with a blank line; tolerate one that doesn't.
    if (buf.trim().length > 0) {
      const data = payloadOf(buf);
      if (data.length > 0) yield data;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released by the stream */
    }
  }
}

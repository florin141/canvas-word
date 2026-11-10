import { describe, expect, it } from "vitest";
import { sseData } from "./sse";

const encoder = new TextEncoder();

const streamOf = (chunks: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });

const collect = async (body: ReadableStream<Uint8Array>): Promise<string[]> => {
  const out: string[] = [];
  for await (const data of sseData(body)) out.push(data);
  return out;
};

describe("sseData", () => {
  it("yields the data payload of one event", async () => {
    expect(await collect(streamOf(['data: {"a":1}\n\n']))).toEqual(['{"a":1}']);
  });

  it("reassembles events split across chunk boundaries", async () => {
    expect(await collect(streamOf(["data: one\n", "\ndata: two\n\n"]))).toEqual(["one", "two"]);
  });

  it("normalizes CRLF", async () => {
    expect(await collect(streamOf(["data: hi\r\n\r\n"]))).toEqual(["hi"]);
  });

  it("joins multi-line data fields", async () => {
    expect(await collect(streamOf(["data: line1\ndata: line2\n\n"]))).toEqual(["line1\nline2"]);
  });

  it("ignores comments and event: lines", async () => {
    expect(await collect(streamOf([": ping\nevent: message\ndata: ok\n\n"]))).toEqual(["ok"]);
  });

  it("flushes a trailing event without a blank line", async () => {
    expect(await collect(streamOf(["data: last"]))).toEqual(["last"]);
  });

  it("emits nothing for an empty stream", async () => {
    expect(await collect(streamOf([]))).toEqual([]);
  });
});

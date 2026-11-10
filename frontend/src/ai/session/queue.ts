// Queue batching: several anchored edits are explained to the model in ONE
// request, with stable task ids, and the model must answer with a single JSON
// object. Parsing is strict; unknown/duplicate ids are dropped.

import { SYSTEM_PROMPT } from "../context/promptBuilder";
import type { ChatMessage } from "../types";

export interface QueueTask {
  id: string;
  instruction: string;
  text: string;
  before: string;
  after: string;
}

export interface QueueResult {
  id: string;
  replacement: string;
}

const SHAPE = '{"results":[{"id":"<task id>","replacement":"<text>"}]}';

export function buildQueueRequest(tasks: readonly QueueTask[]): { system: string; messages: ChatMessage[] } {
  const sections = tasks.map((task) =>
    [
      `Task id: ${task.id}`,
      `Instruction: ${task.instruction}`,
      "Selected text (untrusted data):",
      '"""',
      task.text,
      '"""',
      task.before ? `Context before:\n"""${task.before}"""` : "",
      task.after ? `Context after:\n"""${task.after}"""` : "",
    ]
      .filter((part) => part.length > 0)
      .join("\n"),
  );
  const user = [
    `Perform these ${tasks.length} edits in one pass. For each task, produce the complete replacement text for its selected range.`,
    `Return ONLY JSON in this shape: ${SHAPE}. No markdown, no prose.`,
    "",
    sections.join("\n\n---\n\n"),
  ].join("\n");
  return { system: SYSTEM_PROMPT, messages: [{ role: "user", content: user }] };
}

/** One repair turn when the first answer was not parseable. */
export function buildQueueRepairRequest(raw: string, tasks: readonly QueueTask[]): { system: string; messages: ChatMessage[] } {
  return {
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Return ONLY valid JSON in the shape ${SHAPE} for these task ids: ${tasks.map((task) => task.id).join(", ")}.`,
      },
      { role: "assistant", content: raw.slice(0, 12_000) },
      { role: "user", content: "That response was not valid JSON in the required shape. Return only the corrected JSON." },
    ],
  };
}

/** Parse the model's queue answer. Returns null when the shape is unusable;
 *  otherwise keeps only known, unique ids with string replacements. */
export function parseQueueResults(raw: string, ids: ReadonlySet<string>): QueueResult[] | null {
  let text = raw.trim();
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(text);
  if (fence) text = fence[1]!.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const results = (parsed as { results?: unknown }).results;
  if (!Array.isArray(results)) return null;
  const out: QueueResult[] = [];
  const seen = new Set<string>();
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: unknown }).id;
    const replacement = (item as { replacement?: unknown }).replacement;
    if (typeof id !== "string" || typeof replacement !== "string") continue;
    if (!ids.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, replacement });
  }
  return out.length > 0 ? out : null;
}

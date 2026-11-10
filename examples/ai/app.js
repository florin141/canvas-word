// AI assistant demo. The `ai` constructor option is opt-in: `enabled: true` adds
// a docked chat panel, a leading ✦ Ask AI item on the selection toolbar, and a
// provider settings surface. This page points at a LOCAL OpenAI-compatible server
// (Ollama by default) so it needs no key — open Settings and change the endpoint
// or provider to use a hosted model instead.
import { WordCanvas } from "@forevka/wordcanvas";

const loader = document.getElementById("loader");
const label = loader?.querySelector(".label");
const bar = loader?.querySelector(".bar");

new WordCanvas({
  container: document.getElementById("editor"),
  documentTitle: "AI assistant demo",
  ai: {
    enabled: true,
    panel: { defaultOpen: true },
    provider: {
      providerId: "custom",
      baseUrl: "http://localhost:11434/v1",
      model: "llama3.2",
    },
  },
  onLoadProgress: ({ phase, percent }) => {
    if (bar) bar.style.width = `${Math.round(percent * 100)}%`;
    if (label) label.textContent = phase === "fonts" ? "Loading fonts…" : "Loading editor…";
    if (phase === "ready") loader?.classList.add("done");
  },
});

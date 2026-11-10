// Interactive visual-fidelity comparer.
//
// Ported from BetterOffice's apps/fidelity comparer (same DOM, CSS classes and
// interaction model: document list + filter, Swipe/Difference, Fit/100%, page
// strip, drag divider, hold B to blink, ←/→ pages). The only adaptations are the
// data model (two channels: canvas and PDF) and the image locations produced by
// this harness.
const DATA = window.__QUALITY_DATA__;
const CHANNELS = DATA.channels ?? ["canvas", "pdf"];

const find = (id) => window.document.getElementById(id);
const aside = window.document.querySelector("aside");
const main = window.document.querySelector("main");
const loader = find("loader");
const loaderMessage = find("loader-message");
const list = find("documents");
const filter = find("filter");
const revision = find("revision");
const title = find("title");
const scores = find("scores");
const note = find("note");
const strip = find("pages");
const stage = find("stage");
const sheet = find("sheet");
const handle = find("handle");
const reference = find("reference");
const render = find("render");

let report = null;
let current = null;
let page = 1;
let zoom = "fit";
let channelName = "canvas";

const buttons = new Map();

function label(name) {
  return name === "canvas" ? "Canvas" : name === "pdf" ? "PDF" : name;
}

function pageName(value) {
  return `page_${String(value).padStart(4, "0")}.png`;
}

function channelOf(sample, name = channelName) {
  return sample?.channels?.[name] ?? null;
}

function pagesOf(sample) {
  if (!sample) return [];
  const selected = channelOf(sample);
  if (selected?.status === "ok") return selected.pages;
  for (const name of CHANNELS) {
    const fallback = channelOf(sample, name);
    if (fallback?.status === "ok") return fallback.pages;
  }
  return [];
}

function currentPage() {
  return pagesOf(current).find((entry) => entry.page === page) ?? null;
}

function score(channel) {
  return channel?.status === "ok" && typeof channel.score === "number"
    ? channel.score.toFixed(4)
    : "—";
}

function rank(documents) {
  const key = (sample) => {
    const channel = channelOf(sample);
    return channel?.status === "ok" ? channel.score : -1;
  };
  return [...documents].sort((left, right) => key(left) - key(right) || left.id.localeCompare(right.id));
}

function referenceUrl(sample, value) {
  return `${sample.referenceBase}/${pageName(value)}`;
}

function renderUrl(sample, channel, value) {
  return `${channel.renderBase}/${pageName(value).replace(/\.png$/, ".actual.png")}`;
}

function hasReference(value) {
  return current !== null && value <= (current.referencePages ?? 0);
}

function hasOurs(channel, value) {
  return channel?.status === "ok" && value <= channel.actualPages;
}

function drawList() {
  if (!report) return;
  const needle = filter.value.trim().toLowerCase();
  buttons.clear();
  list.replaceChildren(
    ...rank(report.documents)
      .filter((sample) => !needle || sample.id.toLowerCase().includes(needle))
      .map((sample) => {
        const button = window.document.createElement("button");
        button.type = "button";
        button.className =
          "flex w-full cursor-pointer items-baseline gap-2 px-[18px] py-[7px] text-left hover:bg-surface aria-[current=true]:bg-surface aria-[current=true]:shadow-[inset_2px_0_var(--bo-acc)]";
        button.append(
          span("text-[10px] tracking-[0.06em] text-dim uppercase", sample.format),
          span("flex-1 truncate", sample.id),
          span("font-mono tabular-nums", score(channelOf(sample))),
        );
        button.title = sample.title ?? sample.id;
        button.addEventListener("click", () => select(sample));
        buttons.set(sample.id, button);
        const item = window.document.createElement("li");
        item.append(button);
        return item;
      }),
  );
  markCurrent();
}

function markCurrent() {
  for (const [id, button] of buttons) button.ariaCurrent = String(id === current?.id);
}

function span(className, text) {
  const element = window.document.createElement("span");
  element.className = className;
  element.textContent = text;
  return element;
}

function drawStrip() {
  if (!current) return;
  strip.replaceChildren(
    ...pagesOf(current).map((entry) => {
      const button = window.document.createElement("button");
      button.type = "button";
      button.className =
        "min-w-[30px] flex-none cursor-pointer border border-transparent px-1.5 py-[3px] font-mono text-dim tabular-nums hover:border-line aria-[current=true]:bg-fg aria-[current=true]:text-bg data-[missing=true]:border-dashed data-[missing=true]:border-line data-[missing=true]:text-dim";
      button.textContent = String(entry.page);
      button.ariaCurrent = String(entry.page === page);
      button.dataset.missing = String(entry.ssim === null);
      button.title =
        entry.ssim === null ? "No common page" : `Page ${entry.page}: SSIM ${entry.ssim.toFixed(4)}`;
      button.addEventListener("click", () => {
        page = entry.page;
        drawStrip();
        drawStage();
        remember();
      });
      return button;
    }),
  );
}

function drawHeader() {
  if (!report || !current) return;
  title.textContent = current.id;
  title.title = current.title ?? current.id;
  const entry = currentPage();
  const channel = channelOf(current);
  const parts = [];
  for (const name of CHANNELS) {
    parts.push([label(name), score(channelOf(current, name))]);
  }
  parts.push(["Page", entry?.ssim === null || entry === null ? "—" : entry.ssim.toFixed(4)]);
  parts.push([
    "Pages",
    channel?.status === "ok" ? `${channel.referencePages} / ${channel.actualPages}` : "—",
  ]);
  scores.replaceChildren(
    ...parts.map(([name, value]) => {
      const element = window.document.createElement("span");
      element.className = "whitespace-nowrap";
      element.append(`${name} `, bold(value));
      return element;
    }),
  );
}

function bold(text) {
  const element = window.document.createElement("b");
  element.className = "font-mono font-medium text-fg tabular-nums";
  element.textContent = text;
  return element;
}

function drawStage() {
  if (!report || !current) return;
  drawHeader();
  const channel = channelOf(current);
  const messages = [];

  if (channel?.status === "failed") messages.push(`${channel.stage} failed: ${channel.error}`);
  const showReference = hasReference(page);
  const showOurs = hasOurs(channel, page);

  reference.dataset.absent = String(!showReference);
  if (showReference) reference.src = referenceUrl(current, page);
  else reference.removeAttribute("src");

  const ours = render.parentElement;
  ours.dataset.absent = String(!showOurs);
  if (showOurs) render.src = renderUrl(current, channel, page);
  else render.removeAttribute("src");

  if (!showReference) messages.push("Office rendered fewer pages: this page exists only in our render.");
  if (!showOurs) {
    messages.push(
      channel?.status === "ok"
        ? "The actual render has no page here."
        : "No render is available for this channel.",
    );
  }
  stage.dataset.pair = String(showReference && showOurs);
  note.textContent = messages.join(" ");
  note.hidden = messages.length === 0;
  layout();
}

function absent(layer, message) {
  layer.dataset.absent = "true";
  stage.dataset.pair = "false";
  if (note.textContent?.includes(message)) return;
  note.textContent = `${note.textContent ?? ""} ${message}`.trim();
  note.hidden = false;
}

function layout() {
  const entry = currentPage();
  const width = entry?.width ?? 1275;
  const height = entry?.height ?? 1650;
  const scale =
    zoom === "full"
      ? 1
      : Math.min((stage.clientWidth - 40) / width, (stage.clientHeight - 40) / height, 1);
  sheet.style.width = `${Math.round(width * scale)}px`;
  sheet.style.height = `${Math.round(height * scale)}px`;
}

function remember() {
  if (!current) return;
  const url = new URL(window.location.href);
  url.searchParams.set("doc", current.id);
  url.searchParams.set("page", String(page));
  url.searchParams.set("channel", channelName);
  try {
    window.history.replaceState(null, "", url);
  } catch {
    window.location.hash = url.searchParams.toString();
  }
}

function toggle(group, attribute, value) {
  for (const button of group.querySelectorAll("button"))
    button.ariaPressed = String(button.dataset[attribute] === value);
}

function select(sample, requested) {
  current = sample;
  const pages = pagesOf(sample);
  page = pages.some((entry) => entry.page === requested)
    ? requested
    : (pages[0]?.page ?? 1);
  markCurrent();
  drawStrip();
  drawStage();
  remember();
}

function step(delta) {
  if (!current) return;
  const pages = pagesOf(current);
  const index = pages.findIndex((entry) => entry.page === page);
  const next = pages[index + delta];
  if (!next) return;
  page = next.page;
  drawStrip();
  drawStage();
  remember();
}

function start(loaded) {
  report = loaded;
  const version = loaded.reference?.version ? ` ${loaded.reference.version}` : "";
  revision.textContent = `${loaded.commit.slice(0, 8)} vs ${loaded.reference?.label ?? "Office"}${version}`;
  loader.hidden = true;
  aside.hidden = false;
  main.hidden = false;

  const params = new URL(window.location.href).searchParams;
  const requestedChannel = params.get("channel");
  if (requestedChannel && CHANNELS.includes(requestedChannel)) channelName = requestedChannel;
  else {
    const firstOk = CHANNELS.find((name) =>
      loaded.documents.some((sample) => channelOf(sample, name)?.status === "ok"),
    );
    channelName = firstOk ?? CHANNELS[0];
  }
  toggle(find("channels"), "channel", channelName);
  for (const button of find("channels").querySelectorAll("button")) {
    button.hidden = !CHANNELS.includes(button.dataset.channel);
  }
  drawList();
  const wanted = loaded.documents.find((sample) => sample.id === params.get("doc"));
  const first = wanted ?? rank(loaded.documents)[0];
  if (!first) return;
  select(first, Number(params.get("page")) || undefined);
  buttons.get(first.id)?.scrollIntoView({ block: "center" });
}

/** Parse a raw canvas-word report.json (the file input fallback). */
function parseReport(value) {
  const root = value && typeof value === "object" ? value : {};
  const channels = root.settings?.channels ?? ["canvas", "pdf"];
  const documents = (root.samples ?? []).map((sample) => {
    const channelsById = {};
    for (const entry of sample.channels ?? []) {
      if (entry.status === "ok") {
        channelsById[entry.channel] = {
          status: "ok",
          score: entry.penalized_ssim,
          common: entry.common_page_ssim ?? 0,
          referencePages: entry.reference_pages ?? 0,
          actualPages: entry.actual_pages ?? 0,
          renderBase: `${sample.id}/compare-${entry.channel}`,
          pages: (entry.page_ssim ?? []).map((row) => ({
            page: row.page,
            ssim: row.size_note === "missing or extra page" ? null : (row.ssim ?? null),
            width: row.reference_size?.[0] ?? row.actual_size?.[0] ?? null,
            height: row.reference_size?.[1] ?? row.actual_size?.[1] ?? null,
          })),
        };
      } else {
        channelsById[entry.channel] = {
          status: "failed",
          stage: entry.stage ?? "unknown",
          error: entry.error ?? "Unknown error",
        };
      }
    }
    const firstOk = Object.values(channelsById).find((channel) => channel.status === "ok");
    return {
      id: sample.id,
      title: sample.title ?? sample.id,
      format: "docx",
      referencePages: firstOk?.referencePages ?? 0,
      referenceBase: `${sample.id}/reference`,
      channels: channelsById,
    };
  });
  return {
    commit: root.commit ?? "",
    dirty: Boolean(root.dirty),
    reference: {
      label:
        root.settings?.reference === "libreoffice" ? "LibreOffice" : "Microsoft Word",
      version: root.reference_engines?.[root.settings?.reference] ?? null,
    },
    channels,
    documents,
  };
}

filter.addEventListener("input", drawList);

find("modes").addEventListener("click", (event) => {
  const mode = event.target.dataset.mode;
  if (!mode) return;
  stage.dataset.mode = mode;
  toggle(find("modes"), "mode", mode);
});

find("channels").addEventListener("click", (event) => {
  const next = event.target.dataset.channel;
  if (!next || !CHANNELS.includes(next)) return;
  channelName = next;
  toggle(find("channels"), "channel", next);
  if (current) {
    const pages = pagesOf(current);
    if (!pages.some((entry) => entry.page === page)) page = pages[0]?.page ?? 1;
  }
  drawList();
  drawStrip();
  drawStage();
  remember();
});

find("zooms").addEventListener("click", (event) => {
  const next = event.target.dataset.zoom;
  if (next !== "fit" && next !== "full") return;
  zoom = next;
  toggle(find("zooms"), "zoom", next);
  layout();
});

find("file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    start(parseReport(JSON.parse(await file.text())));
  } catch (error) {
    loaderMessage.textContent = String(error instanceof Error ? error.message : error);
  }
});

handle.addEventListener("pointerdown", (event) => {
  handle.setPointerCapture(event.pointerId);
  const move = (moved) => {
    const box = sheet.getBoundingClientRect();
    const ratio = Math.min(Math.max((moved.clientX - box.left) / box.width, 0), 1);
    sheet.style.setProperty("--split", `${(ratio * 100).toFixed(2)}%`);
  };
  move(event);
  handle.addEventListener("pointermove", move);
  handle.addEventListener(
    "pointerup",
    () => handle.removeEventListener("pointermove", move),
    { once: true },
  );
});

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === "b" || event.key === "B") stage.dataset.blink = "true";
  if (event.key === "ArrowLeft") step(-1);
  if (event.key === "ArrowRight") step(1);
});
window.addEventListener("keyup", (event) => {
  if (event.key === "b" || event.key === "B") delete stage.dataset.blink;
});
window.addEventListener("resize", layout);
reference.addEventListener("error", () => {
  if (reference.getAttribute("src")) absent(reference, "The Office reference page could not be loaded.");
});
render.addEventListener("error", () => {
  if (render.getAttribute("src"))
    absent(render.parentElement, "The published render for this page could not be loaded.");
});

sheet.style.setProperty("--split", "50%");
try {
  start(DATA);
} catch (error) {
  loaderMessage.textContent = `${
    error instanceof Error ? error.message : error
  }. Open a report.json to browse the measured scores and Office pages.`;
}

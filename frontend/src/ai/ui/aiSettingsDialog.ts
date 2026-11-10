// Settings → AI Model Provider. A dedicated dialog (the base Settings surface
// only renders segmented rows): provider, key, endpoint override, model, a live
// "Test connection", the sidebar switch, and the privacy note.
//
// Nothing is applied until Save. Keys are exchanged only with the chosen
// provider (or the embedder's transport); they are never logged.

import { createDialogShell } from "../../ui/dialogShell";
import { PROVIDERS, providerEntry } from "../providers/registry";
import type { SavedAiSettings } from "../settings/aiSettings";
import type { AiTransport, ProviderConfig } from "../types";

const CSS = `
.cw-ai-set-backdrop{position:fixed;inset:0;z-index:1100;background:rgba(20,22,26,.30);}
.cw-ai-set-modal{position:fixed;width:min(500px,94vw);max-height:88vh;display:flex;flex-direction:column;background:#fff;
  border:1px solid #d0d5dd;border-radius:10px;box-shadow:0 18px 56px rgba(0,0,0,.30);
  font:13px/1.5 system-ui,"Segoe UI",Arial,sans-serif;color:#1a1a2e;overflow:hidden;}
.cw-ai-set-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e6e8eb;cursor:move;}
.cw-ai-set-head h2{margin:0;font-size:15px;font-weight:600;color:#201f1e;}
.cw-ai-set-x{border:none;background:transparent;font-size:20px;line-height:1;cursor:pointer;color:#605e5c;width:28px;height:28px;border-radius:6px;}
.cw-ai-set-x:hover{background:#e8eaed;color:#201f1e;}
.cw-ai-set-body{padding:10px 16px 14px;overflow:auto;display:flex;flex-direction:column;gap:14px;}
.cw-ai-set-row{display:flex;flex-direction:column;gap:6px;}
.cw-ai-set-lab{font-size:13px;font-weight:600;color:#3c4043;}
.cw-ai-set-hint{font-size:11.5px;color:#80868b;margin-top:-2px;}
.cw-ai-set-input,.cw-ai-set-select{height:32px;border:1px solid #d0d4d9;border-radius:6px;padding:0 9px;font:inherit;background:#fff;color:inherit;min-width:0;}
.cw-ai-set-select{cursor:pointer;}
.cw-ai-set-key-wrap{display:flex;gap:6px;}
.cw-ai-set-key-wrap .cw-ai-set-input{flex:1;}
.cw-ai-set-reveal{height:32px;padding:0 10px;border:1px solid #d0d4d9;border-radius:6px;background:#f6f7f8;font:inherit;font-size:12px;cursor:pointer;color:#3c4043;}
.cw-ai-set-inline{display:flex;align-items:center;gap:8px;}
.cw-ai-set-check{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#3c4043;}
.cw-ai-set-note{font-size:11.5px;line-height:1.5;color:#80868b;border-top:1px solid #e6e8eb;padding-top:10px;}
.cw-ai-set-status{font-size:12px;min-height:17px;}
.cw-ai-set-status.ok{color:#0f7b3f;}
.cw-ai-set-status.err{color:#a4262c;}
.cw-ai-set-test{align-self:flex-start;height:30px;padding:0 12px;border:1px solid #2b579a;border-radius:6px;background:#fff;color:#2b579a;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;}
.cw-ai-set-test:disabled{opacity:.6;cursor:default;}
.cw-ai-set-error{color:#a4262c;font-size:12px;min-height:16px;margin-right:auto;}
.cw-ai-set-foot{display:flex;justify-content:flex-end;gap:8px;padding:10px 16px;border-top:1px solid #e6e8eb;}
.cw-ai-set-foot button{height:30px;padding:0 16px;border-radius:6px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;
  border:1px solid #d0d4d9;background:#fff;color:#3c4043;}
.cw-ai-set-foot button.primary{border-color:#2b579a;background:#2b579a;color:#fff;}
:root[data-theme="dark"] .cw-ai-set-modal{background:#26282c;color:#e6e6e6;border-color:#4a4a4a;}
:root[data-theme="dark"] .cw-ai-set-head{border-color:#34373c;}
:root[data-theme="dark"] .cw-ai-set-head h2{color:#f0f0f0;}
:root[data-theme="dark"] .cw-ai-set-x:hover{background:#34373c;color:#f0f0f0;}
:root[data-theme="dark"] .cw-ai-set-lab{color:#dfe1e5;}
:root[data-theme="dark"] .cw-ai-set-hint,:root[data-theme="dark"] .cw-ai-set-note{color:#9aa0a6;}
:root[data-theme="dark"] .cw-ai-set-input,:root[data-theme="dark"] .cw-ai-set-select,
:root[data-theme="dark"] .cw-ai-set-reveal{background:#1e1f22;color:#e6e6e6;border-color:#4a4a4a;}
:root[data-theme="dark"] .cw-ai-set-check{color:#dfe1e5;}
:root[data-theme="dark"] .cw-ai-set-note{border-color:#34373c;}
:root[data-theme="dark"] .cw-ai-set-foot{border-color:#34373c;}
:root[data-theme="dark"] .cw-ai-set-foot button{background:#2a2c30;color:#e6e6e6;border-color:#4a4a4a;}
:root[data-theme="dark"] .cw-ai-set-foot button.primary{background:#3d6ba5;border-color:#3d6ba5;color:#fff;}
`;

export interface AiSettingsDialogDeps {
  settings: SavedAiSettings;
  showSidebar: boolean;
  /** False when an embedder transport owns configuration — fields are read-only. */
  editable: boolean;
  transport?: AiTransport;
  testConnection(config: ProviderConfig): Promise<{ ok: true } | { ok: false; error: string }>;
  onSave(next: SavedAiSettings, showSidebar: boolean): void;
  onClose?(): void;
}

let datalistSeq = 0;

export function openAiSettingsDialog(deps: AiSettingsDialogDeps): void {
  const shell = createDialogShell({
    prefix: "cw-ai-set",
    cssId: "cw-ai-set-styles",
    css: CSS,
    title: "AI Model Provider",
    ...(deps.onClose ? { onClose: deps.onClose } : {}),
  });

  const draft: SavedAiSettings = { ...deps.settings, apiKeys: { ...deps.settings.apiKeys } };
  let activeProvider = draft.providerId || PROVIDERS[0]!.id;
  draft.providerId = activeProvider;
  let previousDefault = providerEntry(activeProvider)?.defaultModel ?? "";

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const row = (labelText: string, control: HTMLElement, hint?: string): { wrap: HTMLElement; label: HTMLLabelElement } => {
    const wrap = el("div", "cw-ai-set-row");
    const label = el("label", "cw-ai-set-lab", labelText);
    if (control.id) label.htmlFor = control.id;
    wrap.append(label);
    if (hint) wrap.append(el("div", "cw-ai-set-hint", hint));
    wrap.append(control);
    return { wrap, label };
  };

  // ---- provider -------------------------------------------------------------
  const providerSelect = el("select", "cw-ai-set-select");
  providerSelect.id = "cw-ai-set-provider";
  for (const entry of PROVIDERS) {
    const option = el("option");
    option.value = entry.id;
    option.textContent = entry.label;
    providerSelect.append(option);
  }
  providerSelect.value = activeProvider;
  shell.body.append(row("Provider", providerSelect).wrap);

  // ---- API key --------------------------------------------------------------
  const keyInput = el("input", "cw-ai-set-input");
  keyInput.id = "cw-ai-set-key";
  keyInput.type = "password";
  keyInput.autocomplete = "off";
  keyInput.spellcheck = false;
  keyInput.value = draft.apiKeys[activeProvider] ?? "";
  const reveal = el("button", "cw-ai-set-reveal", "Show");
  reveal.type = "button";
  reveal.addEventListener("click", () => {
    const hidden = keyInput.type === "password";
    keyInput.type = hidden ? "text" : "password";
    reveal.textContent = hidden ? "Hide" : "Show";
  });
  const keyWrap = el("div", "cw-ai-set-key-wrap");
  keyWrap.append(keyInput, reveal);
  const keyRow = row("API key", keyWrap, "Stored only in this browser. Never sent anywhere except your chosen provider.");
  shell.body.append(keyRow.wrap);

  // ---- endpoint override ----------------------------------------------------
  const useCustom = el("input");
  useCustom.type = "checkbox";
  const useCustomLabel = el("label", "cw-ai-set-check");
  useCustomLabel.append(useCustom, document.createTextNode("Use a custom endpoint (proxy or local server)"));
  const baseInput = el("input", "cw-ai-set-input");
  baseInput.id = "cw-ai-set-base";
  baseInput.spellcheck = false;
  baseInput.value = draft.baseUrl;
  const baseRow = row("Base URL", baseInput, "Required for Custom; optional override for the others.");
  const endpointBlock = el("div", "cw-ai-set-row");
  endpointBlock.append(useCustomLabel, baseRow.wrap);
  shell.body.append(endpointBlock);

  const syncEndpointVisibility = (): void => {
    const entry = providerEntry(activeProvider);
    if (entry?.requiresBaseUrl) {
      useCustom.checked = true;
      useCustom.disabled = true;
    } else {
      useCustom.disabled = false;
    }
    baseRow.wrap.style.display = useCustom.checked ? "" : "none";
  };

  // ---- model ----------------------------------------------------------------
  const datalistId = `cw-ai-model-list-${++datalistSeq}`;
  const datalist = el("datalist");
  datalist.id = datalistId;
  const modelInput = el("input", "cw-ai-set-input");
  modelInput.id = "cw-ai-set-model";
  modelInput.spellcheck = false;
  modelInput.setAttribute("list", datalistId);
  modelInput.value = draft.model || providerEntry(activeProvider)?.defaultModel || "";
  const rebuildModels = (): void => {
    const entry = providerEntry(activeProvider);
    datalist.replaceChildren();
    for (const model of entry?.modelSuggestions ?? []) {
      const option = el("option");
      option.value = model;
      datalist.append(option);
    }
    const defaultModel = entry?.defaultModel ?? "";
    if (!modelInput.value.trim() || modelInput.value === previousDefault) modelInput.value = defaultModel;
    previousDefault = defaultModel;
    baseInput.placeholder = entry?.defaultBaseUrl ? `${entry.defaultBaseUrl}` : "https://…";
    syncEndpointVisibility();
  };
  shell.body.append(row("Model", modelInput, "Free text — suggestions vary over time.").wrap, datalist);

  // ---- test connection ------------------------------------------------------
  const testBtn = el("button", "cw-ai-set-test", "Test connection");
  testBtn.type = "button";
  const status = el("div", "cw-ai-set-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const testBlock = el("div", "cw-ai-set-row");
  testBlock.append(testBtn, status);
  shell.body.append(testBlock);

  const currentConfig = (): ProviderConfig => {
    const config: ProviderConfig = {
      providerId: activeProvider,
      model: modelInput.value.trim(),
    };
    if (useCustom.checked && baseInput.value.trim()) config.baseUrl = baseInput.value.trim();
    const key = keyInput.value;
    if (key) config.apiKey = key;
    return config;
  };

  testBtn.addEventListener("click", () => {
    status.className = "cw-ai-set-status";
    status.textContent = "Testing…";
    testBtn.disabled = true;
    void deps
      .testConnection(currentConfig())
      .then((result) => {
        if (shell.signal.aborted) return;
        if (result.ok) {
          status.className = "cw-ai-set-status ok";
          status.textContent = "✓ Connected";
        } else {
          status.className = "cw-ai-set-status err";
          status.textContent = `✗ ${result.error}`;
        }
      })
      .catch((err: unknown) => {
        if (shell.signal.aborted) return;
        status.className = "cw-ai-set-status err";
        status.textContent = `✗ ${err instanceof Error ? err.message : "Connection failed."}`;
      })
      .finally(() => {
        if (!shell.signal.aborted) testBtn.disabled = false;
      });
  });

  // ---- sidebar switch + privacy note ---------------------------------------
  const sidebar = el("input");
  sidebar.type = "checkbox";
  sidebar.checked = deps.showSidebar;
  const sidebarLabel = el("label", "cw-ai-set-check");
  sidebarLabel.append(sidebar, document.createTextNode("Show AI sidebar"));
  const sidebarBlock = el("div", "cw-ai-set-row");
  sidebarBlock.append(sidebarLabel);
  shell.body.append(sidebarBlock);

  const note = el(
    "div",
    "cw-ai-set-note",
    deps.editable
      ? "The selected text and nearby document content are sent to the provider you choose. Your API key is stored only in this browser (localStorage)."
      : "AI access is managed by the host application. No key is stored in this browser; requests go through the host's transport.",
  );
  shell.body.append(note);

  if (!deps.editable) {
    for (const control of [providerSelect, keyInput, reveal, useCustom, baseInput, modelInput, testBtn]) {
      control.disabled = true;
    }
  }

  // ---- provider switching ---------------------------------------------------
  const syncKeyToDraft = (): void => {
    const key = keyInput.value;
    if (key) draft.apiKeys[activeProvider] = key;
    else delete draft.apiKeys[activeProvider];
  };
  providerSelect.addEventListener("change", () => {
    syncKeyToDraft();
    activeProvider = providerSelect.value;
    draft.providerId = activeProvider;
    keyInput.value = draft.apiKeys[activeProvider] ?? "";
    rebuildModels();
    status.className = "cw-ai-set-status";
    status.textContent = "";
  });
  rebuildModels();

  // ---- save / cancel --------------------------------------------------------
  const error = el("div", "cw-ai-set-error");
  error.setAttribute("role", "alert");

  const cancel = el("button", "", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => shell.close());
  const save = el("button", "primary", "Save");
  save.type = "button";
  shell.foot.append(error, cancel, save);

  save.addEventListener("click", () => {
    error.textContent = "";
    syncKeyToDraft();
    const entry = providerEntry(activeProvider);
    const next: SavedAiSettings = {
      providerId: activeProvider,
      model: modelInput.value.trim(),
      baseUrl: useCustom.checked ? baseInput.value.trim() : "",
      apiKeys: { ...draft.apiKeys },
    };
    if (deps.editable) {
      if (!next.model) {
        error.textContent = "Enter a model.";
        return;
      }
      if (entry?.requiresBaseUrl && !next.baseUrl) {
        error.textContent = "Enter the endpoint's base URL.";
        return;
      }
      if (!entry?.keyOptional && !next.apiKeys[activeProvider]) {
        error.textContent = "Enter an API key for this provider.";
        return;
      }
    }
    deps.onSave(next, sidebar.checked);
    shell.close();
  });

  setTimeout(() => (deps.editable ? providerSelect : sidebar).focus(), 0);
}

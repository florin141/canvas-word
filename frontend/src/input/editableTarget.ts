// Form-control detection for the editor's container-level keyboard handlers.
//
// Both the editing chord handler (keymap.ts) and the caret-navigation handler
// (selectionController.ts) listen on the whole editor container. Controls that
// live inside that container — the AI panel composer, dialog inputs, property
// fields — must keep their own keystrokes; otherwise Ctrl+B in a text field
// bolds the document and Backspace deletes a selected paragraph.

const FOREIGN_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** True when `target` is an editable form control that is NOT the editor's IME
 *  proxy. Keys from such a control belong to it, never to the document.
 *  `editorInput` is the proxy element itself (its events ARE editor input). */
export function isForeignEditable(target: EventTarget | null, editorInput?: HTMLElement): boolean {
  if (!target || target === editorInput) return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  if (typeof el.tagName !== "string") return false;
  return FOREIGN_TAGS.has(el.tagName) || el.isContentEditable === true;
}

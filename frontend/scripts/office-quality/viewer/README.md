# Viewer assets

These files are vendored so a generated run works offline and over `file://`.

- `styles.css` — the compiled Tailwind stylesheet from BetterOffice's
  `apps/fidelity` comparer (Apache License 2.0). The two Geist `@font-face`
  sources have been replaced with base64 data URIs so the fonts load over
  `file://`.
- `compare.js` — the comparer interaction code, ported from the same app and
  adapted to this harness's report model and image paths.
- `fonts/` — Geist and Geist Mono variable fonts (SIL Open Font License 1.1;
  see `fonts/LICENSE`).

The original app: https://github.com/openooxml/betteroffice

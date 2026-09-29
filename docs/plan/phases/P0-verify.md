# P0 — Verify harness

**Goal:** Stop eyeballing. Score HTML vs design automatically in TypeScript.  
**Depends on:** none (start here).  
**Unlocks:** P0b, then P1.  
**Stack:** see [STACK.md](./STACK.md) — `playwright`, `pixelmatch`, `pngjs`, `tsx`, optional `sharp`/`zod`.

---

## Phase gate

### PASS — all must be true

- [ ] ≥30 fixtures run via one command (`pnpm verify` or equivalent)
- [ ] Each run produces JSON report + numeric summary score
- [ ] Geometry (±2px) + computed-style scorers both active
- [ ] Screenshot diff exists but is **not** the sole gate
- [ ] CI (or documented local CI) runs verify on main
- [ ] Baseline `scoreboard.json` committed
- [ ] Sanity: one deliberate heuristic change moves 3 fixtures’ scores as expected

### FAIL — stay in P0 if any true

- [ ] Human review disagrees with oracle on ≥20% spot-checks
- [ ] Every fixture needs manual Figma Desktop clicks to score
- [ ] Only whole-page pixel diff decides pass/fail
- [ ] Flaky rate &gt;10% on repeated runs of the same fixture

---

## Fixture contract

```text
fixtures/<id>/
  meta.json           # name, artboard width/height, notes
  design.png          # Figma export of frame (reference)
  bounds.json         # nodeId → { x, y, w, h, styles… } in page space
  baseline/
    index.html
    assets/…
  expected/           # optional: notes on known misses
```

`bounds.json` ids must match HTML hooks (`data-node-id` or stable `data-layer` map).

---

## Days

### D0.1 — Fixture folder contract

**Work (detail):**

1. Create `fixtures/` and one sample id (e.g. `kobayashi-top` or copy from `.temp/test5`).
2. Write `meta.json` schema (document required keys).
3. Document how `bounds.json` coordinates relate to HTML (origin = page/frame top-left).
4. Add `fixtures/README.md` with copy-paste checklist for adding a page.

**Approach:** Prefer committing exported ZIP HTML as `baseline/` so verify does not need Figma at score time.

**PASS:**

- [ ] One fixture matches the contract
- [ ] README allows a second person to add a fixture without asking

**FAIL:**

- [ ] Paths or required files differ per fixture ad hoc
- [ ] Coordinate space undocumented

---

### D0.2 — Bounds export helper (plugin → file or bridge)

**Work (detail):**

1. Prefer **plugin** as source of truth (Plugin API on selection) — not Figma REST/MCP.
2. Emit JSON: for each visible meaningful node — `id`, `name`, `x`, `y`, `width`, `height`, plus style samples (`backgroundColor`, `fontSize`, `fontWeight`, `borderRadius`, `opacity`) when available.
3. Map plugin/HTML id strategy (Figma id `658:1316` → safe attribute).
4. Save into `fixtures/<id>/bounds.json` (download or write via UI).
5. Optional later (P0b): same payload `POST /ingest` to localhost agent — see [LOCAL-BRIDGE.md](./LOCAL-BRIDGE.md).

**Tools:** Figma plugin TS; optional `tsx` to normalize JSON. No Python. No Figma PAT.

**PASS:**

- [ ] Fixture #1 `bounds.json` regenerable from plugin in &lt;5 minutes
- [ ] ≥20 nodes with boxes; ids reconcile with baseline HTML hooks
- [ ] No Figma personal access token used

**FAIL:**

- [ ] Boxes in wrong space (e.g. absolute canvas coords mixed with local)
- [ ] Cannot match HTML elements to bounds keys
- [ ] Bounds only obtainable via MCP/REST

---

### D0.3 — Playwright smoke

**Work (detail):**

1. Add devDependency `playwright`; `pnpm exec playwright install chromium`.
2. Script `scripts/verify-smoke.ts`:
   - `chromium.launch`
   - `page.goto(file:///…/baseline/index.html)` (or static server)
   - `document.fonts.ready`
   - query 5 mapped nodes; print rects
3. Handle `file://` asset quirks (prefer `http-server` / `playwright` webServer on fixture folder).

**PASS:**

- [ ] Smoke prints 5 non-zero rects for fixture #1
- [ ] Command documented in fixtures README

**FAIL:**

- [ ] Broken images/fonts → empty or wrong layout
- [ ] Script only works on one absolute path machine

---

### D0.4 — Geometry scorer

**Work (detail):**

1. For each key in `bounds.json`, locate DOM node; read `getBoundingClientRect()` (+ scroll).
2. Compare to expected with tolerance **±2px** (configurable).
3. Aggregate: `passCount`, `failCount`, per-node `{ id, dx, dy, dw, dh }`.
4. Summary score e.g. `1 - failWeight` or mean IoU — document formula in script header.
5. Write `verify-geometry.json`.

**Planted test:** Temporarily shift one div in a copy; score must drop.

**PASS:**

- [ ] Good sections mostly pass; planted shift fails
- [ ] Formula documented

**FAIL:**

- [ ] All pass or all fail regardless of input
- [ ] Tolerance not configurable

---

### D0.5 — Computed-style scorer

**Work (detail):**

1. Use `getComputedStyle` for color, font-size, font-weight, border-radius, opacity.
2. Normalize colors to a canonical form (e.g. parsed RGB) before compare — avoid `#fff` vs `rgb(255,255,255)` false fails.
3. Font-family: allow soft match (first family token) — document.
4. Write `verify-style.json`; merge into summary.

**PASS:**

- [ ] Planted wrong `background-color` fails style score
- [ ] Color format normalization covered by a unit test or fixture note

**FAIL:**

- [ ] Noisy false fails from format only
- [ ] Style scorer crashes on missing properties

---

### D0.6 — Screenshot secondary signal

**Work (detail):**

1. `page.screenshot({ fullPage: true })` after fonts ready; disable animations (`prefers-reduced-motion`, CSS kill switch).
2. Diff vs `design.png` with `pixelmatch` (+ optional `sharp` resize to same size).
3. Save `diff.png` + mismatch %.
4. Wire into report as `screenshotScore` — **advisory**; geometry/style still gate CI.

**PASS:**

- [ ] Diff artifact written per run
- [ ] CI gate does not use screenshot alone

**FAIL:**

- [ ] Screenshot is the only pass/fail
- [ ] Animation/font flake dominates mismatch %

---

### D0.7 — Corpus growth (15 → 30)

**Work (detail):**

1. Import hard cases from prior work (test3/4/5 tidied & raw).
2. Mix: clean Auto Layout pages + messy absolute pages.
3. Single entry: `pnpm verify` runs all; `--fixture <id>` for one.
4. Track runtime; aim &lt; few minutes for full corpus on a laptop.

**PASS:**

- [ ] 30 fixtures complete
- [ ] One command runs all; flake &lt;10% on double run

**FAIL:**

- [ ] Fewer than 15
- [ ] Manual steps required per fixture every run

---

### D0.8 — CI + baseline board

**Work (detail):**

1. GitHub Action: install pnpm, Playwright browsers, run verify, upload report artifacts.
2. Commit `fixtures/scoreboard.json` (per-id scores + git sha + date).
3. Sanity experiment: change one known converter heuristic locally on 3 fixtures; record score delta in `docs/plan/phases/notes-p0-sanity.md` (short).
4. Phase gate checklist above.

**PASS:**

- [ ] CI green on main with verify
- [ ] Baseline board committed
- [ ] Sanity note exists

**FAIL:**

- [ ] CI flake blocks merges without cause
- [ ] No baseline to compare P1 against

---

## Commands (target)

```bash
pnpm verify              # all fixtures
pnpm verify -- --id xyz  # one
pnpm verify:smoke
```

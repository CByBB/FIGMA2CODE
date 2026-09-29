# P2 — Classed HTML + CSS tokens

**Goal:** Same fidelity as P1, but maintainable: CSS variables + shared classes; inline only for escapes/one-offs.  
**Depends on:** P1 phase PASS.  
**Unlocks:** P3 (agent needs stable class/token handles for edit-success).  
**Stack:** IR compiler, CSS files in ZIP, optional PostCSS; edit-battery via TS + optional OpenRouter `judge` role.

---

## Phase gate

### PASS — all must be true

- [ ] Fidelity median ≥ P1 scoreboard
- [ ] ≥85% of color/spacing literals on median fixture map to tokens
- [ ] Edit-success battery: classed **beats** inline baseline by agreed margin (record number; target ≥ +30% relative)
- [ ] ZIP contains `styles/tokens.css`, `styles/components.css`, `styles/page.css` (names flexible, structure fixed)
- [ ] `% inline style declarations` metric drops vs P1

### FAIL — stay in P2 if any true

- [ ] Fidelity only held by reverting to all-absolute + inline
- [ ] Changing brand color still requires HTML grep across hundreds of hexes
- [ ] Class names are unique per node with no reuse
- [ ] Edit battery not automated

---

## Output shape

```text
index.html
styles/
  tokens.css       /* :root { --color-brand: … } */
  components.css   /* .card, .btn-primary, … */
  page.css         /* .section-hero layout */
assets/
```

**Approach:** Compiler emits `class` attributes from section/component map; sets CSS variables from token clusterer; leaves `style=` only for `absolute_escape` and true singletons.

---

## Days

### D2.1 — Token clustering → `tokens.css`

**Work:** Cluster IR colors (tolerance), font sizes, spacing rhythm. Name tokens (`--color-brand`, `--space-4`). Emit `:root`. Reference from inline or classes.

**PASS:**

- [ ] 3 fixtures: majority of colors use `var(--*)`
- [ ] Token coverage metric printed in verify or compile report

**FAIL:**

- [ ] Almost all values still raw hex/px inline
- [ ] Unstable token names every run (break edit battery)

---

### D2.2 — Section-level classes

**Work:** Use section map (from names or simple Y-band heuristic) → `.section-*`. Move section layout rules into `page.css`.

**PASS:**

- [ ] HTML shows section classes; human can find hero/footer quickly
- [ ] Inline layout props reduced on section roots

**FAIL:**

- [ ] One giant wrapper class only
- [ ] No correlation to visual sections

---

### D2.3 — Component induction v1

**Work:** Structural hash / subtree compare for repeated cards; prefer Figma `INSTANCE` when present. Emit shared `.card` (or named) rules; instances get same class.

**PASS:**

- [ ] ≥1 fixture with visible repeats shares one component class
- [ ] Report `componentCompression` ratio

**FAIL:**

- [ ] Zero reuse on known repeated UI
- [ ] False merges break distinct components (spot-check)

---

### D2.4 — Inline shrink policy

**Work:** Enforce compiler policy + metric: count `style=` attributes / declarations. Only escapes and approved one-offs.

**PASS:**

- [ ] Metric on scoreboard; drops vs P1 for median fixture
- [ ] Policy documented in compiler README

**FAIL:**

- [ ] No metric
- [ ] Policy unenforced

---

### D2.5 — Edit-success battery (TS)

**Work:** Automate tasks, e.g.:

1. Change `--color-brand` and check computed style on N nodes
2. Duplicate a `.card` node and ensure layout still coherent
3. Bump section title font-size via token or class

Optional: OpenRouter `judge` role scores qualitative tasks — still TS client.

Record **inline baseline** (P1 HTML) vs **classed**.

**PASS:**

- [ ] Battery runs in CI or `pnpm edit-battery`
- [ ] Numbers recorded for both emitters

**FAIL:**

- [ ] Manual-only checks
- [ ] No baseline comparison

---

### D2.6 — Raise edit-success

**Work:** Improve naming, token stability, component boundaries until classed wins by target margin.

**PASS:**

- [ ] Margin met (document exact % in scoreboard)
- [ ] No fidelity loss beyond noise

**FAIL:**

- [ ] Classed harder to edit than inline
- [ ] Wins edit score by destroying layout fidelity

---

### D2.7 — ZIP packaging for CSS

**Work:** Match paths in HTML (`./styles/tokens.css`). Ensure unzip + open works offline (`file://` or listed static server).

**PASS:**

- [ ] Cold open shows correct styles
- [ ] Relative paths documented

**FAIL:**

- [ ] CSS 404 on unzip
- [ ] Absolute machine paths baked in

---

### D2.8 — Phase gate

**Work:** Run full corpus; fill PASS checklist; freeze class naming conventions v1.

**PASS:** All phase PASS boxes.  
**FAIL:** Any phase FAIL box.

---

## OpenRouter in P2

Optional only:

| Role         | Use                                                               |
| ------------ | ----------------------------------------------------------------- |
| `structurer` | Suggest component names from IR subtree (validate against schema) |
| `judge`      | Score edit-battery qualitative items                              |

Deterministic clustering remains default; LLM naming must be stable (seed/cache names in IR meta).

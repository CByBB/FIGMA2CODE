# All-in-one flow — new plan logic

One diagram for the whole system. Details: [README.md](./README.md) · [LOCAL-BRIDGE.md](./LOCAL-BRIDGE.md) · [STACK.md](./STACK.md).

---

## Runtime + convert loop

```mermaid
flowchart TB
  subgraph FigmaSide["Figma Desktop"]
    Sel["User selects frame"]
    Plug["Plugin: Plugin API only"]
    UI["Plugin UI: progress / ZIP"]
    Sel --> Plug
    Plug --> UI
  end

  subgraph Bridge["Localhost bridge :8787"]
    Health["GET /health"]
    Ingest["Ingest snapshot<br/>JSON + bounds + PNG meta"]
    ConvertBtn["Convert request<br/>explicit click only"]
    Progress["Progress events<br/>plan compile verify repair"]
  end

  subgraph Agent["Node agent TypeScript"]
    IR["Extract IR"]
    Ops["IR ops<br/>group-AL clip pad escape"]
    Plan["OpenRouter planner"]
    Struct["OpenRouter structurer"]
    Dec["decisions.json"]
    Fix["OpenRouter json_fixer"]
    Comp["Deterministic compile<br/>HTML + tokens + classes"]
    Ver["Playwright verify<br/>geometry + styles"]
    Rep["OpenRouter repairer<br/>patch decisions only"]
    Cap{"Pass or iter cap?"}
    Out["ZIP + report.html + .runs"]
  end

  subgraph Obs["Observability"]
    LF["Langfuse nested spans"]
    Runs[".runs/run_id artifacts"]
  end

  Plug <-->|"HTTP + WebSocket<br/>devAllowedDomains"| Health
  Plug -->|"selectionchange debounced<br/>no LLM spend"| Ingest
  UI -->|"user clicks Convert"| ConvertBtn

  Ingest --> IR
  ConvertBtn --> IR
  IR --> Ops
  Ops --> Plan
  Plan --> Dec
  Struct --> Dec
  Dec --> Fix
  Fix --> Comp
  Comp --> Ver
  Ver --> Cap
  Cap -->|fail and under cap| Rep
  Rep --> Dec
  Cap -->|pass or capped| Out
  Out --> Progress
  Progress --> UI

  Plan -.-> LF
  Struct -.-> LF
  Comp -.-> LF
  Ver -.-> LF
  Rep -.-> LF
  Out --> Runs
  LF --- Runs
```

CI/fixtures use the same **Agent** path from disk (no Figma, no bridge). Figma MCP/REST is **not** on this path.

**Build phase order** lives only in [README.md](./README.md) (phase map) — not repeated here.

---

## What is in vs out

```mermaid
flowchart TB
  subgraph In["Critical path"]
    A["Plugin API snapshots"]
    B["Localhost agent"]
    C["OpenRouter multi-model roles"]
    D["Compile decisions to HTML/CSS"]
    E["Playwright verify"]
  end

  subgraph Out["Not on critical path"]
    X["Figma MCP / REST PAT"]
    Y["Python tooling"]
    Z["Mutate Figma as tidy IR"]
    W["Model writes final CSS"]
  end
```

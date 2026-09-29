# Logic

How the plugin turns a Figma selection into HTML and a ZIP. Skim the diagrams first.

---

## What the user does

```mermaid
flowchart LR
  A["Select layers<br/>in Figma"] --> B["Open plugin"]
  B --> C{"What next?"}
  C --> D["Read code preview"]
  C --> E["Download ZIP"]
  C --> F["Tidy + Convert<br/>(needs API key)"]
```

| Action                    | Result                                                |
| ------------------------- | ----------------------------------------------------- |
| Select / change selection | Live HTML preview updates (no image export yet)       |
| Download ZIP              | Full `index.html` + images/SVGs + JSON                |
| Tidy + Convert            | Clone → AI sections → Auto Layout tidy → then convert |
| About → Save key          | Enables Tidy + Convert                                |

---

## UX flow

```mermaid
flowchart TD
  Start["Plugin opens"] --> Ready["UI ready"]
  Ready --> Key{"API key saved?"}
  Key -->|yes| TidyOn["Tidy + Convert enabled"]
  Key -->|no| TidyOff["Tidy disabled<br/>paste key in About"]

  Ready --> Sel{"Selection?"}
  Sel -->|empty| Empty["Show empty state"]
  Sel -->|has layers| Conv["Convert → code preview"]

  Conv --> Panel["Code panel + colors"]
  Panel --> ZipBtn["User: Download ZIP"]
  ZipBtn --> Stream["Export assets one by one"]
  Stream --> DL["Browser downloads ZIP"]

  TidyOn --> TidyBtn["User: Tidy + Convert"]
  TidyBtn --> Clone["Clone to the right"]
  Clone --> AI["AI splits sections"]
  AI --> Layout["Infer Auto Layout"]
  Layout --> Conv
```

---

## Two ways to get HTML

```mermaid
flowchart TD
  subgraph Fast["Everyday"]
    S1["Select"] --> C1["Convert"]
    C1 --> P1["Preview code"]
    P1 --> Z1["Optional: ZIP"]
  end

  subgraph Tidied["When layout is messy"]
    S2["Select"] --> K["API key"]
    K --> T["Tidy + Convert"]
    T --> C2["Convert clone"]
    C2 --> P2["Preview + ZIP"]
  end
```

- **Everyday** — convert what is on the canvas as-is.
- **Tidied** — make a structured clone first (sections, gaps, Auto Layout), leave the original alone, convert the clone.

---

## Conversion logic (big picture)

```mermaid
flowchart TD
  Sel["Selection"] --> Tree["Read layer tree"]
  Tree --> Enrich["Fill gaps<br/>size, text, colors, assets"]
  Enrich --> Layout{"How is it laid out?"}
  Layout -->|Auto Layout row/column| Flex["CSS flex"]
  Layout -->|Grid| Grid["CSS grid"]
  Layout -->|Freeform / group box| Abs["Absolute left/top"]
  Flex --> HTML["HTML + inline CSS"]
  Grid --> HTML
  Abs --> HTML
  HTML --> Preview["Preview snippet"]
  HTML --> Zip["ZIP index.html<br/>when user downloads"]
```

---

## What goes in the ZIP

```mermaid
flowchart LR
  HTML["index.html"] --> Open["Open in browser"]
  Assets["assets/* images & SVGs"] --> Open
  Raw["figma_raw.json"] --> Offline["Offline / debug"]
  Map["assets_map.json"] --> Offline
```

Preview and ZIP share the same HTML document. Images are only exported when you download the ZIP.

---

## Tidy + Convert logic

```mermaid
flowchart TD
  Go["Tidy + Convert"] --> Clone["Clone selection<br/>place to the right"]
  Clone --> Shot["Screenshot + layer list"]
  Shot --> AI["AI: section breaks & names"]
  AI --> Gaps["Keep empty space<br/>between sections"]
  Gaps --> AL["Infer Auto Layout<br/>where it is safe"]
  AL --> Pick["Select the clone"]
  Pick --> Conv["Same convert as everyday"]
```

Original design is never modified. Re-run replaces the previous clone.

---

## Layout rules (when HTML looks wrong)

```mermaid
flowchart TD
  Q1["Group inside Auto Layout?"] -->|yes| Keep["Keep as one box<br/>children absolute inside"]
  Q1 -->|no| Flat["Unwrap group<br/>children join parent"]

  Q2["Image/SVG clipped by parent?"] -->|yes| Full["Use full frame size<br/>not the clipped box"]
  Q2 -->|no shadow overflow| Bigger["Use larger paint box"]

  Q3["Padding almost as big as the frame?"] -->|yes| Drop["Ignore that padding"]
  Q3 -->|no| KeepPad["Emit padding"]
```

These rules keep pages from collapsing sideways (sidebar + footer only), squashing wide background images, or crushing buttons with bad import padding.

---

## Modes

```mermaid
flowchart LR
  Mode["Figma mode"] --> UI["Normal plugin UI<br/>preview + ZIP + tidy"]
  Mode --> Codegen["Dev Mode codegen<br/>code only, no ZIP"]
```

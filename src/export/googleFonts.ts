/**
 * Collect text fonts from the converted tree and emit Google Fonts CDN links.
 * System / local-only faces are skipped; unknown families are still linked
 * (Google ignores invalid family params without breaking the rest).
 */

const SYSTEM_FONT_RE =
  /^(Arial|Helvetica|Times(?: New Roman)?|Courier(?: New)?|Georgia|Verdana|Tahoma|Trebuchet MS|Impact|Comic Sans MS|Palatino|Garamond|system-ui|sans-serif|serif|monospace|ui-sans-serif|ui-serif|ui-monospace|SF Pro(?: Text| Display)?|Apple SD Gothic Neo|Hiragino(?: Sans| Mincho)?|Yu Gothic|Meiryo|MS (?:Gothic|Mincho|PGothic)|Segoe UI|-apple-system|BlinkMacSystemFont)$/i;

export type GoogleFontUse = {
  family: string;
  weights: Set<number>;
  italic: boolean;
};

function normalizeWeight(w: unknown): number {
  const n = typeof w === "number" ? w : Number(w);
  if (!Number.isFinite(n)) return 400;
  return Math.min(900, Math.max(100, Math.round(n / 100) * 100));
}

function isItalicStyle(style: string | undefined): boolean {
  if (!style) return false;
  return /italic|oblique/i.test(style);
}

function isSystemFont(family: string): boolean {
  const t = family.trim();
  if (!t) return true;
  return SYSTEM_FONT_RE.test(t);
}

function recordUse(
  map: Map<string, GoogleFontUse>,
  family: string,
  weight: unknown,
  style?: string,
): void {
  const name = family.trim();
  if (!name || isSystemFont(name)) return;
  let entry = map.get(name);
  if (!entry) {
    entry = { family: name, weights: new Set(), italic: false };
    map.set(name, entry);
  }
  entry.weights.add(normalizeWeight(weight));
  if (isItalicStyle(style)) entry.italic = true;
}

/** Walk enriched convert nodes (styledTextSegments / fontName) for CDN faces. */
export function collectGoogleFontUses(
  nodes: readonly SceneNode[],
): Map<string, GoogleFontUse> {
  const map = new Map<string, GoogleFontUse>();

  const visit = (node: SceneNode) => {
    const segments = (node as { styledTextSegments?: StyledTextSegmentLike[] })
      .styledTextSegments;
    if (Array.isArray(segments) && segments.length > 0) {
      for (const seg of segments) {
        const family = seg.fontName?.family;
        if (!family) continue;
        recordUse(map, family, seg.fontWeight, seg.fontName?.style);
      }
    } else if (node.type === "TEXT") {
      const tn = node as TextNode;
      if (tn.fontName !== figma.mixed && tn.fontName) {
        const weight = tn.fontWeight !== figma.mixed ? tn.fontWeight : 400;
        recordUse(map, tn.fontName.family, weight, tn.fontName.style);
      }
    }

    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children) visit(child as SceneNode);
    }
  };

  for (const n of nodes) visit(n);
  return map;
}

type StyledTextSegmentLike = {
  fontName?: { family: string; style: string };
  fontWeight?: number;
};

/** CSS2 API family query piece, e.g. `Inter:wght@400;700`. */
function familyQuery(use: GoogleFontUse): string {
  const family = encodeURIComponent(use.family).replace(/%20/g, "+");
  const weights = [...use.weights].sort((a, b) => a - b);
  if (weights.length === 0) weights.push(400);

  if (use.italic) {
    const pairs: string[] = [];
    for (const w of weights) {
      pairs.push(`0,${w}`);
      pairs.push(`1,${w}`);
    }
    return `${family}:ital,wght@${pairs.join(";")}`;
  }
  return `${family}:wght@${weights.join(";")}`;
}

export function buildGoogleFontsStylesheetHref(
  uses: Map<string, GoogleFontUse>,
): string | null {
  if (uses.size === 0) return null;
  const families = [...uses.values()]
    .sort((a, b) => a.family.localeCompare(b.family))
    .map(familyQuery)
    .join("&family=");
  return `https://fonts.googleapis.com/css2?family=${families}&display=swap`;
}

/** `<link rel="preconnect">` + stylesheet tags for the ZIP document head. */
export function googleFontsHeadHtml(nodes: readonly SceneNode[]): string {
  const href = buildGoogleFontsStylesheetHref(collectGoogleFontUses(nodes));
  if (!href) return "";
  return `  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="${href}" rel="stylesheet" />
`;
}

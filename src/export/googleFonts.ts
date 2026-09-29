/**
 * Web fonts for the ZIP.
 * System faces stay as HTML text. Other families are checked against the
 * Google Fonts CSS API at convert time. If Google does not have the family
 * (or the check cannot run), the text node is outlined to SVG — Figma will
 * not give us the font file.
 */
import { addWarning } from "../convert/warnings";

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

/** Faces the OS already has. Not probed, not linked, not outlined. */
export function isSystemFont(family: string): boolean {
  const t = family.trim();
  if (!t) return true;
  return SYSTEM_FONT_RE.test(t);
}

/**
 * Used only when the Google CSS probe cannot run (offline / blocked).
 * Families absent from this set are outlined rather than linked.
 */
const COMMON_GOOGLE_FONTS = new Set(
  [
    "Inter",
    "Roboto",
    "Roboto Mono",
    "Roboto Condensed",
    "Open Sans",
    "Lato",
    "Montserrat",
    "Poppins",
    "Oswald",
    "Raleway",
    "Nunito",
    "Nunito Sans",
    "Playfair Display",
    "Merriweather",
    "Source Sans 3",
    "Source Sans Pro",
    "Work Sans",
    "DM Sans",
    "DM Serif Display",
    "Manrope",
    "Plus Jakarta Sans",
    "Outfit",
    "Figtree",
    "Geist",
    "Noto Sans",
    "Noto Serif",
    "Noto Sans JP",
    "Noto Sans KR",
    "PT Sans",
    "PT Serif",
    "Ubuntu",
    "Karla",
    "Rubik",
    "Mulish",
    "Barlow",
    "Josefin Sans",
    "Libre Baskerville",
    "Libre Franklin",
    "Space Grotesk",
    "Space Mono",
    "IBM Plex Sans",
    "IBM Plex Mono",
    "IBM Plex Serif",
    "Fira Sans",
    "Fira Code",
    "Inconsolata",
    "Cabin",
    "Quicksand",
    "Archivo",
    "Archivo Black",
    "Bebas Neue",
    "Anton",
    "Pacifico",
    "Dancing Script",
    "Great Vibes",
    "Cormorant Garamond",
    "EB Garamond",
    "Crimson Text",
    "Lora",
    "Spectral",
    "Hind",
    "Titillium Web",
    "Exo 2",
    "Syne",
    "Sora",
    "Instrument Sans",
    "Instrument Serif",
  ].map((name) => name.toLowerCase()),
);

const probeCache = new Map<string, boolean>();
let unavailableFamilies = new Set<string>();

export function isUnavailableWebFont(family: string | undefined): boolean {
  const name = family?.trim().toLowerCase();
  if (!name || isSystemFont(name)) return false;
  return unavailableFamilies.has(name);
}

function textFamilies(node: TextNode): string[] {
  try {
    if (node.fontName === figma.mixed) {
      return node
        .getStyledTextSegments(["fontName"])
        .map((seg) => seg.fontName?.family)
        .filter((name): name is string => !!name);
    }
    if (node.fontName && node.fontName !== figma.mixed) {
      return [node.fontName.family];
    }
  } catch {
    return [];
  }
  return [];
}

function collectLiveTextFamilies(nodes: readonly SceneNode[]): string[] {
  const families = new Set<string>();
  const take = (node: SceneNode) => {
    if (!node || node.visible === false || node.type !== "TEXT") return;
    for (const family of textFamilies(node as TextNode)) families.add(family);
  };
  for (const node of nodes) {
    take(node);
    // dynamic-page: `.children` can throw or skip unloaded descendants.
    try {
      if ("findAll" in node) {
        for (const child of node.findAll((n) => n.type === "TEXT")) take(child);
        continue;
      }
    } catch {
      /* fall through to a children walk */
    }
    const visit = (current: SceneNode) => {
      take(current);
      if (!("children" in current)) return;
      for (const child of current.children) visit(child);
    };
    if ("children" in node) {
      for (const child of node.children) visit(child);
    }
  }
  return [...families];
}

/** `true` if Google serves it, `false` if not, `null` if the request failed. */
async function googleFamilyExists(family: string): Promise<boolean | null> {
  const key = family.trim().toLowerCase();
  if (probeCache.has(key)) return probeCache.get(key)!;
  const ctrl =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 4000) : null;
  try {
    const res = await fetch(
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family.trim())}&display=swap`,
      ctrl ? { signal: ctrl.signal } : undefined,
    );
    if (!res.ok && res.status !== 400) return null;
    probeCache.set(key, res.ok);
    return res.ok;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Call before asset planning. System fonts stay HTML. Google Fonts stay HTML
 * and are linked. Everything else is remembered so text export outlines it.
 */
export async function prepareWebFontAvailability(
  nodes: readonly SceneNode[],
): Promise<void> {
  const families = collectLiveTextFamilies(nodes).filter(
    (family) => !isSystemFont(family),
  );
  const next = new Set<string>();
  const probeUsable = (await googleFamilyExists("Inter")) === true;

  for (const family of families) {
    const key = family.trim().toLowerCase();
    if (probeUsable) {
      const exists = await googleFamilyExists(family);
      // `null` means the check failed (plugin network not reloaded, timeout).
      // That is not "Google has this font" — outline it.
      if (exists !== true) next.add(key);
      continue;
    }
    if (!COMMON_GOOGLE_FONTS.has(key)) next.add(key);
  }

  unavailableFamilies = next;
  for (const family of families) {
    if (!next.has(family.trim().toLowerCase())) continue;
    addWarning(
      `Font “${family.trim()}” cannot be loaded for the web; that text was exported as SVG.`,
    );
  }
}

export function textUsesUnavailableFont(node: TextNode): boolean {
  return textFamilies(node).some((family) => isUnavailableWebFont(family));
}

function recordUse(
  map: Map<string, GoogleFontUse>,
  family: string,
  weight: unknown,
  style?: string,
): void {
  const name = family.trim();
  if (!name || isSystemFont(name) || isUnavailableWebFont(name)) return;
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

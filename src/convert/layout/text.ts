export const commonLineHeight = (
  lineHeight: LineHeight,
  fontSize: number,
): number => {
  switch (lineHeight.unit) {
    case "AUTO":
      return 0;
    case "PIXELS":
      return lineHeight.value;
    case "PERCENT":
      return (fontSize * lineHeight.value) / 100;
  }
};

export const commonLetterSpacing = (
  letterSpacing: LetterSpacing,
  fontSize: number,
): number => {
  switch (letterSpacing.unit) {
    case "PIXELS":
      return letterSpacing.value;
    case "PERCENT":
      return (fontSize * letterSpacing.value) / 100;
  }
};

const CJK_CHAR = /[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9d]/;
const LINE_END_PUNCT = /[。、！？!?♪」』）\]）…ー]$/;

/**
 * Figma sometimes stores soft-wrap points as hard `\n` mid-lexeme (e.g.
 * "…上の仕\\n上がりに。"). Keep paragraph breaks and short intentional lines;
 * rejoin only wrap-like breaks where the prior line is ~full width and the
 * next line is a short CJK continuation.
 */
export function unwrapSoftWrapNewlines(characters: string): string {
  if (!characters.includes("\n")) return characters;

  const lines = characters.split("\n");
  const lens = lines.map((l) => [...l].length);
  const maxLen = Math.max(0, ...lens.filter((n, i) => lines[i].length > 0));
  if (maxLen < 8) return characters;

  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    const next = lines[i + 1];
    if (next === undefined) {
      out.push(cur);
      break;
    }
    // Preserve blank lines (paragraph gaps).
    if (cur === "" || next === "") {
      out.push(cur);
      continue;
    }

    const curLen = lens[i];
    const nextLen = lens[i + 1];
    const curChars = [...cur];
    const nextChars = [...next];
    const last = curChars[curChars.length - 1] || "";
    const first = nextChars[0] || "";
    const nearFull = curLen >= maxLen - 2;
    const shortCont =
      nextLen > 0 && nextLen <= Math.max(6, Math.floor(maxLen * 0.4));
    const midCjk =
      CJK_CHAR.test(last) && CJK_CHAR.test(first) && !LINE_END_PUNCT.test(cur);

    if (nearFull && shortCont && midCjk) {
      // Join onto current; re-evaluate against the following line.
      lines[i + 1] = cur + next;
      lens[i + 1] = curLen + nextLen;
      continue;
    }
    out.push(cur);
  }
  return out.join("\n");
}

/** Characters that must not start a line (CJK kinsoku). Figma keeps these. */
const KINSOKU_LINE_START = /^[\s」』）\)\]】》>、。，．！？!?"”’']+$/;

export function isKinsokuOnlyRun(text: string): boolean {
  return text.length > 0 && KINSOKU_LINE_START.test(text);
}

/** Drop trailing kinsoku when measuring whether a line needs a wrap. */
export function stripTrailingKinsoku(line: string): string {
  return line.replace(/[\s」』）\)\]】》>、。，．！？!?"”’']+$/g, "");
}

/** Approx CSS advance: CJK ≈ 1em, ASCII/halfwidth ≈ 0.55em. */
export function estimateLineAdvancePx(
  line: string,
  fontSize: number,
  letterSpacingPx = 0,
): number {
  if (fontSize <= 0 || !line) return 0;
  const chars = [...line];
  let advance = 0;
  for (let i = 0; i < chars.length; i++) {
    const code = chars[i].codePointAt(0) ?? 0;
    const half = code <= 0x00ff || (code >= 0xff61 && code <= 0xff9f);
    advance += half ? fontSize * 0.55 : fontSize;
    if (i < chars.length - 1) advance += letterSpacingPx;
  }
  return advance;
}

/**
 * True when any authored paragraph is wider than the layout box (needs soft wrap).
 * Used when paint/AABB height still looks like one line (e.g. clipped 2-line body).
 */
export function textContentExceedsLayoutWidth(
  characters: string,
  layoutWidth: number,
  fontSize: number,
  letterSpacingPx = 0,
): boolean {
  if (!(fontSize > 0) || !(layoutWidth > 1) || !characters) return false;
  const limit = layoutWidth * 1.02;
  for (const line of characters.split("\n")) {
    if (!line) continue;
    // Hanging 「…終わらせない」 is one Figma line; 1em estimate of `」` must not
    // count as overflow (that baked `<br/>」` on Profiles).
    const measurable = stripTrailingKinsoku(line) || line;
    if (estimateLineAdvancePx(measurable, fontSize, letterSpacingPx) > limit) {
      return true;
    }
  }
  return false;
}

/**
 * True when the layout box is taller than one line. Single-line labels
 * (Exercise 22px / lh 21.6, KINDERGARTEN) must not be treated as wrap targets
 * even if 0.55em Latin estimate exceeds AABB width.
 * Clipped body (いまお 69px / lh 48) is taller than one line → bake.
 */
export function textBoxLooksMultiline(
  height: number,
  fontSize: number,
  lineHeightPx: number,
): boolean {
  if (!(height > 0) || !(fontSize > 0)) return false;
  const lh = lineHeightPx > 0 ? lineHeightPx : fontSize * 1.2;
  return height > Math.max(fontSize * 1.8, lh * 1.25);
}

/**
 * Authored `\n` already account for the box height (Realm address 209×66 /
 * lh 33 with two lines). Do not estimate extra wraps — 1em Latin/digit
 * overflow invented `3-16-2<br/>5`.
 */
export function authoredNewlinesExplainBox(
  characters: string,
  height: number,
  lineHeightPx: number,
): boolean {
  if (!(height > 0) || !(lineHeightPx > 0) || !characters.includes("\n")) {
    return false;
  }
  const n = characters.split("\n").filter((l) => l.length > 0).length;
  if (n <= 1) return false;
  return height <= n * lineHeightPx * 1.35;
}

/**
 * Minimum CSS width so browser webfonts do not wrap more lines than Figma.
 * Soft-wrap: size for `targetLines` equal chunks. Hard-break: longest authored line.
 */
export function estimateTextBoxMinWidthPx(
  characters: string,
  fontSize: number,
  letterSpacingPx: number,
  targetLines: number,
): number {
  if (fontSize <= 0) return 0;
  const lines = characters.split("\n");
  // Small safety pad: browser advances often exceed the 1em CJK estimate by a
  // few px, which is enough to tip one extra soft-wrap line.
  const safety = fontSize * 0.5;
  if (lines.length > 1) {
    return (
      Math.max(
        0,
        ...lines.map((l) =>
          estimateLineAdvancePx(l, fontSize, letterSpacingPx),
        ),
      ) + safety
    );
  }
  const units = [...characters];
  if (units.length === 0) return 0;
  const linesWanted = Math.max(1, Math.floor(targetLines));
  const perLine = Math.ceil(units.length / linesWanted);
  return (
    estimateLineAdvancePx(
      units.slice(0, perLine).join(""),
      fontSize,
      letterSpacingPx,
    ) + safety
  );
}

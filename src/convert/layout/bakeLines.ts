/**
 * Bake Figma soft wraps into `\n` for HTML `<br/>`.
 *
 * Primary: SVG_STRING with svgOutlineText:false — Figma emits one tspan (or y)
 * per visual line, matching the canvas even when AABB height clips overflow.
 * Fallback: HEIGHT-clone character probing.
 */

import {
  authoredNewlinesExplainBox,
  commonLetterSpacing,
  estimateLineAdvancePx,
  isKinsokuOnlyRun,
  textBoxLooksMultiline,
  textContentExceedsLayoutWidth,
} from "./text";

const STYLE_FIELDS = [
  "fontName",
  "fontSize",
  "letterSpacing",
  "lineHeight",
  "textCase",
  "textDecoration",
] as const;

async function loadTextFonts(node: TextNode): Promise<boolean> {
  if (node.hasMissingFont) return false;
  const len = node.characters.length;
  if (len === 0) return true;
  try {
    const fonts = node.getRangeAllFontNames(0, len);
    await Promise.all(fonts.map((f) => figma.loadFontAsync(f)));
    return true;
  } catch {
    return false;
  }
}

function utf16Advance(text: string, index: number): number {
  const c = text.charCodeAt(index);
  if (c >= 0xd800 && c <= 0xdbff && index + 1 < text.length) return 2;
  return 1;
}

function decodeXmlText(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&amp;/g, "&");
}

/** Visual lines from Figma SVG text export (tspans grouped by y). */
function parseSvgVisualLines(svg: string): string[] {
  const pieces: { y: number; text: string }[] = [];
  const tspanRe = /<tspan\b([^>]*)>([^<]*)<\/tspan>/gi;
  let m: RegExpExecArray | null;
  while ((m = tspanRe.exec(svg))) {
    const text = decodeXmlText(m[2]);
    if (!text) continue;
    const yAttr = /\by="([-\d.eE]+)"/.exec(m[1]);
    const y = yAttr ? parseFloat(yAttr[1]) : pieces.length * 1000;
    pieces.push({ y, text });
  }

  if (pieces.length === 0) {
    const textRe = /<text\b[^>]*>([^<]*)<\/text>/gi;
    while ((m = textRe.exec(svg))) {
      const text = decodeXmlText(m[1]).replace(/\s+/g, " ").trim();
      if (text) pieces.push({ y: pieces.length * 1000, text });
    }
  }

  if (pieces.length === 0) return [];

  pieces.sort((a, b) => a.y - b.y || 0);
  const lines: string[] = [];
  let curY = pieces[0].y;
  let cur = "";
  for (const p of pieces) {
    if (Math.abs(p.y - curY) <= 0.75 && cur.length > 0) {
      cur += p.text;
    } else {
      if (cur) lines.push(cur);
      cur = p.text;
      curY = p.y;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Map visual line strings back to soft-break starts in the original characters.
 * Soft breaks only — existing `\n` in `original` are skipped over, not listed.
 */
function softBreaksFromVisualLines(
  original: string,
  lines: string[],
): number[] | null {
  if (lines.length <= 1) return [];

  const compact = original.replace(/\n/g, "");
  const joined = lines.join("");
  if (joined !== compact) {
    // Allow SVG to drop trailing spaces / collapse — try trimmed join.
    if (joined.replace(/\s+/g, "") !== compact.replace(/\s+/g, "")) {
      return null;
    }
  }

  const breaks: number[] = [];
  let origPos = 0;
  let lineIdx = 0;
  let linePos = 0;

  while (origPos < original.length && lineIdx < lines.length) {
    const line = lines[lineIdx];
    // Finish the previous visual line before skipping hard `\n` — otherwise we
    // consume the hard break first and still soft-break (→ `<br/><br/>`).
    if (linePos >= line.length) {
      lineIdx += 1;
      linePos = 0;
      if (lineIdx >= lines.length) continue;
      if (origPos < original.length && original[origPos] === "\n") {
        while (origPos < original.length && original[origPos] === "\n") {
          origPos += 1;
        }
      } else if (origPos < original.length) {
        breaks.push(origPos);
      }
      continue;
    }
    if (original[origPos] === "\n") {
      origPos += 1;
      continue;
    }

    // Match one UTF-16 unit (SVG and Figma both use UTF-16 indexing in practice
    // for BMP CJK; surrogate pairs advance together).
    const adv = utf16Advance(original, origPos);
    const fromOrig = original.slice(origPos, origPos + adv);
    const fromLine = line.slice(linePos, linePos + adv);
    if (fromOrig !== fromLine) {
      // Whitespace-only drift in SVG
      if (/\s/.test(fromLine) && !/\s/.test(fromOrig)) {
        linePos += utf16Advance(line, linePos);
        continue;
      }
      if (/\s/.test(fromOrig) && !/\s/.test(fromLine)) {
        origPos += adv;
        continue;
      }
      return null;
    }
    origPos += adv;
    linePos += adv;
  }

  return breaks;
}

async function softBreaksFromSvgExport(
  node: TextNode,
): Promise<{ starts: number[]; visualLineCount: number } | null> {
  try {
    const svg = await node.exportAsync({
      format: "SVG_STRING",
      svgOutlineText: false,
    } as ExportSettingsSVGString);
    if (typeof svg !== "string" || !svg.includes("<")) return null;
    const lines = parseSvgVisualLines(svg);
    if (lines.length === 0) return null;
    if (lines.length === 1) return { starts: [], visualLineCount: 1 };
    const starts = softBreaksFromVisualLines(node.characters, lines);
    if (starts == null) return null;
    return { starts, visualLineCount: lines.length };
  } catch {
    return null;
  }
}

/** Drop breaks that would put only kinsoku (e.g. `」`) on the next line. */
function dropKinsokuOrphanBreaks(text: string, breaks: number[]): number[] {
  return breaks.filter((i) => {
    let paraEnd = text.indexOf("\n", i);
    if (paraEnd < 0) paraEnd = text.length;
    return !isKinsokuOnlyRun(text.slice(i, paraEnd));
  });
}

/** Advance estimate must not leave a 1-glyph line (`5`, `e`, `g`). SVG `す。` stays. */
function dropOneGlyphOrphanBreaks(text: string, breaks: number[]): number[] {
  return breaks.filter((i) => {
    let paraEnd = text.indexOf("\n", i);
    if (paraEnd < 0) paraEnd = text.length;
    return [...text.slice(i, paraEnd)].length > 1;
  });
}

function applySourceStyles(
  dest: TextNode,
  source: TextNode,
  destLen: number,
  sourceStart: number,
): void {
  if (destLen <= 0) return;
  const segs = source.getStyledTextSegments(
    [...STYLE_FIELDS],
    sourceStart,
    sourceStart + destLen,
  );
  for (const seg of segs) {
    const a = Math.max(0, seg.start - sourceStart);
    const b = Math.min(destLen, seg.end - sourceStart);
    if (a >= b) continue;
    try {
      dest.setRangeFontName(a, b, seg.fontName);
      dest.setRangeFontSize(a, b, seg.fontSize);
      dest.setRangeLetterSpacing(a, b, seg.letterSpacing);
      dest.setRangeLineHeight(a, b, seg.lineHeight);
      dest.setRangeTextCase(a, b, seg.textCase);
      dest.setRangeTextDecoration(a, b, seg.textDecoration);
    } catch {
      /* mixed / unloadable range */
    }
  }
}

function setCloneSlice(
  clone: TextNode,
  source: TextNode,
  text: string,
  start: number,
  end: number,
): void {
  const slice = text.slice(start, end);
  clone.characters = slice;
  applySourceStyles(clone, source, slice.length, start);
}

function prepareMeasureClone(clone: TextNode, node: TextNode): void {
  try {
    clone.textAlignHorizontal = node.textAlignHorizontal;
  } catch {
    /* mixed */
  }
  clone.textAutoResize = "NONE";
  clone.resize(node.width, 1);
  clone.textAutoResize = "HEIGHT";
  clone.resize(node.width, 1);
}

function softBreaksByHeightProbe(
  clone: TextNode,
  source: TextNode,
  text: string,
): number[] {
  const breaks: number[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\n") {
      i += 1;
      continue;
    }
    let paraEnd = text.indexOf("\n", i);
    if (paraEnd < 0) paraEnd = text.length;

    const firstEnd = Math.min(paraEnd, i + utf16Advance(text, i));
    setCloneSlice(clone, source, text, i, firstEnd);
    const lineH = clone.height;
    if (!(lineH > 0)) {
      i = paraEnd;
      continue;
    }
    const jump = Math.max(2, lineH * 0.6);
    let prevH = lineH;
    let end = firstEnd;
    while (end < paraEnd) {
      const charStart = end;
      end += utf16Advance(text, end);
      setCloneSlice(clone, source, text, i, end);
      const h = clone.height;
      if (h > prevH + jump) {
        if (charStart > i) breaks.push(charStart);
        prevH = h;
      } else {
        prevH = Math.max(prevH, h);
      }
    }
    i = paraEnd;
  }
  return breaks;
}

export type BakedVisualLines = {
  characters: string;
  softBreakStarts: number[];
};

/**
 * True when Figma paints more lines than the AABB height suggests (overflow).
 * Soft-wrap width estimates must not widen these boxes toward fewer lines.
 */
export function textOverflowsLayoutBox(node: TextNode): boolean {
  const rb = node.absoluteRenderBounds;
  if (!rb || !(node.height > 0)) return false;
  return rb.height > node.height * 1.15;
}

function softBreaksByAdvanceEstimate(
  text: string,
  layoutWidth: number,
  fontSize: number,
  letterSpacingPx: number,
): number[] {
  if (!(layoutWidth > 1) || !(fontSize > 0) || !text) return [];
  const breaks: number[] = [];
  let lineStart = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\n") {
      i += 1;
      lineStart = i;
      continue;
    }
    const adv = utf16Advance(text, i);
    const next = i + adv;
    const lineAdv = estimateLineAdvancePx(
      text.slice(lineStart, next),
      fontSize,
      letterSpacingPx,
    );
    if (lineAdv > layoutWidth && i > lineStart) {
      breaks.push(i);
      lineStart = i;
      continue;
    }
    i = next;
  }
  return breaks;
}

/**
 * Sync advance-based soft breaks for HTML emit when plugin bake was skipped
 * (REST dump / missing fonts). Prefer bakeFigmaVisualLineBreaks in toJson.
 */
export function bakeSoftBreaksFromAdvanceEstimate(
  characters: string,
  layoutWidth: number,
  fontSize: number,
  letterSpacingPx = 0,
): BakedVisualLines | null {
  if (
    !textContentExceedsLayoutWidth(
      characters,
      layoutWidth,
      fontSize,
      letterSpacingPx,
    )
  ) {
    return null;
  }
  let softBreakStarts = dropOneGlyphOrphanBreaks(
    characters,
    dropKinsokuOrphanBreaks(
      characters,
      softBreaksByAdvanceEstimate(
        characters,
        layoutWidth,
        fontSize,
        letterSpacingPx,
      ).filter((i) => i > 0 && characters[i - 1] !== "\n"),
    ),
  );
  if (softBreakStarts.length === 0) return null;

  let out = "";
  const breakSet = new Set(softBreakStarts);
  for (let idx = 0; idx < characters.length; idx++) {
    if (breakSet.has(idx) && (idx === 0 || characters[idx - 1] !== "\n")) {
      out += "\n";
    }
    out += characters[idx];
  }
  return { characters: out, softBreakStarts };
}

export async function bakeFigmaVisualLineBreaks(
  node: TextNode,
): Promise<BakedVisualLines | null> {
  const text = node.characters;
  if (!text || text.length === 0) return null;
  if (node.textAutoResize === "WIDTH_AND_HEIGHT") return null;
  if (!(node.width > 1)) return null;

  let lineHeightPx = 0;
  try {
    if (node.lineHeight !== figma.mixed && typeof node.fontSize === "number") {
      const lh = node.lineHeight as LineHeight;
      if (lh.unit === "PIXELS") lineHeightPx = lh.value;
      else if (lh.unit === "PERCENT")
        lineHeightPx = (node.fontSize * lh.value) / 100;
    }
  } catch {
    /* mixed */
  }

  const paintH = node.absoluteRenderBounds?.height ?? node.height;
  let fontSize = 0;
  let letterSpacingPx = 0;
  try {
    if (typeof node.fontSize === "number") fontSize = node.fontSize;
    if (
      fontSize > 0 &&
      node.letterSpacing !== figma.mixed &&
      node.letterSpacing
    ) {
      letterSpacingPx = commonLetterSpacing(
        node.letterSpacing as LetterSpacing,
        fontSize,
      );
    }
  } catch {
    /* mixed */
  }
  // Skip single-line labels. Width estimate alone is not enough: Latin
  // 0.55em overestimates Noto ("Exercise" → Exercis<br/>e). Require the AABB
  // to be taller than one line (いまお 69 / lh 48) before treating as wrap.
  const contentWiderThanBox = textContentExceedsLayoutWidth(
    text,
    node.width,
    fontSize,
    letterSpacingPx,
  );
  const clippedMultilineBody =
    contentWiderThanBox &&
    textBoxLooksMultiline(node.height, fontSize, lineHeightPx);
  if (
    lineHeightPx > 0 &&
    paintH <= lineHeightPx * 1.5 &&
    !text.includes("\n") &&
    !clippedMultilineBody
  ) {
    return null;
  }

  if (!(await loadTextFonts(node))) return null;

  // 1) Prefer SVG visual lines (matches canvas, including AABB overflow).
  const svgResult = await softBreaksFromSvgExport(node);
  let softBreakStarts = svgResult?.starts ?? null;
  const svgVisualLines = svgResult?.visualLineCount ?? 0;

  // Clipped multi-line with no `\n` often exports as one SVG line. Only then
  // treat empty extra-breaks as failure. Profiles quote already has `\n`; SVG
  // 2 lines with 0 extra breaks is success — probing invented `<br/>」`.
  const svgLiedSingle = svgVisualLines <= 1 && clippedMultilineBody;
  if (softBreakStarts == null || svgLiedSingle) {
    const clone = node.clone();
    clone.visible = false;
    clone.name = "__ftc_linebake__";
    try {
      clone.x = -100000;
      clone.y = -100000;
      prepareMeasureClone(clone, node);
      softBreakStarts = softBreaksByHeightProbe(clone, node, text);
    } finally {
      clone.remove();
    }
  }

  // 3) Advance estimate — last resort when Figma paint metrics hide wraps
  // (master-course「いまお」: ~33 CJK / 597px ≈ 1em). Skip when authored `\n`
  // already match the box / SVG line count (Realm `3-16-25`, Profiles quote).
  const authoredLineCount = text.split("\n").filter((l) => l.length > 0).length;
  const estimateOk =
    clippedMultilineBody &&
    (!softBreakStarts || softBreakStarts.length === 0) &&
    !authoredNewlinesExplainBox(text, node.height, lineHeightPx) &&
    !(svgVisualLines >= authoredLineCount && svgVisualLines > 1);
  if (estimateOk) {
    softBreakStarts = dropOneGlyphOrphanBreaks(
      text,
      softBreaksByAdvanceEstimate(text, node.width, fontSize, letterSpacingPx),
    );
  }

  if (!softBreakStarts || softBreakStarts.length === 0) return null;

  // Drop soft breaks that sit right after an existing hard `\n`.
  // Drop kinsoku-only next lines (`」` hanging on Profiles quote).
  softBreakStarts = dropKinsokuOrphanBreaks(
    text,
    softBreakStarts.filter((i) => i > 0 && text[i - 1] !== "\n"),
  );
  if (softBreakStarts.length === 0) return null;

  let characters = "";
  const breakSet = new Set(softBreakStarts);
  for (let idx = 0; idx < text.length; idx++) {
    if (breakSet.has(idx) && (idx === 0 || text[idx - 1] !== "\n")) {
      characters += "\n";
    }
    characters += text[idx];
  }

  return { characters, softBreakStarts };
}

export function injectSoftBreaksIntoSegment(
  originalCharacters: string,
  segmentStart: number,
  segmentEnd: number,
  softBreakStarts: readonly number[],
): string {
  const breakSet = new Set(
    softBreakStarts.filter((i) => i > segmentStart && i < segmentEnd),
  );
  let out = "";
  for (let i = segmentStart; i < segmentEnd; i++) {
    if (breakSet.has(i) && (i === 0 || originalCharacters[i - 1] !== "\n")) {
      out += "\n";
    }
    out += originalCharacters[i];
  }
  return out;
}

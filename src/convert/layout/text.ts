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

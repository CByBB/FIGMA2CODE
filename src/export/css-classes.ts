/**
 * Move inline style="…" into class attributes + a separate CSS stylesheet
 * (styles/page.css in the ZIP).
 */
const STYLE_ATTR_RE = /\sstyle\s*=\s*"([^"]*)"/i;
const STYLE_ATTR_GLOBAL_RE = /\sstyle\s*=\s*"([^"]*)"/gi;
const CLASS_ATTR_RE = /\sclass\s*=\s*"([^"]*)"/i;
const OPEN_TAG_RE = /<([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;

function normalizeStyle(style: string): string {
  return style
    .trim()
    .replace(/\s*;\s*/g, "; ")
    .replace(/\s*:\s*/g, ": ")
    .replace(/;\s*$/, "")
    .trim();
}

function classNameForIndex(i: number): string {
  return `c${i}`;
}

function mergeClassAttr(attrs: string, extraClass: string): string {
  const match = attrs.match(CLASS_ATTR_RE);
  if (!match) {
    return `${attrs} class="${extraClass}"`;
  }
  const existing = match[1]
    .split(/\s+/)
    .map((c) => c.trim())
    .filter(Boolean);
  if (!existing.includes(extraClass)) existing.push(extraClass);
  return attrs.replace(CLASS_ATTR_RE, ` class="${existing.join(" ")}"`);
}

function stripStyleAttrs(attrs: string): string {
  return attrs.replace(STYLE_ATTR_GLOBAL_RE, "");
}

function collectUniqueStyles(html: string): Map<string, string> {
  const styleToClass = new Map<string, string>();
  let n = 0;
  const re = new RegExp(STYLE_ATTR_GLOBAL_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const norm = normalizeStyle(m[1] || "");
    if (!norm || styleToClass.has(norm)) continue;
    n += 1;
    styleToClass.set(norm, classNameForIndex(n));
  }
  return styleToClass;
}

function rewriteTagsWithClasses(
  html: string,
  styleToClass: Map<string, string>,
): string {
  return html.replace(
    OPEN_TAG_RE,
    (full, tag: string, attrs: string, slash: string) => {
      const styleMatch = attrs.match(STYLE_ATTR_RE);
      if (!styleMatch) return full;
      const norm = normalizeStyle(styleMatch[1] || "");
      if (!norm) {
        return `<${tag}${stripStyleAttrs(attrs)}${slash}>`;
      }
      const cls = styleToClass.get(norm);
      if (!cls) {
        return `<${tag}${stripStyleAttrs(attrs)}${slash}>`;
      }
      const nextAttrs = mergeClassAttr(stripStyleAttrs(attrs), cls);
      return `<${tag}${nextAttrs}${slash}>`;
    },
  );
}

function buildCssBlock(styleToClass: Map<string, string>): string {
  const lines: string[] = [];
  for (const [style, cls] of styleToClass) {
    const decls = style.endsWith(";") ? style : `${style};`;
    lines.push(`.${cls} { ${decls} }`);
  }
  return lines.join("\n");
}

/** Deterministic: inline styles → shared classes; CSS returned separately for styles/page.css. */
export function extractInlineStylesToClasses(
  html: string,
  existingCss: string = "",
): {
  html: string;
  css: string;
  classCount: number;
} {
  const styleToClass = collectUniqueStyles(html);
  if (styleToClass.size === 0) {
    return {
      html,
      css: existingCss.trim(),
      classCount: 0,
    };
  }
  const withClasses = rewriteTagsWithClasses(html, styleToClass);
  const classCss = buildCssBlock(styleToClass);
  const base = existingCss.trim();
  const css = base ? `${base}\n\n${classCss}` : classCss;
  return {
    html: withClasses,
    css,
    classCount: styleToClass.size,
  };
}

/** Apply AI-suggested renames across HTML class attrs + external CSS. */
export function applyClassRenames(
  html: string,
  css: string,
  renames: Record<string, string>,
): { html: string; css: string } {
  const map = new Map<string, string>();
  for (const [from, to] of Object.entries(renames)) {
    if (
      !from ||
      !to ||
      from === to ||
      !/^[a-zA-Z_][\w-]*$/.test(from) ||
      !/^[a-zA-Z_][\w-]*$/.test(to)
    ) {
      continue;
    }
    map.set(from, to);
  }
  if (map.size === 0) return { html, css };

  const renameSelector = (text: string) => {
    let next = text;
    const keys = Array.from(map.keys()).sort((a, b) => b.length - a.length);
    for (const from of keys) {
      const to = map.get(from)!;
      next = next.split(`.${from}`).join(`.${to}`);
    }
    return next;
  };

  const nextCss = renameSelector(css);
  const nextHtml = html.replace(
    /class="([^"]*)"/g,
    (_full, classes: string) => {
      const next = classes
        .split(/\s+/)
        .map((c) => (c && map.has(c) ? map.get(c)! : c))
        .join(" ");
      return `class="${next}"`;
    },
  );

  return { html: nextHtml, css: nextCss };
}

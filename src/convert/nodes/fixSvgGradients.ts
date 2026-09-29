/**
 * Figma `exportAsync(SVG)` often collapses diagonal linear gradients to a
 * vertical line (x2 === x1) — Instagram brand icons become purple with a
 * yellow band. Rewrite gradient vectors from `gradientHandlePositions`.
 */

type Rect = { x: number; y: number; width: number; height: number };

type GradientPaintLike = {
  type: string;
  visible?: boolean;
  gradientHandlePositions?: ReadonlyArray<{ x: number; y: number }>;
};

type NodeBox = SceneNode & {
  absoluteBoundingBox?: Rect | null;
  fills?: ReadonlyArray<Paint> | PluginAPI["mixed"];
  strokes?: ReadonlyArray<Paint> | PluginAPI["mixed"];
  visible?: boolean;
  children?: ReadonlyArray<SceneNode>;
};

const fmt = (n: number) => {
  const t = Math.round(n * 1e5) / 1e5;
  return String(t);
};

const isVisiblePaint = (p: GradientPaintLike): boolean => p.visible !== false;

const nodeRect = (node: NodeBox): Rect | null => {
  const b = node.absoluteBoundingBox;
  if (b && b.width >= 0 && b.height >= 0) return b;
  return null;
};

const gradientUserCoords = (
  paint: GradientPaintLike,
  node: NodeBox,
  root: Rect,
): { x1: number; y1: number; x2: number; y2: number } | null => {
  const handles = paint.gradientHandlePositions;
  if (!handles || handles.length < 2) return null;
  const box = nodeRect(node);
  if (!box || box.width <= 0 || box.height <= 0) return null;

  const [h0, h1] = handles;
  return {
    x1: box.x - root.x + h0.x * box.width,
    y1: box.y - root.y + h0.y * box.height,
    x2: box.x - root.x + h1.x * box.width,
    y2: box.y - root.y + h1.y * box.height,
  };
};

/** Pair each linear paint with the node that owns it (document order). */
const collectLinearPaintNodes = (
  node: NodeBox,
  out: { node: NodeBox; paint: GradientPaintLike }[],
): void => {
  if (node.visible === false) return;

  const pushFrom = (paints: NodeBox["fills"]) => {
    if (!paints || paints === figma.mixed || !Array.isArray(paints)) return;
    for (const p of paints) {
      if (
        p &&
        (p as GradientPaintLike).type === "GRADIENT_LINEAR" &&
        isVisiblePaint(p as GradientPaintLike)
      ) {
        out.push({ node, paint: p as GradientPaintLike });
      }
    }
  };

  pushFrom(node.fills);
  pushFrom(node.strokes);

  if (node.children) {
    for (const child of node.children) {
      collectLinearPaintNodes(child as NodeBox, out);
    }
  }
};

const setAttr = (attrs: string, name: string, value: string): string => {
  const needle = `${name}="`;
  let result = attrs;
  for (;;) {
    const start = result.indexOf(needle);
    if (start < 0) break;
    // Include the preceding whitespace when present.
    const from = start > 0 && /\s/.test(result[start - 1]) ? start - 1 : start;
    const valueStart = start + needle.length;
    const endQuote = result.indexOf('"', valueStart);
    if (endQuote < 0) break;
    result = result.slice(0, from) + result.slice(endQuote + 1);
  }
  return `${result} ${name}="${value}"`;
};

/** Sort `<stop>` children by offset so yellow→red→purple maps correctly. */
const sortGradientStops = (inner: string): string => {
  const stops: { offset: number; html: string }[] = [];
  const stopRe = /<stop\b[^>]*\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = stopRe.exec(inner))) {
    const tag = m[0];
    const om = /\boffset="([^"]*)"/i.exec(tag);
    const offset = om ? parseFloat(om[1]) : 0;
    stops.push({ offset: Number.isFinite(offset) ? offset : 0, html: tag });
  }
  if (stops.length < 2) return inner;
  stops.sort((a, b) => a.offset - b.offset);
  const without = inner.replace(stopRe, "");
  return `${stops.map((s) => s.html).join("")}${without}`;
};

/**
 * Rewrite `linearGradient` x1/y1/x2/y2 (and stop order) from Figma fills on
 * `root` and its descendants. No-op when the SVG has no linear gradients.
 */
export function fixSvgLinearGradients(svg: string, root: SceneNode): string {
  if (!svg.includes("<linearGradient")) return svg;

  const rootBox = nodeRect(root as NodeBox);
  if (!rootBox) return svg;

  const paints: { node: NodeBox; paint: GradientPaintLike }[] = [];
  collectLinearPaintNodes(root as NodeBox, paints);
  if (paints.length === 0) return svg;

  let index = 0;
  return svg.replace(
    /<linearGradient\b([^>]*)>([\s\S]*?)<\/linearGradient>/gi,
    (full, attrs: string, inner: string) => {
      if (index >= paints.length) return full;
      const { node, paint } = paints[index++];
      const coords = gradientUserCoords(paint, node, rootBox);
      if (!coords) return full;

      let next = attrs;
      next = setAttr(next, "x1", fmt(coords.x1));
      next = setAttr(next, "y1", fmt(coords.y1));
      next = setAttr(next, "x2", fmt(coords.x2));
      next = setAttr(next, "y2", fmt(coords.y2));
      if (!/\bgradientUnits=/i.test(next)) {
        next = setAttr(next, "gradientUnits", "userSpaceOnUse");
      }

      return `<linearGradient${next}>${sortGradientStops(inner)}</linearGradient>`;
    },
  );
}

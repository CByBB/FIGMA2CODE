/**
 * Export Measure `bounds.json` from the current Figma selection (Plugin API only).
 * Coordinate space: frame-top-left — origin = selected frame/artboard top-left.
 * No Figma REST / MCP / personal access token.
 */

export type BoundsStyleSample = {
  backgroundColor?: string;
  color?: string;
  fontSize?: number;
  fontWeight?: number | string;
  borderRadius?: number;
  opacity?: number;
};

export type BoundsNode = {
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
  styles?: BoundsStyleSample;
};

export type BoundsFile = {
  schemaVersion: 1;
  coordinateSpace: "frame-top-left";
  artboard: { width: number; height: number };
  /** Keys = Figma node ids (e.g. `658:1316`) — use as `data-figma-id` as-is. */
  nodes: Record<string, BoundsNode>;
};

/** Types skipped as non-layout / non-meaningful for Measure v1. */
const SKIP_TYPES = new Set<NodeType>(["SLICE", "DOCUMENT", "PAGE"]);

function roundPx(n: number): number {
  return Math.round(n * 100) / 100;
}

function rgbToCss(color: RGB, alpha = 1): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  if (alpha >= 1) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${roundPx(alpha)})`;
}

function solidFillCss(node: SceneNode): string | undefined {
  if (!("fills" in node)) return undefined;
  const fills = node.fills;
  if (fills === figma.mixed || !Array.isArray(fills)) return undefined;
  for (let i = fills.length - 1; i >= 0; i--) {
    const fill = fills[i];
    if (fill.visible === false) continue;
    if (fill.type === "SOLID") {
      return rgbToCss(fill.color, fill.opacity ?? 1);
    }
  }
  return undefined;
}

function textColorCss(node: TextNode): string | undefined {
  const fills = node.fills;
  if (fills === figma.mixed || !Array.isArray(fills)) return undefined;
  for (let i = fills.length - 1; i >= 0; i--) {
    const fill = fills[i];
    if (fill.visible === false) continue;
    if (fill.type === "SOLID") {
      return rgbToCss(fill.color, fill.opacity ?? 1);
    }
  }
  return undefined;
}

function fontWeightFromStyle(
  style: string | symbol,
): number | string | undefined {
  if (typeof style !== "string") return undefined;
  const s = style.replaceAll(" ", "").replaceAll("-", "").toLowerCase();
  const map: Record<string, number> = {
    thin: 100,
    extralight: 200,
    light: 300,
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    extrabold: 800,
    heavy: 800,
    black: 900,
  };
  return map[s] ?? style;
}

function cornerRadiusSample(node: SceneNode): number | undefined {
  if (node.type === "ELLIPSE") return 9999;
  if ("topLeftRadius" in node) {
    const n = node as RectangleNode;
    if ("cornerRadius" in n && n.cornerRadius !== figma.mixed) {
      const radius = n.cornerRadius;
      return typeof radius === "number" && radius > 0
        ? roundPx(radius)
        : undefined;
    }
    const vals = [
      n.topLeftRadius,
      n.topRightRadius,
      n.bottomRightRadius,
      n.bottomLeftRadius,
    ];
    const max = Math.max(...vals);
    return max > 0 ? roundPx(max) : undefined;
  }
  return undefined;
}

function collectStyles(node: SceneNode): BoundsStyleSample | undefined {
  const styles: BoundsStyleSample = {};

  if (
    "opacity" in node &&
    typeof node.opacity === "number" &&
    node.opacity < 1
  ) {
    styles.opacity = roundPx(node.opacity);
  }

  const bg = solidFillCss(node);
  if (bg) styles.backgroundColor = bg;

  const radius = cornerRadiusSample(node);
  if (radius !== undefined) styles.borderRadius = radius;

  if (node.type === "TEXT") {
    const text = node as TextNode;
    const color = textColorCss(text);
    if (color) styles.color = color;
    if (text.fontSize !== figma.mixed && typeof text.fontSize === "number") {
      styles.fontSize = roundPx(text.fontSize);
    }
    if (text.fontName !== figma.mixed) {
      const weight = fontWeightFromStyle(text.fontName.style);
      if (weight !== undefined) styles.fontWeight = weight;
    }
  }

  return Object.keys(styles).length > 0 ? styles : undefined;
}

function isExportable(node: SceneNode): boolean {
  if (SKIP_TYPES.has(node.type)) return false;
  if (node.visible === false) return false;
  const box = node.absoluteBoundingBox;
  if (!box) return false;
  if (box.width <= 0 && box.height <= 0) return false;
  return true;
}

/**
 * Figma node id → HTML `data-figma-id` value.
 * Colons are valid in HTML attributes; keep the raw id so Measure can join 1:1.
 */
export function figmaIdToDataAttr(id: string): string {
  return id;
}

function resolveArtboard(selection: readonly SceneNode[]): SceneNode | null {
  if (selection.length === 0) return null;
  const first = selection[0];
  // Prefer a FRAME / COMPONENT / INSTANCE as the artboard root.
  if (
    first.type === "FRAME" ||
    first.type === "COMPONENT" ||
    first.type === "INSTANCE" ||
    first.type === "COMPONENT_SET"
  ) {
    return first;
  }
  // Walk up to nearest frame-like ancestor.
  let parent: BaseNode | null = first.parent;
  while (parent && parent.type !== "PAGE" && parent.type !== "DOCUMENT") {
    if (
      parent.type === "FRAME" ||
      parent.type === "COMPONENT" ||
      parent.type === "INSTANCE"
    ) {
      return parent as SceneNode;
    }
    parent = parent.parent;
  }
  return first;
}

function walk(
  node: SceneNode,
  originX: number,
  originY: number,
  out: Record<string, BoundsNode>,
): void {
  if (!isExportable(node)) return;

  const box = node.absoluteBoundingBox!;
  const entry: BoundsNode = {
    x: roundPx(box.x - originX),
    y: roundPx(box.y - originY),
    width: roundPx(box.width),
    height: roundPx(box.height),
    name: node.name,
  };
  const styles = collectStyles(node);
  if (styles) entry.styles = styles;
  out[figmaIdToDataAttr(node.id)] = entry;

  if ("children" in node) {
    for (const child of node.children) {
      walk(child, originX, originY, out);
    }
  }
}

/**
 * Build a BoundsFile from the current selection.
 * Throws a user-facing Error when selection is empty or has no box.
 */
export function exportBoundsFromSelection(
  selection: readonly SceneNode[] = figma.currentPage.selection,
): BoundsFile {
  const artboard = resolveArtboard(selection);
  if (!artboard) {
    throw new Error(
      "Select a frame (or a node inside a frame) to export bounds",
    );
  }
  const rootBox = artboard.absoluteBoundingBox;
  if (!rootBox) {
    throw new Error("Selected node has no absoluteBoundingBox");
  }

  const nodes: Record<string, BoundsNode> = {};
  walk(artboard, rootBox.x, rootBox.y, nodes);

  if (Object.keys(nodes).length === 0) {
    throw new Error("No visible meaningful nodes found under selection");
  }

  return {
    schemaVersion: 1,
    coordinateSpace: "frame-top-left",
    artboard: {
      width: roundPx(rootBox.width),
      height: roundPx(rootBox.height),
    },
    nodes,
  };
}

/** Suggested download filename from artboard name. */
export function boundsFilename(artboardName: string): string {
  const slug = artboardName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "bounds"}.bounds.json`;
}

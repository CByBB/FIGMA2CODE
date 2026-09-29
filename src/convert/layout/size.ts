import { Size } from "types";

export const nodeSize = (node: SceneNode): Size => {
  // Text always exports measured px boxes — HUG would omit size and browsers
  // reflow with different font metrics (breaks pixel-match for rotated glyphs).
  if (node.type === "TEXT") {
    return { width: node.width, height: node.height };
  }

  if ("layoutSizingHorizontal" in node && "layoutSizingVertical" in node) {
    const width =
      node.layoutSizingHorizontal === "FILL"
        ? "fill"
        : node.layoutSizingHorizontal === "HUG"
          ? null
          : node.width;

    const height =
      node.layoutSizingVertical === "FILL"
        ? "fill"
        : node.layoutSizingVertical === "HUG"
          ? null
          : node.height;

    return { width, height };
  }

  return { width: node.width, height: node.height };
};

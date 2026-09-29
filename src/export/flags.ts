/**
 * Propagate ZIP asset metadata onto the converted node tree so HTML generation
 * matches exported files (effects baked, framed images, asset-only SVGs).
 */
import { getCachedAsset } from "./cache";

/** Walk converted nodes and copy cached export flags onto each match (mutates tree). */
export function applyAssetFlagsToTree(nodes: readonly any[]): void {
  const walk = (n: any) => {
    if (!n || typeof n !== "object") return;
    const cached = n.id ? getCachedAsset(n.id) : undefined;
    if (cached) {
      n.effectsBaked = cached.effectsBaked;
      n.imageAssetFramed = cached.imageAssetFramed;
      n.exportAsAsset = true;
      if (cached.layoutWidth != null) n.layoutWidth = cached.layoutWidth;
      if (cached.layoutHeight != null) n.layoutHeight = cached.layoutHeight;
      if (cached.flipHorizontal != null)
        n.flipHorizontal = cached.flipHorizontal;
      if (cached.flipVertical != null) n.flipVertical = cached.flipVertical;
      if (cached.format === "SVG") n.assetOnly = true;
      if (
        cached.format === "PNG" &&
        Array.isArray(n.children) &&
        n.children.length > 0
      ) {
        const fills = n.fills;
        const hasImage =
          Array.isArray(fills) &&
          fills.some((p: { type?: string }) => p && p.type === "IMAGE");
        if (!hasImage) {
          n.assetOnly = true;
          n.canBeFlattened = true;
        }
      }
    }
    if (Array.isArray(n.children)) {
      for (const c of n.children) walk(c);
    }
  };
  for (const n of nodes) walk(n);
}

/** Flip-only fragment; prefer htmlRotation which merges rotate + scale. */
export function framedImageTransformCss(node: any): string {
  const sx = node.flipHorizontal ? -1 : 1;
  const sy = node.flipVertical ? -1 : 1;
  if (sx !== 1 || sy !== 1) return `scale(${sx}, ${sy})`;
  return "";
}

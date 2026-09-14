import { numberToFixedString } from "../css/numbers";
import { formatWithJSX } from "../css/format";

/** Node opacity [0,1] → CSS opacity when not fully opaque. */
export const htmlOpacity = (
  node: MinimalBlendMixin,
  isJsx: boolean,
): string => {
  if (node.opacity !== undefined && node.opacity !== 1) {
    if (isJsx) {
      return `opacity: ${numberToFixedString(node.opacity)}`;
    } else {
      return `opacity: ${numberToFixedString(node.opacity)}`;
    }
  }
  return "";
};

export const htmlBlendMode = (
  node: MinimalBlendMixin,
  isJsx: boolean,
): string => {
  if (node.blendMode !== "NORMAL" && node.blendMode !== "PASS_THROUGH") {
    let blendMode = "";
    switch (node.blendMode) {
      case "MULTIPLY":
        blendMode = "multiply";
        break;
      case "SCREEN":
        blendMode = "screen";
        break;
      case "OVERLAY":
        blendMode = "overlay";
        break;
      case "DARKEN":
        blendMode = "darken";
        break;
      case "LIGHTEN":
        blendMode = "lighten";
        break;
      case "COLOR_DODGE":
        blendMode = "color-dodge";
        break;
      case "COLOR_BURN":
        blendMode = "color-burn";
        break;
      case "HARD_LIGHT":
        blendMode = "hard-light";
        break;
      case "SOFT_LIGHT":
        blendMode = "soft-light";
        break;
      case "DIFFERENCE":
        blendMode = "difference";
        break;
      case "EXCLUSION":
        blendMode = "exclusion";
        break;
      case "HUE":
        blendMode = "hue";
        break;
      case "SATURATION":
        blendMode = "saturation";
        break;
      case "COLOR":
        blendMode = "color";
        break;
      case "LUMINOSITY":
        blendMode = "luminosity";
        break;
    }

    if (blendMode) {
      return formatWithJSX("mix-blend-mode", isJsx, blendMode);
    }
  }
  return "";
};

/**
 * Hidden layers are skipped in generate/toJson; this is a last-resort guard if
 * one still reaches the style builder.
 */
export const htmlVisibility = (
  node: SceneNodeMixin,
  isJsx: boolean,
): string => {
  if (node.visible !== undefined && !node.visible) {
    return formatWithJSX("visibility", isJsx, "hidden");
  }
  return "";
};

/**
 * CSS transform for layout rotation plus asset flips.
 * Rotate and scale must be one `transform` — a second `transform:` overrides the first.
 *
 * Do not combine CSS flips with rotation when using transform-origin top left:
 * rotate(180) + scale(-1,1) shifts the visual AABB (News dog landed 119px right
 * and mirrored). Figma's rotation already places the bitmap; flips alone are OK.
 */
export const getCssRotationDeg = (node: SceneNode): number => {
  const extra = node as SceneNode & { cumulativeRotation?: number };
  const baseRotation =
    "rotation" in node && typeof (node as LayoutMixin).rotation === "number"
      ? (node as LayoutMixin).rotation
      : 0;
  return -Math.round(baseRotation + (extra.cumulativeRotation || 0)) || 0;
};

/**
 * In-flow Auto Layout uses the axis-aligned box; CSS width/height are the
 * pre-rotation box. Without a slot, HUG parents size to ~58px for a 16px-tall
 * vertical FEATURE label and the rotate origin is wrong.
 */
export const getRotationLayoutSlot = (
  node: SceneNode,
): {
  width: number;
  height: number;
  innerLeft: number;
  innerTop: number;
} | null => {
  if (getCssRotationDeg(node) === 0) return null;

  const parent = node.parent;
  if (
    !parent ||
    !("layoutMode" in parent) ||
    !parent.layoutMode ||
    parent.layoutMode === "NONE"
  ) {
    return null;
  }

  // Absolutely positioned nodes already place via left/top from toJson.
  if (
    "layoutPositioning" in node &&
    (node as SceneNode & { layoutPositioning?: string }).layoutPositioning ===
      "ABSOLUTE"
  ) {
    return null;
  }

  const aabb =
    "absoluteBoundingBox" in node
      ? (node as LayoutMixin & { absoluteBoundingBox?: Rect | null })
          .absoluteBoundingBox
      : null;
  const parentBox =
    "absoluteBoundingBox" in parent
      ? (parent as { absoluteBoundingBox?: Rect | null }).absoluteBoundingBox
      : null;
  if (!aabb || !parentBox) return null;

  const aabbRelX = aabb.x - parentBox.x;
  const aabbRelY = aabb.y - parentBox.y;
  const nodeX = typeof node.x === "number" ? node.x : aabbRelX;
  const nodeY = typeof node.y === "number" ? node.y : aabbRelY;

  return {
    width: Math.max(1, aabb.width || 0),
    height: Math.max(1, aabb.height || 0),
    innerLeft: nodeX - aabbRelX,
    innerTop: nodeY - aabbRelY,
  };
};

export const htmlRotation = (node: SceneNode, isJsx: boolean): string[] => {
  const extra = node as SceneNode & {
    flipHorizontal?: boolean;
    flipVertical?: boolean;
  };
  const rotation = getCssRotationDeg(node);
  let sx = extra.flipHorizontal ? -1 : 1;
  let sy = extra.flipVertical ? -1 : 1;
  if (rotation !== 0) {
    sx = 1;
    sy = 1;
  }

  const parts: string[] = [];
  if (rotation !== 0) {
    parts.push(`rotate(${numberToFixedString(rotation)}deg)`);
  }
  if (sx !== 1 || sy !== 1) {
    parts.push(`scale(${sx}, ${sy})`);
  }
  if (parts.length === 0) return [];

  const styles = [formatWithJSX("transform", isJsx, parts.join(" "))];
  if (rotation !== 0) {
    styles.push(formatWithJSX("transform-origin", isJsx, "top left"));
  }
  return styles;
};

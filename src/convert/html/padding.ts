import { commonPadding } from "../layout/padding";
import { formatWithJSX } from "../css/format";

/**
 * Figma width/height already include padding. Without border-box, padded
 * sections grow past the page flex height, flex-shrink compresses siblings,
 * and absolute children (e.g. Kindergarten blobs) drift into the next section.
 */
const withBorderBox = (styles: string[], isJsx: boolean): string[] => {
  if (styles.length === 0) return styles;
  return [formatWithJSX("box-sizing", isJsx, "border-box"), ...styles];
};

type Sides = { top: number; right: number; bottom: number; left: number };

function paddingSides(
  padding: NonNullable<ReturnType<typeof commonPadding>>,
): Sides {
  if ("all" in padding) {
    return {
      top: padding.all,
      right: padding.all,
      bottom: padding.all,
      left: padding.all,
    };
  }
  if ("horizontal" in padding) {
    return {
      top: padding.vertical,
      right: padding.horizontal,
      bottom: padding.vertical,
      left: padding.horizontal,
    };
  }
  return {
    top: padding.top,
    right: padding.right,
    bottom: padding.bottom,
    left: padding.left,
  };
}

/**
 * HTML→Figma imports often bake hit-area into FIXED frames as paddingBottom ≈
 * height (test5 Link 182px with pb 181.8; footer column 7236 with pb 7236).
 * Under border-box that leaves a ~0px content box and crushes/clips children.
 * Drop axis padding that consumes ≥85% of the layout size.
 */
function sanitizeImportPadding(
  node: InferredAutoLayoutResult,
  padding: NonNullable<ReturnType<typeof commonPadding>>,
): NonNullable<ReturnType<typeof commonPadding>> | null {
  const sides = paddingSides(padding);
  const layout = node as InferredAutoLayoutResult & {
    height?: number;
    width?: number;
    absoluteBoundingBox?: Rect | null;
  };
  const h =
    typeof layout.height === "number"
      ? Math.abs(layout.height)
      : Math.abs(layout.absoluteBoundingBox?.height ?? 0);
  const w =
    typeof layout.width === "number"
      ? Math.abs(layout.width)
      : Math.abs(layout.absoluteBoundingBox?.width ?? 0);

  let { top, right, bottom, left } = sides;
  if (h > 1 && top + bottom >= h * 0.85) {
    top = 0;
    bottom = 0;
  }
  if (w > 1 && left + right >= w * 0.85) {
    left = 0;
    right = 0;
  }
  if (top === 0 && right === 0 && bottom === 0 && left === 0) return null;

  if (left === right && left === bottom && top === bottom) {
    return { all: left };
  }
  if (left === right && top === bottom) {
    return { horizontal: left, vertical: top };
  }
  return { top, right, bottom, left };
}

export const htmlPadding = (
  node: InferredAutoLayoutResult,
  isJsx: boolean,
): string[] => {
  const raw = commonPadding(node);
  if (raw === null) {
    return [];
  }
  const padding = sanitizeImportPadding(node, raw);
  if (padding === null) {
    return [];
  }

  if ("all" in padding) {
    if (padding.all !== 0) {
      return withBorderBox(
        [formatWithJSX("padding", isJsx, padding.all)],
        isJsx,
      );
    } else {
      return [];
    }
  }

  let comp: string[] = [];

  // Figma paired horizontal/vertical padding → four CSS sides.
  if ("horizontal" in padding) {
    if (padding.horizontal !== 0) {
      comp.push(formatWithJSX("padding-left", isJsx, padding.horizontal));
      comp.push(formatWithJSX("padding-right", isJsx, padding.horizontal));
    }
    if (padding.vertical !== 0) {
      comp.push(formatWithJSX("padding-top", isJsx, padding.vertical));
      comp.push(formatWithJSX("padding-bottom", isJsx, padding.vertical));
    }
    return withBorderBox(comp, isJsx);
  }

  if (padding.top !== 0) {
    comp.push(formatWithJSX("padding-top", isJsx, padding.top));
  }
  if (padding.bottom !== 0) {
    comp.push(formatWithJSX("padding-bottom", isJsx, padding.bottom));
  }
  if (padding.left !== 0) {
    comp.push(formatWithJSX("padding-left", isJsx, padding.left));
  }
  if (padding.right !== 0) {
    comp.push(formatWithJSX("padding-right", isJsx, padding.right));
  }

  return withBorderBox(comp, isJsx);
};

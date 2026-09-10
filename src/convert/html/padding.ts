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

export const htmlPadding = (
  node: InferredAutoLayoutResult,
  isJsx: boolean,
): string[] => {
  const padding = commonPadding(node);
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

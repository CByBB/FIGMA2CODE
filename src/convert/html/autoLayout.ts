import { formatMultipleJSXArray, formatWithJSX } from "../css/format";
import { numberToFixedString } from "../css/numbers";

const getFlexDirection = (node: InferredAutoLayoutResult): string =>
  node.layoutMode === "HORIZONTAL" ? "" : "column";

const getJustifyContent = (node: InferredAutoLayoutResult): string => {
  switch (node.primaryAxisAlignItems) {
    case undefined:
    case "MIN":
      return "flex-start";
    case "CENTER":
      return "center";
    case "MAX":
      return "flex-end";
    case "SPACE_BETWEEN":
      return "space-between";
  }
};

const getAlignItems = (node: InferredAutoLayoutResult): string => {
  switch (node.counterAxisAlignItems) {
    case undefined:
    case "MIN":
      return "flex-start";
    case "CENTER":
      return "center";
    case "MAX":
      return "flex-end";
    case "BASELINE":
      return "baseline";
  }
};

const getGap = (node: InferredAutoLayoutResult): string | number =>
  node.itemSpacing > 0 && node.primaryAxisAlignItems !== "SPACE_BETWEEN"
    ? node.itemSpacing
    : "";

const getFlexWrap = (node: InferredAutoLayoutResult): string =>
  node.layoutWrap === "WRAP" ? "wrap" : "";

const getAlignContent = (node: InferredAutoLayoutResult): string => {
  if (node.layoutWrap !== "WRAP") return "";

  switch (node.counterAxisAlignItems) {
    case undefined:
    case "MIN":
      return "flex-start";
    case "CENTER":
      return "center";
    case "MAX":
      return "flex-end";
    case "BASELINE":
      return "baseline";
    default:
      return "normal";
  }
};

const getFlex = (
  node: SceneNode,
  autoLayout: InferredAutoLayoutResult,
): string =>
  node.parent &&
  "layoutMode" in node.parent &&
  node.parent.layoutMode === autoLayout.layoutMode
    ? "flex"
    : "inline-flex";

type GridLayoutNode = SceneNode &
  InferredAutoLayoutResult & {
    gridColumnCount?: number;
    gridRowCount?: number;
    gridColumnGap?: number;
    gridRowGap?: number;
    /** REST / JSON export already has a CSS track list. */
    gridColumnsSizing?: string;
    gridRowsSizing?: string;
    gridColumnSizes?: ReadonlyArray<{ type: string; value?: number }>;
    gridRowSizes?: ReadonlyArray<{ type: string; value?: number }>;
  };

const tracksFromSizes = (
  sizes: ReadonlyArray<{ type: string; value?: number }> | undefined,
  count: number,
  fallback: string,
): string => {
  if (sizes && sizes.length > 0) {
    return sizes
      .map((t) =>
        t.type === "FIXED" && typeof t.value === "number"
          ? `${numberToFixedString(t.value)}px`
          : "minmax(0, 1fr)",
      )
      .join(" ");
  }
  if (count > 0) {
    return `repeat(${count}, ${fallback})`;
  }
  return "";
};

const htmlGridLayoutProps = (node: GridLayoutNode): string[] => {
  const columns =
    (typeof node.gridColumnsSizing === "string" &&
      node.gridColumnsSizing.trim()) ||
    tracksFromSizes(
      node.gridColumnSizes,
      node.gridColumnCount ?? 0,
      "minmax(0, 1fr)",
    );
  const rows =
    (typeof node.gridRowsSizing === "string" && node.gridRowsSizing.trim()) ||
    tracksFromSizes(node.gridRowSizes, node.gridRowCount ?? 0, "auto");

  // HUG grid children must not stretch to the track height — that paints white
  // over the parent fill that forms the bottom/gutter bars (Services cards).
  const styles: Record<string, string | number> = {
    display: "grid",
    "grid-template-columns": columns,
    "grid-template-rows": rows,
    "justify-items": "stretch",
    "align-items": "start",
  };

  if (typeof node.gridColumnGap === "number" && node.gridColumnGap > 0) {
    styles["column-gap"] = node.gridColumnGap;
  }
  if (typeof node.gridRowGap === "number" && node.gridRowGap > 0) {
    styles["row-gap"] = node.gridRowGap;
  }

  return formatMultipleJSXArray(styles, false);
};

export const htmlAutoLayoutProps = (
  node: SceneNode & InferredAutoLayoutResult,
): string[] => {
  if (node.layoutMode === "GRID") {
    return htmlGridLayoutProps(node as GridLayoutNode);
  }

  return formatMultipleJSXArray(
    {
      "flex-direction": getFlexDirection(node),
      "justify-content": getJustifyContent(node),
      "align-items": getAlignItems(node),
      gap: getGap(node),
      display: getFlex(node, node),
      "flex-wrap": getFlexWrap(node),
      "align-content": getAlignContent(node),
    },
    false,
  );
};

/** Explicit cell placement for children of Figma GRID frames. */
export const htmlGridChildProps = (node: SceneNode): string[] => {
  const parent = node.parent;
  if (!parent || !("layoutMode" in parent) || parent.layoutMode !== "GRID") {
    return [];
  }

  const n = node as SceneNode & {
    gridColumnAnchorIndex?: number;
    gridColumnSpan?: number;
    gridRowAnchorIndex?: number;
    gridRowSpan?: number;
  };

  const styles: string[] = [];
  if (typeof n.gridColumnAnchorIndex === "number") {
    const span =
      typeof n.gridColumnSpan === "number" && n.gridColumnSpan > 0
        ? n.gridColumnSpan
        : 1;
    styles.push(
      formatWithJSX(
        "grid-column",
        false,
        `${n.gridColumnAnchorIndex + 1} / span ${span}`,
      ),
    );
  }
  if (typeof n.gridRowAnchorIndex === "number") {
    const span =
      typeof n.gridRowSpan === "number" && n.gridRowSpan > 0
        ? n.gridRowSpan
        : 1;
    styles.push(
      formatWithJSX(
        "grid-row",
        false,
        `${n.gridRowAnchorIndex + 1} / span ${span}`,
      ),
    );
  }
  return styles;
};

import { indentString } from "../css/indent";
import { HtmlTextBuilder } from "./TextBuilder";
import { HtmlDefaultBuilder } from "./DefaultBuilder";
import { htmlAutoLayoutProps } from "./autoLayout";
import { formatWithJSX } from "../css/format";
import {
  PluginSettings,
  HTMLPreview,
  PluginAltNode,
  HTMLSettings,
  ExportableNode,
} from "types";
import { renderAndAttachSVG } from "../nodes/svg";
import { getVisibleNodes } from "../layout/visibility";
import {
  exportNodeAsBase64PNG,
  getPlaceholderImage,
  nodeHasImageFill,
} from "../media/images";
import { addWarning } from "../warnings";
import { getCachedAsset } from "../../export/cache";
import {
  getRotationLayoutSlot,
  getCssRotationDeg,
  clearSvgAssetFlips,
} from "./blend";

// Walk enriched alt-nodes and emit HTML/CSS strings for preview or ZIP index.html.
const selfClosingTags = ["img"];

export let isPreviewGlobal = false;

let previousExecutionCache: { style: string; text: string }[] = [];

export interface HtmlOutput {
  html: string;
  css?: string;
}

export const htmlMain = async (
  sceneNode: Array<SceneNode>,
  settings: PluginSettings,
  isPreview: boolean = false,
): Promise<HtmlOutput> => {
  isPreviewGlobal = isPreview;
  previousExecutionCache = [];

  let htmlContent = await htmlWidgetGenerator(sceneNode, settings);

  // htmlContainer prefixes output with a newline for indentation.
  if (htmlContent.length > 0 && htmlContent.startsWith("\n")) {
    htmlContent = htmlContent.slice(1, htmlContent.length);
  }

  return { html: htmlContent };
};

export const generateHTMLPreview = async (
  nodes: SceneNode[],
  settings: PluginSettings,
): Promise<HTMLPreview> => {
  let result = await htmlMain(nodes, settings, nodes.length > 1 ? false : true);

  if (nodes.length > 1) {
    result.html = `<div style="width: 100%; height: 100%">${result.html}</div>`;
  }

  return {
    size: {
      width: Math.max(...nodes.map((node) => node.width)),
      height: nodes.reduce((sum, node) => sum + node.height, 0),
    },
    content: result.html,
  };
};

const htmlWidgetGenerator = async (
  sceneNode: ReadonlyArray<SceneNode>,
  settings: HTMLSettings,
): Promise<string> => {
  // Visibility was already handled in toJson; this catches nodes hidden after enrichment.
  const promiseOfConvertedCode = getVisibleNodes(sceneNode).map(
    convertNode(settings),
  );
  const code = (await Promise.all(promiseOfConvertedCode)).join("");
  return code;
};

const convertNode = (settings: HTMLSettings) => async (node: SceneNode) => {
  // Hidden layers are never worth emitting — skip before SVG/cache work.
  if (node.visible === false) {
    return "";
  }

  // Prefer baked SVG from ZIP cache (gradient text, icon instances, effect-heavy
  // vectors, and assetOnly RECTANGLE/ELLIPSE — e.g. Overlay+Shadow drop shadows).
  // Plugin API uses POLYGON; REST / enriched alt-nodes may still say REGULAR_POLYGON.
  const cachedSvg = node.id ? getCachedAsset(node.id) : undefined;
  const nodeType = node.type as string;
  // Flattened illustration (mask groups, vector-heavy clusters) exported as PNG.
  // Do not swallow image-fill frames that still have child layers.
  // Use layout AABB (not renderBounds) so left/top match the Figma frame box.
  if (
    cachedSvg?.format === "PNG" &&
    cachedSvg.path &&
    settings.relativeAssetPaths &&
    "children" in node &&
    Array.isArray((node as SceneNode & ChildrenMixin).children) &&
    (node as SceneNode & ChildrenMixin).children.length > 0 &&
    (nodeType === "FRAME" ||
      nodeType === "GROUP" ||
      nodeType === "COMPONENT" ||
      nodeType === "INSTANCE") &&
    !("fills" in node && nodeHasImageFill(node))
  ) {
    return htmlWrapCompositePng(node, settings, cachedSvg.path);
  }
  if (
    settings.embedVectors &&
    cachedSvg?.format === "SVG" &&
    ((node as any).canBeFlattened ||
      (node as any).assetOnly ||
      nodeType === "VECTOR" ||
      nodeType === "BOOLEAN_OPERATION" ||
      nodeType === "STAR" ||
      nodeType === "LINE" ||
      nodeType === "POLYGON" ||
      nodeType === "REGULAR_POLYGON" ||
      nodeType === "INSTANCE" ||
      nodeType === "COMPONENT" ||
      nodeType === "TEXT" ||
      nodeType === "RECTANGLE" ||
      nodeType === "ELLIPSE")
  ) {
    (node as any).canBeFlattened = true;
    // Static ZIP / relative paths: always <img src="assets/..."> — never inline SVG.
    if (settings.relativeAssetPaths && cachedSvg.path) {
      return htmlWrapSVGFile(node, settings, cachedSvg.path);
    }
    if (!settings.relativeAssetPaths) {
      const altNode = await renderAndAttachSVG(node);
      if (altNode.svg) {
        return htmlWrapSVG(altNode, settings);
      }
    }
  }

  if (settings.embedVectors && (node as any).canBeFlattened) {
    if (settings.relativeAssetPaths && cachedSvg?.path) {
      return htmlWrapSVGFile(node, settings, cachedSvg.path);
    }
    if (settings.relativeAssetPaths) {
      addWarning(
        `Missing SVG asset for “${node.name || node.id}” (could not write assets/*.svg; layer skipped)`,
      );
      return "";
    }
    const altNode = await renderAndAttachSVG(node);
    if (altNode.svg) {
      return htmlWrapSVG(altNode, settings);
    }
  }

  // Vector primitives with relative asset paths must use files, not empty CSS boxes.
  if (
    settings.relativeAssetPaths &&
    settings.embedVectors &&
    (nodeType === "VECTOR" ||
      nodeType === "BOOLEAN_OPERATION" ||
      nodeType === "STAR" ||
      nodeType === "POLYGON" ||
      nodeType === "REGULAR_POLYGON")
  ) {
    if (cachedSvg?.path) {
      return htmlWrapSVGFile(node, settings, cachedSvg.path);
    }
    addWarning(`Missing SVG asset for ${node.name || node.id}`);
    return "";
  }

  switch ((node as any).type) {
    case "RECTANGLE":
    case "ELLIPSE":
      return await htmlContainer(node as any, "", [], settings);
    case "GROUP":
      return await htmlGroup(node as GroupNode, settings);
    case "FRAME":
    case "COMPONENT":
    case "INSTANCE":
    case "COMPONENT_SET":
    case "SLOT":
      return await htmlFrame(node as SceneNode & BaseFrameMixin, settings);
    case "SECTION":
      return await htmlSection(node as SectionNode, settings);
    case "TEXT":
      return htmlText(node as TextNode, settings);
    case "LINE":
      return htmlLine(node as LineNode, settings);
    case "VECTOR":
    case "STAR":
    case "POLYGON":
    case "REGULAR_POLYGON":
    case "BOOLEAN_OPERATION":
      if (!settings.embedVectors && !isPreviewGlobal) {
        addWarning(`${node.type} is not supported without Embed Vectors`);
      }
      return await htmlContainer(
        { ...node, type: "RECTANGLE" } as any,
        "",
        [],
        settings,
      );
    default:
      addWarning(`${node.type} node is not supported`);
      return "";
  }
};

const htmlWrapSVG = (
  node: PluginAltNode<SceneNode>,
  settings: HTMLSettings,
): string => {
  if (node.svg === "") return "";

  const builder = new HtmlDefaultBuilder(node, settings)
    .addData("svg-wrapper")
    .position();

  return `\n<div${builder.build()}>\n${indentString(node.svg ?? "")}</div>`;
};

/**
 * Size/position SVG <img> from absoluteRenderBounds when paint *overflows* the
 * layout AABB (LINE strokes, DROP_SHADOW filters). Figma SVG export is already
 * screen-oriented to that box; using AABB alone clips shadows or squashes lines.
 *
 * Do NOT use renderBounds when it is smaller than the AABB — that usually means
 * an ancestor `clipsContent` shrank the visible paint (Hero/Skills red terrain
 * AABB 1163×402 vs renderBounds 1163×95). Sizing to the clipped box squashes the
 * full SVG into a flat strip; keep the AABB and let CSS `overflow: hidden` clip.
 */
const svgFileLayoutNode = (node: SceneNode): SceneNode => {
  const n = node as SceneNode & {
    absoluteRenderBounds?: Rect | null;
    absoluteBoundingBox?: Rect | null;
    cumulativeRotation?: number;
  };
  const aabb = n.absoluteBoundingBox;
  const box =
    node.type === "LINE"
      ? n.absoluteRenderBounds || aabb
      : n.absoluteRenderBounds;
  if (!box) return node;

  if (node.type !== "LINE" && aabb) {
    const sameBox =
      Math.abs(box.width - aabb.width) < 0.5 &&
      Math.abs(box.height - aabb.height) < 0.5 &&
      Math.abs(box.x - aabb.x) < 0.5 &&
      Math.abs(box.y - aabb.y) < 0.5;
    if (sameBox) return node;

    // Ancestor clip: renderBounds is a subset of the layout box.
    const clippedSubset =
      box.x >= aabb.x - 0.5 &&
      box.y >= aabb.y - 0.5 &&
      box.x + box.width <= aabb.x + aabb.width + 0.5 &&
      box.y + box.height <= aabb.y + aabb.height + 0.5 &&
      (box.width < aabb.width - 0.5 || box.height < aabb.height - 0.5);
    if (clippedSubset) return node;
  }

  const parentBox =
    node.parent && "absoluteBoundingBox" in node.parent
      ? (node.parent as { absoluteBoundingBox?: Rect | null })
          .absoluteBoundingBox
      : null;

  return {
    ...node,
    width: Math.max(1, box.width || 0),
    height: Math.max(1, box.height || 0),
    x: parentBox ? box.x - parentBox.x : n.x,
    y: parentBox ? box.y - parentBox.y : n.y,
    ...(node.type === "LINE"
      ? { rotation: 0, cumulativeRotation: 0 }
      : { absoluteBoundingBox: box }),
  } as SceneNode;
};

/**
 * Image-fill PNGs from exportAsync include drop shadows in the bitmap
 * (renderBounds), but node.width/height stay on the layout AABB. Sizing the
 * <img> to the AABB (e.g. Hero Portrait 439×685 vs PNG 499×745) squashes the
 * subject and shifts it down/sideways vs Figma.
 *
 * Do NOT use renderBounds when it is smaller than the AABB — that is usually
 * an ancestor clip (test5 `k-top__bg_route` 1920×574 frame, renderBounds
 * 1472×574). PNG export is still the full frame; sizing to the clipped box
 * horizontally squashes the wavy divider vs design.
 */
const imageFillLayoutNode = (node: SceneNode): SceneNode => {
  if (!("fills" in node) || !nodeHasImageFill(node)) return node;
  if (
    "children" in node &&
    Array.isArray(node.children) &&
    node.children.length > 0
  ) {
    return node;
  }

  const n = node as SceneNode & {
    absoluteRenderBounds?: Rect | null;
    absoluteBoundingBox?: Rect | null;
  };
  const box = n.absoluteRenderBounds;
  const aabb = n.absoluteBoundingBox;
  if (!box || !aabb) return node;

  if (
    Math.abs(box.width - aabb.width) < 0.5 &&
    Math.abs(box.height - aabb.height) < 0.5 &&
    Math.abs(box.x - aabb.x) < 0.5 &&
    Math.abs(box.y - aabb.y) < 0.5
  ) {
    return node;
  }

  // Ancestor clip: renderBounds is a subset of the layout box (same as SVG).
  const clippedSubset =
    box.x >= aabb.x - 0.5 &&
    box.y >= aabb.y - 0.5 &&
    box.x + box.width <= aabb.x + aabb.width + 0.5 &&
    box.y + box.height <= aabb.y + aabb.height + 0.5 &&
    (box.width < aabb.width - 0.5 || box.height < aabb.height - 0.5);
  if (clippedSubset) return node;

  const parentBox =
    node.parent && "absoluteBoundingBox" in node.parent
      ? (node.parent as { absoluteBoundingBox?: Rect | null })
          .absoluteBoundingBox
      : null;

  return {
    ...node,
    width: Math.max(1, box.width || 0),
    height: Math.max(1, box.height || 0),
    x: parentBox ? box.x - parentBox.x : n.x,
    y: parentBox ? box.y - parentBox.y : n.y,
    absoluteBoundingBox: box,
  } as SceneNode;
};

/**
 * exportAsync SVG is screen-oriented (rotation and flips are in the path,
 * viewBox is the layout box). CSS rotate()/scale() on top, using the
 * pre-rotation anchor, swings that art past the section edge — Skills Group 21
 * cream cliff (514:7598) lands on rotate(180) at left:323 and overflow:hidden
 * slices it into a vertical cut.
 * Place the file on the AABB and drop the extra transform.
 */
const screenOrientedSvgNode = (node: SceneNode): SceneNode => {
  const n = node as SceneNode & {
    flipHorizontal?: boolean;
    flipVertical?: boolean;
    cumulativeRotation?: number;
    absoluteBoundingBox?: Rect | null;
  };
  const deg = getCssRotationDeg(n);
  const flipped = n.flipHorizontal === true || n.flipVertical === true;
  if (deg === 0 && !flipped) return node;

  const parentBox =
    node.parent && "absoluteBoundingBox" in node.parent
      ? (node.parent as { absoluteBoundingBox?: Rect | null })
          .absoluteBoundingBox
      : null;
  const aabb = n.absoluteBoundingBox;
  return {
    ...node,
    rotation: 0,
    cumulativeRotation: 0,
    flipHorizontal: false,
    flipVertical: false,
    ...(parentBox && aabb
      ? { x: aabb.x - parentBox.x, y: aabb.y - parentBox.y }
      : {}),
  } as SceneNode;
};

/** ZIP index.html: reference a pre-exported SVG under assets/ rather than inlining. */
const htmlWrapSVGFile = (
  node: SceneNode,
  settings: HTMLSettings,
  assetPath: string,
): string => {
  const layoutNode = screenOrientedSvgNode(svgFileLayoutNode(node));
  const builder = new HtmlDefaultBuilder(layoutNode, settings)
    .addData("svg-wrapper")
    .commonPositionStyles();

  const extra = [formatWithJSX("display", false, "block")];
  const alt =
    node.type === "TEXT" && "characters" in node
      ? String((node as TextNode).characters)
          .replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;")
          .replace(/</g, "&lt;")
      : "";

  return `\n<img${builder.build(extra)} src="${assetPath}" alt="${alt}" />`;
};

/**
 * Rasterized frame/group composites must keep the layout AABB. Using
 * absoluteRenderBounds (overflow) places a huge img at the wrong origin —
 * e.g. Mask group 519×493 at (584,569) became 1103×1061 at (0,0).
 */
const htmlWrapCompositePng = (
  node: SceneNode,
  settings: HTMLSettings,
  assetPath: string,
): string => {
  const builder = new HtmlDefaultBuilder(node, settings)
    .addData("svg-wrapper")
    .commonPositionStyles();
  const extra = [formatWithJSX("display", false, "block")];
  return `\n<img${builder.build(extra)} src="${assetPath}" alt="" />`;
};

const htmlGroup = async (
  node: GroupNode,
  settings: HTMLSettings,
): Promise<string> => {
  // Skip degenerate groups (rounding can yield negative dimensions).
  if (node.width < 0 || node.height <= 0 || node.children.length === 0) {
    return "";
  }

  // SVG export already contains flips; a CSS scale would double-mirror.
  clearSvgAssetFlips(node);

  // commonPositionStyles must run before child layout (width/height depend on positioning mode).
  const builder = new HtmlDefaultBuilder(node, settings).commonPositionStyles();

  if (builder.styles) {
    const attr = builder.build();
    const generator = await htmlWidgetGenerator(node.children, settings);
    return `\n<div${attr}>${indentString(generator)}\n</div>`;
  }
  return await htmlWidgetGenerator(node.children, settings);
};

const htmlText = (node: TextNode, settings: HTMLSettings): string => {
  const layoutBuilder = new HtmlTextBuilder(node, settings)
    .commonPositionStyles()
    .textTrim()
    .textAlignHorizontal()
    .textAlignVertical();

  const styledHtml = layoutBuilder.getTextSegments(node);
  previousExecutionCache.push(...styledHtml);

  let content = "";
  if (styledHtml.length === 1) {
    layoutBuilder.addStyles(styledHtml[0].style);
    content = styledHtml[0].text;

    const additionalTag =
      styledHtml[0].openTypeFeatures.SUBS === true
        ? "sub"
        : styledHtml[0].openTypeFeatures.SUPS === true
          ? "sup"
          : "";

    if (additionalTag) {
      content = `<${additionalTag}>${content}</${additionalTag}>`;
    }
  } else {
    content = styledHtml
      .map((style) => {
        const tag =
          style.openTypeFeatures.SUBS === true
            ? "sub"
            : style.openTypeFeatures.SUPS === true
              ? "sup"
              : "span";

        return `<${tag} style="${style.style}">${style.text}</${tag}>`;
      })
      .join("");
  }

  // Keep mixed-size inline runs as one flex item under vertical align.
  if (
    (layoutBuilder as { _wrapTextForVerticalAlign?: boolean })
      ._wrapTextForVerticalAlign &&
    content
  ) {
    content = `<span style="display: block; width: 100%; min-width: 0">${content}</span>`;
  }

  // In-flow rotated text (FEATURE 01): reserve the AABB slot so HUG parents
  // size correctly; absolutely place the pre-rotation box inside for rotate().
  const rotSlot = getRotationLayoutSlot(node);
  if (rotSlot) {
    layoutBuilder.addStyles(
      formatWithJSX("left", false, rotSlot.innerLeft),
      formatWithJSX("top", false, rotSlot.innerTop),
      formatWithJSX("position", false, "absolute"),
    );
    const slotStyle = [
      formatWithJSX("width", false, rotSlot.width),
      formatWithJSX("height", false, rotSlot.height),
      formatWithJSX("position", false, "relative"),
      formatWithJSX("flex-shrink", false, "0"),
    ].join("; ");
    return `\n<div style="${slotStyle}">\n${indentString(`<div${layoutBuilder.build()}>${content}</div>`)}\n</div>`;
  }

  return `\n<div${layoutBuilder.build()}>${content}</div>`;
};

const htmlFrame = async (
  node: SceneNode & BaseFrameMixin,
  settings: HTMLSettings,
): Promise<string> => {
  // Reflection groups (terrain+torii): SVG files already bake the flip.
  clearSvgAssetFlips(node);

  const childrenStr = await htmlWidgetGenerator(node.children, settings);

  if (node.layoutMode !== "NONE") {
    const rowColumn = htmlAutoLayoutProps(node);
    return await htmlContainer(node, childrenStr, rowColumn, settings);
  }

  // layoutMode NONE with multiple children → absolute positioning inside container.
  return await htmlContainer(node, childrenStr, [], settings);
};

const htmlContainer = async (
  node: SceneNode &
    SceneNodeMixin &
    BlendMixin &
    LayoutMixin &
    GeometryMixin &
    MinimalBlendMixin,
  children: string,
  additionalStyles: string[] = [],
  settings: HTMLSettings,
): Promise<string> => {
  if (node.width <= 0 || node.height <= 0) {
    return children;
  }

  const layoutNode = imageFillLayoutNode(node);
  const builder = new HtmlDefaultBuilder(layoutNode, settings)
    .commonPositionStyles()
    .commonShapeStyles();

  if (builder.styles || additionalStyles) {
    let tag = "div";
    let src = "";

    if ("fills" in layoutNode && nodeHasImageFill(layoutNode)) {
      const altNode = layoutNode as PluginAltNode<ExportableNode>;
      const hasChildren =
        "children" in layoutNode &&
        Array.isArray((layoutNode as SceneNode & ChildrenMixin).children) &&
        (layoutNode as SceneNode & ChildrenMixin).children.length > 0;
      let imgUrl = "";

      if (settings.embedImages) {
        imgUrl =
          (await exportNodeAsBase64PNG(altNode, hasChildren, {
            relativeAssetPaths: settings.relativeAssetPaths,
          })) ?? "";
      } else {
        imgUrl = getPlaceholderImage(layoutNode.width, layoutNode.height);
      }

      if (hasChildren) {
        builder.addStyles(
          formatWithJSX("background-image", false, `url(${imgUrl})`),
        );
      } else {
        tag = "img";
        src = ` src="${imgUrl}"`;
        // Flip scale is already in htmlRotation via commonPositionStyles → blend.
      }
    }

    const build = builder.build(additionalStyles);

    if (children) {
      return `\n<${tag}${build}${src}>${indentString(children)}\n</${tag}>`;
    } else if (selfClosingTags.includes(tag)) {
      return `\n<${tag}${build}${src} />`;
    } else {
      return `\n<${tag}${build}${src}></${tag}>`;
    }
  }

  return children;
};

const htmlSection = async (
  node: SectionNode,
  settings: HTMLSettings,
): Promise<string> => {
  const childrenStr = await htmlWidgetGenerator(node.children, settings);
  const builder = new HtmlDefaultBuilder(node, settings)
    .size()
    .position()
    .applyFillsToStyle(node.fills, "background");

  if (childrenStr) {
    return `\n<div${builder.build()}>${indentString(childrenStr)}\n</div>`;
  } else {
    return `\n<div${builder.build()}></div>`;
  }
};

const htmlLine = (node: LineNode, settings: HTMLSettings): string => {
  const builder = new HtmlDefaultBuilder(node, settings)
    .commonPositionStyles()
    .commonShapeStyles();

  return `\n<div${builder.build()}></div>`;
};

export const htmlCodeGenTextStyles = (_settings?: HTMLSettings) => {
  const result = previousExecutionCache
    .map((style) => `// ${style.text}\n${style.style.split(";").join(";\n")}`)
    .join("\n---\n");

  if (!result) {
    return "// No text styles in this selection";
  }
  return result;
};

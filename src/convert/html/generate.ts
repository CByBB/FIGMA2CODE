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
import { getRotationLayoutSlot } from "./blend";

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
    // Static ZIP: <img src="assets/..."> instead of inlined SVG markup.
    if (settings.relativeAssetPaths && cachedSvg.path) {
      return htmlWrapSVGFile(node, settings, cachedSvg.path);
    }
    const altNode = await renderAndAttachSVG(node);
    if (altNode.svg) {
      return htmlWrapSVG(altNode, settings);
    }
  }

  if (settings.embedVectors && (node as any).canBeFlattened) {
    if (settings.relativeAssetPaths && cachedSvg?.path) {
      return htmlWrapSVGFile(node, settings, cachedSvg.path);
    }
    const altNode = await renderAndAttachSVG(node);
    if (altNode.svg) {
      return htmlWrapSVG(altNode, settings);
    }
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
 * Size/position SVG <img> from absoluteRenderBounds when paint overflows the
 * layout AABB (LINE strokes, DROP_SHADOW filters). Figma SVG export is already
 * screen-oriented to that box; using AABB alone clips shadows or squashes lines.
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

/** ZIP index.html: reference a pre-exported SVG under assets/ rather than inlining. */
const htmlWrapSVGFile = (
  node: SceneNode,
  settings: HTMLSettings,
  assetPath: string,
): string => {
  const layoutNode = svgFileLayoutNode(node);
  const builder = new HtmlDefaultBuilder(layoutNode, settings)
    .addData("svg-wrapper")
    .commonPositionStyles();

  // Flips are emitted with rotation in htmlRotation (single transform).
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

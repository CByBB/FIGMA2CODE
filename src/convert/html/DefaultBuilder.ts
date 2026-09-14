// Builds style/data attributes for a single node (position, fills, borders, shadows).
import { formatWithJSX } from "../css/format";
import { htmlShadow } from "./shadow";
import {
  htmlVisibility,
  htmlRotation,
  htmlOpacity,
  htmlBlendMode,
} from "./blend";
import { buildBackgroundValues, htmlColorFromFills } from "./color";
import { htmlPadding } from "./padding";
import { htmlSizePartial } from "./size";
import { htmlBorderRadius } from "./borderRadius";
import { htmlGridChildProps } from "./autoLayout";
import {
  commonIsAbsolutePosition,
  getCommonPositionValue,
} from "../layout/position";
import {
  commonLetterSpacing,
  commonLineHeight,
  textBoxLooksMultiline,
  textContentExceedsLayoutWidth,
} from "../layout/text";
import { textOverflowsLayoutBox } from "../layout/bakeLines";
import { numberToFixedString, stringToClassName } from "../css/numbers";
import {
  formatClassAttribute,
  formatDataAttribute,
  formatStyleAttribute,
} from "../css/attributes";
import { commonStroke } from "../layout/stroke";
import { HTMLSettings } from "types";

export class HtmlDefaultBuilder {
  styles: Array<string>;
  data: Array<string>;
  node: SceneNode;
  settings: HTMLSettings;

  get name() {
    return this.settings.showLayerNames ? this.node.name : "";
  }

  get visible() {
    return this.node.visible;
  }

  get isJSX() {
    return false;
  }

  get htmlElement(): string {
    if (this.node.type === "TEXT") return "p";
    return "div";
  }

  constructor(node: SceneNode, settings: HTMLSettings) {
    this.node = node;
    this.settings = settings;
    this.styles = [];
    this.data = [];
  }

  commonPositionStyles(): this {
    this.size();
    this.autoLayoutPadding();
    this.position();
    this.gridChild();
    this.blend();
    return this;
  }

  gridChild(): this {
    this.addStyles(...htmlGridChildProps(this.node));
    return this;
  }

  commonShapeStyles(): this {
    if ("fills" in this.node) {
      this.applyFillsToStyle(
        this.node.fills,
        this.node.type === "TEXT" ? "text" : "background",
      );
    }
    this.shadow();
    this.border(this.settings);
    this.blur();
    return this;
  }

  addStyles = (...newStyles: string[]) => {
    this.styles.push(...newStyles.filter((style) => style));
  };

  blend(): this {
    const { node, isJSX } = this;
    this.addStyles(
      htmlVisibility(node, isJSX),
      ...htmlRotation(node, isJSX),
      htmlOpacity(node as MinimalBlendMixin, isJSX),
      htmlBlendMode(node as MinimalBlendMixin, isJSX),
    );
    return this;
  }

  border(settings: HTMLSettings): this {
    const { node } = this;
    this.addStyles(...htmlBorderRadius(node, this.isJSX));

    const commonBorder = commonStroke(node);
    if (!commonBorder) {
      return this;
    }

    const strokes = ("strokes" in node && node.strokes) || undefined;
    const color = htmlColorFromFills(strokes as any);
    if (!color) {
      return this;
    }
    const borderStyle =
      "dashPattern" in node && node.dashPattern.length > 0 ? "dotted" : "solid";

    const strokeAlign = "strokeAlign" in node ? node.strokeAlign : "INSIDE";

    const consolidateBorders = (border: number): string =>
      [`${numberToFixedString(border)}px`, color, borderStyle]
        .filter((d) => d)
        .join(" ");

    if ("all" in commonBorder) {
      if (commonBorder.all === 0) {
        return this;
      }
      const weight = commonBorder.all;

      // INSIDE + strokesIncludedInLayout: stroke is part of the frame size and
      // shrinks the content box (hero white matte). CSS border + border-box
      // matches; inset outline paints over the image and drops the extra size.
      const strokesInLayout =
        "strokesIncludedInLayout" in node &&
        (node as FrameNode).strokesIncludedInLayout === true;
      if (strokeAlign === "INSIDE" && strokesInLayout) {
        this.addStyles(
          formatWithJSX("box-sizing", this.isJSX, "border-box"),
          formatWithJSX("border", this.isJSX, consolidateBorders(weight)),
        );
      } else if (
        strokeAlign === "CENTER" ||
        strokeAlign === "OUTSIDE" ||
        node.type === "FRAME" ||
        node.type === "INSTANCE" ||
        node.type === "COMPONENT"
      ) {
        this.addStyles(
          formatWithJSX("outline", this.isJSX, consolidateBorders(weight)),
        );
        if (strokeAlign === "CENTER") {
          this.addStyles(
            formatWithJSX(
              "outline-offset",
              this.isJSX,
              `${numberToFixedString(-weight / 2)}px`,
            ),
          );
        } else if (strokeAlign === "INSIDE") {
          this.addStyles(
            formatWithJSX(
              "outline-offset",
              this.isJSX,
              `${numberToFixedString(-weight)}px`,
            ),
          );
        }
      } else {
        // INSIDE stroke on non-frame shapes maps cleanly to border.
        this.addStyles(
          formatWithJSX("border", this.isJSX, consolidateBorders(weight)),
        );
      }
    } else {
      // Per-side weights need individual border-* properties.
      if (commonBorder.left !== 0) {
        this.addStyles(
          formatWithJSX(
            "border-left",
            this.isJSX,
            consolidateBorders(commonBorder.left),
          ),
        );
      }
      if (commonBorder.top !== 0) {
        this.addStyles(
          formatWithJSX(
            "border-top",
            this.isJSX,
            consolidateBorders(commonBorder.top),
          ),
        );
      }
      if (commonBorder.right !== 0) {
        this.addStyles(
          formatWithJSX(
            "border-right",
            this.isJSX,
            consolidateBorders(commonBorder.right),
          ),
        );
      }
      if (commonBorder.bottom !== 0) {
        this.addStyles(
          formatWithJSX(
            "border-bottom",
            this.isJSX,
            consolidateBorders(commonBorder.bottom),
          ),
        );
      }
    }
    return this;
  }

  position(): this {
    const { node, isJSX } = this;
    const isAbsolutePosition = commonIsAbsolutePosition(node);
    if (isAbsolutePosition) {
      const { x, y } = getCommonPositionValue(node, this.settings);

      this.addStyles(
        formatWithJSX("left", isJSX, x),
        formatWithJSX("top", isJSX, y),
        formatWithJSX("position", isJSX, "absolute"),
      );
    } else {
      if (node.type === "GROUP" || (node as any).isRelative) {
        this.addStyles(formatWithJSX("position", isJSX, "relative"));
      }

      // Fixed-size AL children must not flex-shrink when a sibling's padding
      // (or rounding) makes the column taller than the page — that compresses
      // section frames while absolute décor keeps its top offset.
      const parent = node.parent;
      const grows =
        "layoutGrow" in node &&
        typeof (node as LayoutMixin).layoutGrow === "number" &&
        (node as LayoutMixin).layoutGrow > 0;
      if (
        !grows &&
        parent &&
        "layoutMode" in parent &&
        parent.layoutMode &&
        parent.layoutMode !== "NONE" &&
        parent.layoutMode !== "GRID"
      ) {
        this.addStyles(formatWithJSX("flex-shrink", isJSX, "0"));
      }
    }

    return this;
  }

  applyFillsToStyle(
    paintArray: ReadonlyArray<Paint> | PluginAPI["mixed"],
    property: "text" | "background",
  ): this {
    if (property === "text") {
      this.addStyles(
        formatWithJSX(
          "text",
          this.isJSX,
          htmlColorFromFills(paintArray as any),
        ),
      );
      return this;
    }

    const backgroundValues = buildBackgroundValues(paintArray as any);
    if (backgroundValues) {
      this.addStyles(formatWithJSX("background", this.isJSX, backgroundValues));

      if (paintArray !== figma.mixed) {
        const blendModes = this.buildBackgroundBlendModes(paintArray);
        if (blendModes) {
          this.addStyles(
            formatWithJSX("background-blend-mode", this.isJSX, blendModes),
          );
        }
      }
    }

    return this;
  }

  buildBackgroundBlendModes(paintArray: ReadonlyArray<Paint>): string {
    if (
      paintArray.length === 0 ||
      paintArray.every(
        (d) => d.blendMode === "NORMAL" || d.blendMode === "PASS_THROUGH",
      )
    ) {
      return "";
    }

    // Match buildBackgroundValues paint reversal so blend modes align with layers.
    const blendModes = [...paintArray].reverse().map((paint) => {
      if (paint.blendMode === "PASS_THROUGH") {
        return "normal";
      }

      return paint.blendMode?.toLowerCase();
    });

    return blendModes.join(", ");
  }

  shadow(): this {
    const { node, isJSX } = this;
    if ("effects" in node) {
      const shadow = htmlShadow(node);
      if (shadow) {
        this.addStyles(formatWithJSX("box-shadow", isJSX, htmlShadow(node)));
      }
    }
    return this;
  }

  size(): this {
    const { node } = this;
    const { width, height, constraints } = htmlSizePartial(node, false);

    if (node.type === "TEXT") {
      const text = node as TextNode;
      const chars = "characters" in text ? String(text.characters) : "";
      const noHardBreak = !chars.includes("\n");
      const fontSize = typeof text.fontSize === "number" ? text.fontSize : 0;

      let lineHeightPx = fontSize > 0 ? fontSize * 1.2 : 0;
      try {
        if (
          text.lineHeight &&
          text.lineHeight !== figma.mixed &&
          fontSize > 0
        ) {
          const lh = commonLineHeight(text.lineHeight as LineHeight, fontSize);
          if (lh > 0) lineHeightPx = lh;
        }
      } catch {
        /* mixed lineHeight */
      }
      const fromStyle = (text as TextNode & { lineHeightPx?: number })
        .lineHeightPx;
      if (typeof fromStyle === "number" && fromStyle > 0) {
        lineHeightPx = fromStyle;
      }

      let letterSpacingPx = 0;
      try {
        if (
          text.letterSpacing &&
          text.letterSpacing !== figma.mixed &&
          fontSize > 0
        ) {
          letterSpacingPx = commonLetterSpacing(
            text.letterSpacing as LetterSpacing,
            fontSize,
          );
        }
      } catch {
        /* mixed letterSpacing */
      }
      const fromLs = (text as TextNode & { letterSpacing?: number })
        .letterSpacing;
      if (
        letterSpacingPx === 0 &&
        typeof fromLs === "number" &&
        Number.isFinite(fromLs)
      ) {
        letterSpacingPx = fromLs;
      }

      // Prefer Figma-baked visual `\n` (toJson). Fallback: tall box without `\n`
      // still allows CSS soft-wrap when baking was skipped (missing font, etc.).
      const textMeta = text as TextNode & {
        visualLineBreaksBaked?: boolean;
        textPaintOverflows?: boolean;
        textPaintHeight?: number;
      };
      const baked = !!textMeta.visualLineBreaksBaked;
      const overflowsBox =
        !!textMeta.textPaintOverflows || textOverflowsLayoutBox(text);
      // Content wider than the box must wrap even when AABB/paint height still
      // looks like one line (master-course「いまお…」597×69 / nowrap overflow).
      const contentWiderThanBox = textContentExceedsLayoutWidth(
        chars,
        typeof text.width === "number" ? Math.abs(text.width) : 0,
        fontSize,
        letterSpacingPx,
      );
      const clippedMultilineBody =
        contentWiderThanBox &&
        textBoxLooksMultiline(
          typeof text.height === "number" ? Math.abs(text.height) : 0,
          fontSize,
          lineHeightPx,
        );
      // Wider-than-box *and* taller-than-one-line copy gets baked <br/> +
      // nowrap. Single-line Latin labels (Exercise 22px) stay nowrap, no <br/>.
      const softWrapParagraph =
        !baked &&
        noHardBreak &&
        fontSize > 0 &&
        !clippedMultilineBody &&
        (overflowsBox ||
          text.height > Math.max(fontSize * 2.5, lineHeightPx * 1.5));

      // Keep Figma width (+ small webfont pad). Never estimate a wider box from
      // AABB height/lineHeight — that turned Gerber 583px into ~1037px.
      // Soft-wrap fallback (no bake): skip pad so CSS does not wrap later than
      // Figma and run under overlapping siblings (master-course book card).
      let widthStyle = width;
      if (typeof text.width === "number") {
        let outW = Math.abs(text.width);
        const allowPad = baked || clippedMultilineBody || !softWrapParagraph;
        if (allowPad) {
          let pad = 2;
          if (letterSpacingPx > 0) pad = Math.max(pad, letterSpacingPx);
          if (fontSize > 0) {
            pad = Math.max(pad, Math.ceil(fontSize * 0.25));
          }
          pad = Math.max(pad, Math.ceil(outW * 0.02));
          outW += pad;
        }
        // Baked / clipped multiline: tiny slack only — do not grow to full advance.
        if ((baked || clippedMultilineBody) && fontSize > 0) {
          outW = Math.max(
            Math.abs(text.width) + 2,
            Math.min(outW, Math.abs(text.width) + Math.ceil(fontSize * 0.5)),
          );
        }
        widthStyle = formatWithJSX("width", this.isJSX, Math.max(1, outW));
      }

      // Height: keep Figma layout AABB. Vertical-align (center) + overflow
      // visible matches canvas paint. Inflating to paintH or lineCount×lh
      // (BPS 240px) overlaps the next absolute paragraph.
      this.addStyles(widthStyle, height);

      // Pixel-perfect: baked or content-wider (emit <br/>) must not reflow.
      if (
        baked ||
        clippedMultilineBody ||
        (noHardBreak && !softWrapParagraph)
      ) {
        this.addStyles(formatWithJSX("white-space", this.isJSX, "nowrap"));
      }
    } else {
      this.addStyles(width, height);
    }

    // min/max width/height are separate from computed width/height strings.
    if (constraints.length > 0) {
      this.addStyles(...constraints);
    }

    return this;
  }

  autoLayoutPadding(): this {
    const { node, isJSX } = this;
    if ("paddingLeft" in node) {
      this.addStyles(...htmlPadding(node, isJSX));
    }
    return this;
  }

  blur() {
    const { node } = this;
    if ("effects" in node && node.effects.length > 0) {
      const blur = node.effects.find(
        (e): e is BlurEffect => e.type === "LAYER_BLUR" && e.visible !== false,
      );
      if (blur) {
        this.addStyles(
          formatWithJSX(
            "filter",
            this.isJSX,
            `blur(${numberToFixedString(blur.radius / 2)}px)`,
          ),
        );
      }

      const backgroundBlur = node.effects.find(
        (e): e is BlurEffect =>
          e.type === "BACKGROUND_BLUR" && e.visible !== false,
      );
      if (backgroundBlur) {
        this.addStyles(
          formatWithJSX(
            "backdrop-filter",
            this.isJSX,
            `blur(${numberToFixedString(backgroundBlur.radius / 2)}px)`,
          ),
        );
      }
    }
  }

  addData(label: string, value?: string): this {
    const attribute = formatDataAttribute(label, value);
    this.data.push(attribute);
    return this;
  }

  build(additionalStyle: Array<string> = []): string {
    this.addStyles(...additionalStyle);

    const classNames: string[] = [];
    if (this.name) {
      this.addData("layer", this.name.trim());

      const layerNameClass = stringToClassName(this.name.trim());
      if (layerNameClass !== "") {
        classNames.push(layerNameClass);
      }
    }

    if ("componentProperties" in this.node && this.node.componentProperties) {
      Object.entries(this.node.componentProperties)
        ?.map((prop) => {
          if (prop[1].type === "VARIANT" || prop[1].type === "BOOLEAN") {
            const cleanName = prop[0]
              .split("#")[0]
              .replace(/\s+/g, "-")
              .toLowerCase();

            return formatDataAttribute(cleanName, String(prop[1].value));
          }
          return "";
        })
        .filter(Boolean)
        .sort()
        .forEach((d) => this.data.push(d));
    }

    const dataAttributes = this.data.join("");
    const classAttribute = formatClassAttribute(classNames, false);
    const styleAttribute = formatStyleAttribute(this.styles, false);

    return `${dataAttributes}${classAttribute}${styleAttribute}`;
  }
}

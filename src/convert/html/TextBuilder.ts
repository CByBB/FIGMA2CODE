import { formatMultipleJSX, formatWithJSX } from "../css/format";
import { HtmlDefaultBuilder } from "./DefaultBuilder";
import { htmlColorFromFills } from "./color";
import {
  commonLetterSpacing,
  commonLineHeight,
  authoredNewlinesExplainBox,
  textBoxLooksMultiline,
  textContentExceedsLayoutWidth,
} from "../layout/text";
import {
  bakeSoftBreaksFromAdvanceEstimate,
  injectSoftBreaksIntoSegment,
} from "../layout/bakeLines";
import { HTMLSettings, StyledTextSegmentSubset } from "types";

export class HtmlTextBuilder extends HtmlDefaultBuilder {
  constructor(node: TextNode, settings: HTMLSettings) {
    super(node, settings);
  }

  get htmlElement(): string {
    return "p";
  }

  // Per-segment styles from toJson styledTextSegments drive inline CSS on spans.
  getTextSegments(node: TextNode): {
    style: string;
    text: string;
    openTypeFeatures: { [key: string]: boolean };
    className?: string;
    componentName?: string;
  }[] {
    const segments = (node as any)
      .styledTextSegments as StyledTextSegmentSubset[];
    if (!segments) {
      return [];
    }

    // Emit-time fallback when toJson bake was skipped (REST dump / SVG lied
    // single-line). Inject estimated soft breaks so webfont CSS cannot reflow
    // past overlapping siblings (master-course book).
    const textMeta = node as TextNode & {
      visualLineBreaksBaked?: boolean;
      characters: string;
    };
    let emitSoftBreaks: number[] | null = null;
    if (!textMeta.visualLineBreaksBaked && textMeta.characters) {
      const fontSize = typeof node.fontSize === "number" ? node.fontSize : 0;
      let letterSpacingPx = 0;
      try {
        if (
          fontSize > 0 &&
          node.letterSpacing &&
          node.letterSpacing !== figma.mixed
        ) {
          letterSpacingPx = commonLetterSpacing(
            node.letterSpacing as LetterSpacing,
            fontSize,
          );
        }
      } catch {
        /* mixed */
      }
      const layoutW =
        typeof node.width === "number"
          ? Math.abs(node.width)
          : (
              node as TextNode & {
                absoluteBoundingBox?: { width?: number } | null;
              }
            ).absoluteBoundingBox?.width || 0;
      const layoutH =
        typeof node.height === "number" ? Math.abs(node.height) : 0;
      let lineHeightPx = fontSize > 0 ? fontSize * 1.2 : 0;
      try {
        if (
          fontSize > 0 &&
          node.lineHeight &&
          node.lineHeight !== figma.mixed
        ) {
          const lh = commonLineHeight(node.lineHeight as LineHeight, fontSize);
          if (lh > 0) lineHeightPx = lh;
        }
      } catch {
        /* mixed */
      }
      const fromLh = (node as TextNode & { lineHeightPx?: number })
        .lineHeightPx;
      if (typeof fromLh === "number" && fromLh > 0) lineHeightPx = fromLh;
      const mixedSizes = Array.isArray(
        (node as TextNode & { characterStyleOverrides?: unknown[] })
          .characterStyleOverrides,
      )
        ? (
            node as TextNode & { characterStyleOverrides?: number[] }
          ).characterStyleOverrides!.some((v) => v !== 0)
        : false;
      // Mixed font sizes (鈴木英史 27px + 理事長 18px) make 0.55em/1em
      // estimate wrap the smaller line. Skip; Figma `\n` already authored.
      if (
        fontSize > 0 &&
        !mixedSizes &&
        !authoredNewlinesExplainBox(
          textMeta.characters,
          layoutH,
          lineHeightPx,
        ) &&
        textBoxLooksMultiline(layoutH, fontSize, lineHeightPx) &&
        textContentExceedsLayoutWidth(
          textMeta.characters,
          layoutW,
          fontSize,
          letterSpacingPx,
        )
      ) {
        const estimated = bakeSoftBreaksFromAdvanceEstimate(
          textMeta.characters,
          layoutW,
          fontSize,
          letterSpacingPx,
        );
        if (estimated) emitSoftBreaks = estimated.softBreakStarts;
      }
    }

    return segments.map((segment) => {
      const additionalStyles: { [key: string]: string } = {};

      const layerBlurStyle = this.getLayerBlurStyle();
      if (layerBlurStyle) {
        additionalStyles.filter = layerBlurStyle;
      }
      const textShadowStyle = this.getTextShadowStyle();
      if (textShadowStyle) {
        additionalStyles["text-shadow"] = textShadowStyle;
      }

      const styleAttributes = formatMultipleJSX(
        {
          color: htmlColorFromFills(segment.fills as any),
          "font-size": segment.fontSize,
          "font-family": segment.fontName.family,
          "font-style": this.getFontStyle(segment.fontName.style),
          "font-weight": `${segment.fontWeight}`,
          "text-decoration": this.textDecoration(segment.textDecoration),
          "text-transform": this.textTransform(segment.textCase),
          "line-height": this.lineHeight(segment.lineHeight, segment.fontSize),
          "letter-spacing": this.letterSpacing(
            segment.letterSpacing,
            segment.fontSize,
          ),
          // Do not set word-wrap:break-word — with a slightly tight Figma width,
          // browsers mid-break CJK/Latin and diverge from Figma's line breaks.
          ...additionalStyles,
        },
        false,
      );

      let segmentChars = String(segment.characters || "");
      if (
        emitSoftBreaks &&
        typeof segment.start === "number" &&
        typeof segment.end === "number"
      ) {
        segmentChars = injectSoftBreaksIntoSegment(
          textMeta.characters,
          segment.start,
          segment.end,
          emitSoftBreaks,
        );
      }

      // Soft wraps are baked to `\n` in toJson (Figma visual lines). Do not
      // unwrap — that would let the browser reflow with a different webfont.
      const charsWithLineBreak = segmentChars.split("\n").join("<br/>");
      return {
        style: styleAttributes,
        text: charsWithLineBreak,
        openTypeFeatures: segment.openTypeFeatures,
      };
    });
  }

  fontSize(node: TextNode, isUI = false): this {
    if (node.fontSize !== figma.mixed) {
      const value = isUI ? Math.min(node.fontSize, 24) : node.fontSize;
      this.addStyles(formatWithJSX("font-size", this.isJSX, value));
    }
    return this;
  }

  textTrim(): this {
    if ("leadingTrim" in this.node && this.node.leadingTrim === "CAP_HEIGHT") {
      this.addStyles(formatWithJSX("text-box-trim", this.isJSX, "trim-both"));
      this.addStyles(
        formatWithJSX("text-box-edge", this.isJSX, "cap alphabetic"),
      );
    }
    return this;
  }

  textDecoration(textDecoration: TextDecoration): string {
    switch (textDecoration) {
      case "STRIKETHROUGH":
        return "line-through";
      case "UNDERLINE":
        return "underline";
      case "NONE":
        return "";
    }
  }

  textTransform(textCase: TextCase): string {
    switch (textCase) {
      case "UPPER":
        return "uppercase";
      case "LOWER":
        return "lowercase";
      case "TITLE":
        return "capitalize";
      case "ORIGINAL":
      case "SMALL_CAPS":
      case "SMALL_CAPS_FORCED":
      default:
        return "";
    }
  }

  letterSpacing(letterSpacing: LetterSpacing, fontSize: number): number | null {
    const letterSpacingProp = commonLetterSpacing(letterSpacing, fontSize);
    if (letterSpacingProp > 0) {
      return letterSpacingProp;
    }
    return null;
  }

  lineHeight(lineHeight: LineHeight, fontSize: number): number | null {
    const lineHeightProp = commonLineHeight(lineHeight, fontSize);
    if (lineHeightProp > 0) {
      return lineHeightProp;
    }
    // AUTO / intrinsic: use Figma's resolved px (from REST style) so hug text
    // matches the design box instead of the browser default multiplier.
    const resolved = (this.node as TextNode & { lineHeightPx?: number })
      .lineHeightPx;
    if (typeof resolved === "number" && resolved > 0) {
      return resolved;
    }
    return null;
  }

  getFontStyle(style: string): string {
    if (style.toLowerCase().match("italic")) {
      return "italic";
    }
    return "";
  }

  textAlignHorizontal(): this {
    const node = this.node as TextNode;

    if (node.textAlignHorizontal && node.textAlignHorizontal !== "LEFT") {
      let textAlign = "";
      switch (node.textAlignHorizontal) {
        case "CENTER":
          textAlign = "center";
          break;
        case "RIGHT":
          textAlign = "right";
          break;
        case "JUSTIFIED":
          textAlign = "justify";
          break;
      }
      this.addStyles(formatWithJSX("text-align", this.isJSX, textAlign));
    }
    return this;
  }

  textAlignVertical(): this {
    const node = this.node as TextNode;
    if (node.textAlignVertical && node.textAlignVertical !== "TOP") {
      let alignItems = "";
      switch (node.textAlignVertical) {
        case "CENTER":
          alignItems = "center";
          break;
        case "BOTTOM":
          alignItems = "flex-end";
          break;
      }
      if (alignItems) {
        // Flex column + multiple styled <span>s would stack each segment
        // as its own row (Hero Title: 『 / 総 / 義歯…). Callers must wrap
        // all text content in one child — see htmlText().
        this.addStyles(
          formatWithJSX("justify-content", this.isJSX, alignItems),
        );
        this.addStyles(formatWithJSX("display", this.isJSX, "flex"));
        this.addStyles(formatWithJSX("flex-direction", this.isJSX, "column"));
        (
          this as { _wrapTextForVerticalAlign?: boolean }
        )._wrapTextForVerticalAlign = true;
      }
    }
    return this;
  }

  /** Layer blur on text → CSS filter (effects not baked into text SVG). */
  private getLayerBlurStyle(): string {
    if (this.node && (this.node as TextNode).effects) {
      const effects = (this.node as TextNode).effects;
      const blurEffect = effects.find(
        (effect) =>
          effect.type === "LAYER_BLUR" &&
          effect.visible !== false &&
          effect.radius > 0,
      );
      if (blurEffect && blurEffect.radius) {
        return `blur(${blurEffect.radius}px)`;
      }
    }
    return "";
  }

  /** Drop shadow on text → CSS text-shadow. */
  private getTextShadowStyle(): string {
    if (this.node && (this.node as TextNode).effects) {
      const effects = (this.node as TextNode).effects;
      const dropShadow = effects.find(
        (effect) => effect.type === "DROP_SHADOW" && effect.visible !== false,
      );
      if (dropShadow) {
        const ds = dropShadow as DropShadowEffect;
        const offsetX = Math.round(ds.offset.x);
        const offsetY = Math.round(ds.offset.y);
        const blurRadius = Math.round(ds.radius);
        const r = Math.round(ds.color.r * 255);
        const g = Math.round(ds.color.g * 255);
        const b = Math.round(ds.color.b * 255);
        const a = ds.color.a;
        return `${offsetX}px ${offsetY}px ${blurRadius}px rgba(${r}, ${g}, ${b}, ${a.toFixed(
          2,
        )})`;
      }
    }
    return "";
  }
}

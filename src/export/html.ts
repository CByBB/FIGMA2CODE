/**
 * Builds standalone index.html + styles/page.css for ZIP downloads using
 * relative assets/* paths instead of inline data URLs used in the live preview.
 */
import { PluginSettings, RestAltNode } from "types";
import { lockedHtmlSettings } from "../convert/settings";
import { htmlMain } from "../convert/html/generate";
import { googleFontsHeadHtml } from "./googleFonts";

export const ZIP_STYLESHEET_PATH = "styles/page.css";

function escapeHtml(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Preview HTML already references assets/*; no data-URL rewrite needed today. */
export function rewriteDataUrlsToRelativePaths(html: string): string {
  return html;
}

function designWidthPx(nodes: readonly RestAltNode[]): number | null {
  const root = nodes[0];
  if (!root) return null;
  if (typeof root.width === "number" && root.width > 0) {
    return Math.round(root.width);
  }
  const w = root.absoluteBoundingBox?.width;
  return typeof w === "number" && w > 0 ? Math.round(w) : null;
}

/**
 * Fixed Figma artboards (e.g. 1440px) stay left-aligned and leave empty space on
 * wide monitors unless the shell centers them. Narrow viewports scale down so
 * absolute layouts still fit without horizontal scroll.
 */
function artboardShellCss(designWidth: number | null): string {
  const w = designWidth && designWidth > 0 ? designWidth : null;
  return `html, body { margin: 0; padding: 0; }
body { background: #fff; }
#artboard-stage {
  width: 100%;
  display: flex;
  justify-content: center;
  overflow-x: clip;
}
#artboard {
  ${w ? `width: ${w}px;` : ""}
  flex-shrink: 0;
  transform-origin: top center;
}
`;
}

function artboardShellScript(designWidth: number | null): string {
  const fallback = designWidth && designWidth > 0 ? String(designWidth) : "0";
  return `<script>
(function () {
  var stage = document.getElementById("artboard-stage");
  var board = document.getElementById("artboard");
  if (!stage || !board) return;
  var designW = ${fallback} || board.offsetWidth || board.scrollWidth;
  if (!designW) return;
  function fit() {
    var vw = document.documentElement.clientWidth || window.innerWidth;
    var scale = vw < designW ? vw / designW : 1;
    board.style.transform = scale === 1 ? "" : "scale(" + scale + ")";
    // transform does not affect layout size — collapse the leftover gap.
    var h = board.offsetHeight;
    stage.style.height = h ? Math.ceil(h * scale) + "px" : "";
  }
  fit();
  window.addEventListener("resize", fit);
})();
</script>`;
}

export type ZipHtmlBundle = {
  html: string;
  css: string;
  stylesheetPath: string;
};

/** Emit index.html + separate styles/page.css for the ZIP folder. */
export async function buildZipIndexHtml(
  nodes: RestAltNode[],
  settings: PluginSettings,
  title: string,
): Promise<ZipHtmlBundle> {
  // HTML emitters still type against live SceneNode; convert nodes are REST-shaped.
  const sceneNodes = nodes as unknown as SceneNode[];
  const output = await htmlMain(
    sceneNodes,
    lockedHtmlSettings(settings),
    false,
  );

  const body = rewriteDataUrlsToRelativePaths(output.html);
  const safeTitle = escapeHtml(title || "Figma export");
  const fontLinks = googleFontsHeadHtml(sceneNodes);
  const designWidth = designWidthPx(nodes);
  const cssParts = [artboardShellCss(designWidth)];
  if (output.css?.trim()) cssParts.push(output.css.trim());

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
${fontLinks}  <link rel="stylesheet" href="${ZIP_STYLESHEET_PATH}" />
</head>
<body>
<div id="artboard-stage">
<div id="artboard">
${body}
</div>
</div>
${artboardShellScript(designWidth)}
</body>
</html>
`;

  return {
    html,
    css: cssParts.join("\n"),
    stylesheetPath: ZIP_STYLESHEET_PATH,
  };
}

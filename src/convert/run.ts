/**
 * Conversion orchestration: selection → enriched nodes → HTML preview snippet.
 * ZIP asset export is a separate path (`exportZipPackage`); preview avoids exportAsync.
 */
import {
  retrieveGenericLinearGradients,
  retrieveGenericSolidUIColors,
} from "./colors";
import { clearWarnings, warnings } from "./warnings";
import {
  postConversionComplete,
  postConversionStart,
  postEmptyMessage,
  postError,
  postBackendMessage,
} from "../messaging";
import { PluginSettings } from "types";
import { clearVariableCache, nodesToJSON } from "./nodes/toJson";
import { prepareWebFontAvailability } from "../export/googleFonts";
import {
  exportZipAssets,
  planAssetTargets,
  ensureFlattenedSvgAssets,
} from "../export/zip";
import { clearAssetCache } from "../export/cache";
import { applyAssetFlagsToTree } from "../export/flags";
import { buildZipIndexHtml, ZIP_STYLESHEET_PATH } from "../export/html";
import {
  applyClassRenames,
  extractInlineStylesToClasses,
} from "../export/css-classes";
import { getOpenRouterApiKey } from "../tidy/ai/key";
import { callOpenRouterCssRefactor } from "../tidy/ai/css-refactor";
import { OpenRouterHttpError } from "../tidy/ai/openrouter";
import { lockedHtmlSettings } from "./settings";
import { utf8Encode } from "../shared/utf8";
import { logError } from "../shared/log";

const PREVIEW_LINES = 25;

let lastPreview: { rootId: string; html: string } | null = null;

function snippetFromHtml(html: string) {
  const lines = html.split("\n");
  const lineCount = lines.length;
  const codeBytes = utf8Encode(html).length;
  const codePreview =
    lineCount <= PREVIEW_LINES
      ? html
      : `${lines.slice(0, PREVIEW_LINES).join("\n")}\n...`;
  return { codePreview, lineCount, codeBytes };
}

export function getLastPreviewHtml(): string | null {
  return lastPreview?.html ?? null;
}

async function convertSelection(settings: PluginSettings) {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    return null;
  }

  const convertedSelection = await nodesToJSON(selection, settings);

  if (!convertedSelection || convertedSelection.length === 0) {
    return null;
  }

  applyAssetFlagsToTree(convertedSelection);
  return { selection, convertedSelection };
}

// Preview path: JSON enrich → HTML snippet for the UI. Asset bytes are planned but not exported here.
export const run = async (settings: PluginSettings) => {
  clearVariableCache();
  clearWarnings();
  lastPreview = null;
  postConversionStart();

  try {
    const selection = figma.currentPage.selection;

    if (selection.length === 0) {
      clearAssetCache();
      postEmptyMessage();
      return;
    }

    const effectiveSettings = lockedHtmlSettings(settings);

    await prepareWebFontAvailability(selection);
    planAssetTargets(selection);

    const converted = await convertSelection(effectiveSettings);
    if (!converted) {
      clearAssetCache();
      postEmptyMessage();
      return;
    }

    const bundle = await buildZipIndexHtml(
      converted.convertedSelection,
      effectiveSettings,
      selection[0]?.name || "export",
    );
    const code = bundle.html;
    lastPreview = { rootId: selection[0].id, html: code };

    const colors = await retrieveGenericSolidUIColors();
    const gradients = await retrieveGenericLinearGradients();

    postConversionComplete({
      ...snippetFromHtml(code),
      colors,
      gradients,
      settings: effectiveSettings,
      warnings: [...warnings],
    });
  } catch (err) {
    logError("code generation failed", err);
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as Error).message)
        : String(err || "Code generation failed");
    lastPreview = null;
    postError(message);
  }
};

// ZIP path: exportAsync for assets, AI CSS class refactor, stream files to UI.
export const exportZipPackage = async (settings: PluginSettings) => {
  postBackendMessage({ type: "zipStart" });

  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    postBackendMessage({
      type: "zipError",
      error: "Select a frame before downloading the ZIP",
    });
    return;
  }

  const apiKey = await getOpenRouterApiKey();
  if (!apiKey) {
    postBackendMessage({
      type: "zipError",
      error:
        "Add your OpenRouter API key in About before downloading ZIP (needed to organize CSS into classes)",
    });
    return;
  }

  const rootId = selection[0].id;
  const effectiveSettings = lockedHtmlSettings(settings);

  try {
    const exported = await exportZipAssets(selection);

    postBackendMessage({
      type: "progress",
      message: "Building index.html…",
      percent: 72,
    });

    // Always rebuild. A cached preview can still be HTML text for a face that
    // this download just outlined to SVG (Electroharmonix).
    let html: string | null = null;
    let css = "";
    let stylesheetPath = ZIP_STYLESHEET_PATH;
    const converted = await convertSelection(effectiveSettings);
    if (converted) {
      postBackendMessage({
        type: "progress",
        message: "Exporting SVG assets for import…",
        percent: 78,
      });
      const ensured = await ensureFlattenedSvgAssets(
        converted.convertedSelection,
      );
      applyAssetFlagsToTree(converted.convertedSelection);
      if (ensured.added > 0) {
        postBackendMessage({
          type: "progress",
          message: `Added ${ensured.added} SVG asset file(s)…`,
          percent: 80,
        });
      }

      const bundle = await buildZipIndexHtml(
        converted.convertedSelection,
        effectiveSettings,
        selection[0]?.name || "export",
      );
      html = bundle.html;
      css = bundle.css;
      stylesheetPath = bundle.stylesheetPath;
    }

    if (html) {
      postBackendMessage({
        type: "progress",
        message: "Extracting CSS into styles/page.css…",
        percent: 82,
      });
      const extracted = extractInlineStylesToClasses(html, css);
      html = extracted.html;
      css = extracted.css;

      postBackendMessage({
        type: "progress",
        message:
          extracted.classCount > 0
            ? `AI classifying ${extracted.classCount} CSS classes…`
            : "AI reviewing CSS classes…",
        percent: 90,
      });
      try {
        const ai = await callOpenRouterCssRefactor({ apiKey, html, css });
        const renameCount = Object.keys(ai.renames || {}).length;
        const renamed = applyClassRenames(html, css, ai.renames);
        html = renamed.html;
        css = renamed.css;
        postBackendMessage({
          type: "progress",
          message:
            renameCount > 0
              ? `AI renamed ${renameCount} classes — packaging ZIP…`
              : "AI CSS pass done — packaging ZIP…",
          percent: 96,
        });
      } catch (e) {
        // Keep deterministic class extraction if the rename call fails.
        const msg =
          e instanceof OpenRouterHttpError
            ? e.message
            : e && typeof e === "object" && "message" in e
              ? String((e as Error).message)
              : String(e || "OpenRouter CSS refactor failed");
        logError("CSS class rename skipped", e);
        postBackendMessage({
          type: "progress",
          message: `AI rename skipped — using generated classes (${msg.slice(0, 80)})`,
          percent: 92,
        });
      }

      lastPreview = { rootId, html };
      postBackendMessage({
        type: "zipFile",
        path: "index.html",
        bytes: utf8Encode(html),
      });
      postBackendMessage({
        type: "zipFile",
        path: stylesheetPath,
        bytes: utf8Encode(css.endsWith("\n") ? css : `${css}\n`),
      });
    }

    postBackendMessage({
      type: "zipFile",
      path: "figma_raw.json",
      bytes: utf8Encode(JSON.stringify(exported.rawDocument) + "\n"),
    });
    postBackendMessage({
      type: "zipFile",
      path: "assets_map.json",
      bytes: utf8Encode(JSON.stringify(exported.assetsMap) + "\n"),
    });

    clearAssetCache();

    postBackendMessage({
      type: "zipDone",
      folder: exported.folder,
      assetCount: exported.assetCount,
      failedCount: exported.failedCount,
    });
  } catch (err) {
    logError("ZIP export failed", err);
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as Error).message)
        : String(err || "ZIP export failed");
    clearAssetCache();
    postBackendMessage({ type: "zipError", error: message });
  }
};

/** Load every font used by TEXT descendants before tidy mutates/resizes them. */

import { logError, safeNodeRef } from "../shared/log";

/**
 * Figma requires loadFontAsync before resize/style writes on TEXT. Skipping it
 * after clone can leave Latin glyphs looking mashed on the canvas and in
 * outline exports (MISSION → overlapping junk next to the divider).
 */
export async function loadFontsInTree(root: SceneNode): Promise<void> {
  const fonts = new Map<string, FontName>();
  const take = (node: TextNode) => {
    try {
      if (node.hasMissingFont) return;
      const len = node.characters.length;
      if (len === 0) return;
      for (const font of node.getRangeAllFontNames(0, len)) {
        fonts.set(`${font.family}__${font.style}`, font);
      }
    } catch (e) {
      logError(`collect fonts failed (${safeNodeRef(node)})`, e);
    }
  };

  try {
    if ("findAll" in root) {
      for (const n of root.findAll((c) => c.type === "TEXT")) {
        take(n as TextNode);
      }
    } else if (root.type === "TEXT") {
      take(root as TextNode);
    }
  } catch (e) {
    logError(`findAll TEXT for fonts failed (${safeNodeRef(root)})`, e);
  }

  await Promise.all(
    [...fonts.values()].map(async (font) => {
      try {
        await figma.loadFontAsync(font);
      } catch (e) {
        logError(`loadFontAsync failed (${font.family} / ${font.style})`, e);
      }
    }),
  );
}

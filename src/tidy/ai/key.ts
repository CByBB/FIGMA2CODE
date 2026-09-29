/** OpenRouter key in figma.clientStorage — kept out of PluginSettings so it never ships in exports. */

import { logError } from "../../shared/log";

export const OPENROUTER_KEY_STORAGE = "openRouterApiKey";

export async function getOpenRouterApiKey(): Promise<string | null> {
  try {
    const key = await figma.clientStorage.getAsync(OPENROUTER_KEY_STORAGE);
    if (typeof key !== "string" || key.trim().length === 0) return null;
    return key.trim();
  } catch (e) {
    logError("getOpenRouterApiKey failed", e);
    return null;
  }
}

export async function setOpenRouterApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  try {
    if (!trimmed) {
      await figma.clientStorage.setAsync(OPENROUTER_KEY_STORAGE, "");
      return;
    }
    await figma.clientStorage.setAsync(OPENROUTER_KEY_STORAGE, trimmed);
  } catch (e) {
    logError("setOpenRouterApiKey failed", e);
    throw e;
  }
}

export async function hasOpenRouterApiKey(): Promise<boolean> {
  return (await getOpenRouterApiKey()) !== null;
}

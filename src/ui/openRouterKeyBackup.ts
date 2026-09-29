/**
 * iframe localStorage backup for the OpenRouter key.
 * figma.clientStorage is primary; this restores the key if main reports no key
 * after a plugin reload (common with local/dev plugin sessions).
 */

const LS_KEY = "figmaToCode.openRouterApiKey";

export function readOpenRouterKeyBackup(): string | null {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (typeof v !== "string" || v.trim().length === 0) return null;
    return v.trim();
  } catch {
    return null;
  }
}

export function writeOpenRouterKeyBackup(key: string): void {
  try {
    const trimmed = key.trim();
    if (!trimmed) {
      localStorage.removeItem(LS_KEY);
      return;
    }
    localStorage.setItem(LS_KEY, trimmed);
  } catch {
    /* private mode / blocked storage */
  }
}

export function clearOpenRouterKeyBackup(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

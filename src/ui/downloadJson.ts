/**
 * Trigger a browser download of a JSON text payload from the plugin UI iframe.
 */
export function downloadJsonText(filename: string, jsonText: string): void {
  const blob = new Blob([jsonText], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "bounds.json";
  a.click();
  URL.revokeObjectURL(url);
}

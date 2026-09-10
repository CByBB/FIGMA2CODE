/** Drop Figma-hidden layers — they should not appear in HTML output. */
export const getVisibleNodes = (nodes: readonly SceneNode[]) =>
  nodes.filter((d) => d.visible !== false);

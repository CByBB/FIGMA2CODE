/**
 * Drop layers that cannot affect the tidied result: Figma-hidden nodes, and
 * nodes entirely outside a clipping tidy root (clipsContent).
 */

import { logError, safeNodeRef } from "../shared/log";
import { isEntirelyOutside, type Rect } from "./geometry";
import { tidyWarn } from "./warnings";

export type PruneStats = {
  hidden: number;
  outside: number;
};

function rootClipBox(root: SceneNode): Rect | null {
  if (!("clipsContent" in root) || !(root as FrameNode).clipsContent) {
    return null;
  }
  if (!("absoluteBoundingBox" in root) || !root.absoluteBoundingBox) {
    return null;
  }
  const b = root.absoluteBoundingBox;
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

/**
 * Remove invisible and fully-clipped-away descendants from the tidy clone.
 * Does not remove the root itself. Walks deepest-first so parent removal is
 * skipped when a child was already deleted with an outside ancestor.
 */
export function pruneNonVisibleNodes(root: SceneNode): PruneStats {
  const clipBox = rootClipBox(root);
  let hidden = 0;
  let outside = 0;

  function shouldRemove(node: SceneNode): "hidden" | "outside" | null {
    if (node.visible === false) return "hidden";
    if (!clipBox) return null;
    const box = "absoluteBoundingBox" in node ? node.absoluteBoundingBox : null;
    if (!box || box.width <= 0 || box.height <= 0) return null;
    if (
      isEntirelyOutside(
        { x: box.x, y: box.y, width: box.width, height: box.height },
        clipBox,
      )
    ) {
      return "outside";
    }
    return null;
  }

  function walk(parent: SceneNode): void {
    if (!("children" in parent)) return;

    const kids = [...parent.children] as SceneNode[];
    for (const child of kids) {
      const reason = shouldRemove(child);
      if (reason) {
        try {
          child.remove();
          if (reason === "hidden") hidden += 1;
          else outside += 1;
        } catch (e) {
          logError(`prune remove failed (${safeNodeRef(child)})`, e);
        }
        continue;
      }
      walk(child);
    }
  }

  walk(root);

  if (hidden > 0 || outside > 0) {
    const parts: string[] = [];
    if (hidden > 0) parts.push(`${hidden} hidden`);
    if (outside > 0) parts.push(`${outside} outside clip`);
    tidyWarn(`Pruned ${parts.join(", ")} layer(s)`);
  }

  return { hidden, outside };
}

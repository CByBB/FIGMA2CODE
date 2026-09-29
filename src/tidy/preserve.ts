/** Absolute bounding-box snapshots used to validate and rollback tidy apply. */

import { logError, safeNodeRef } from "../shared/log";

export const PIXEL_EPS = 0.5;
export const TIDY_WRAPPER_KEY = "tidyWrapper";
/** Original document paint order (DFS index) — used to restore z-order after reparent. */
export const TIDY_PAINT_KEY = "tidyPaint";
/** Page-absolute decoration lifted for vertical cross-section bleed. */
export const TIDY_LIFTED_KEY = "tidyLifted";

export type AbsSnap = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export function snapAbs(node: SceneNode): AbsSnap | null {
  const b = node.absoluteBoundingBox;
  if (!b) return null;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

export function snapTree(root: SceneNode): Map<string, AbsSnap> {
  const map = new Map<string, AbsSnap>();
  const visit = (node: SceneNode) => {
    const s = snapAbs(node);
    if (s) map.set(node.id, s);
    if ("children" in node) {
      for (const child of (node as ChildrenMixin).children) {
        visit(child as SceneNode);
      }
    }
  };
  visit(root);
  return map;
}

export function nearlySameAbs(
  a: AbsSnap,
  b: AbsSnap,
  eps = PIXEL_EPS,
): boolean {
  return (
    Math.abs(a.x - b.x) <= eps &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs(a.w - b.w) <= eps &&
    Math.abs(a.h - b.h) <= eps
  );
}

/** Layer ids whose absolute box moved beyond tolerance since the pre-apply snapshot. */
export function driftedIds(
  root: SceneNode,
  before: Map<string, AbsSnap>,
  eps = PIXEL_EPS,
): string[] {
  const bad: string[] = [];
  const visit = (node: SceneNode) => {
    const prev = before.get(node.id);
    if (prev) {
      const now = snapAbs(node);
      if (!now || !nearlySameAbs(prev, now, eps)) {
        bad.push(node.id);
      }
    }
    if ("children" in node) {
      for (const child of (node as ChildrenMixin).children) {
        visit(child as SceneNode);
      }
    }
  };
  visit(root);
  return bad;
}

function isTidyWrapper(node: BaseNode): boolean {
  return (
    node.type === "FRAME" &&
    typeof (node as FrameNode).getPluginData === "function" &&
    (node as FrameNode).getPluginData(TIDY_WRAPPER_KEY) === "1"
  );
}

function depthOf(node: BaseNode): number {
  let d = 0;
  let p: BaseNode | null = node.parent;
  while (p) {
    d += 1;
    p = p.parent;
  }
  return d;
}

/**
 * node.x/y minus the visual AABB origin in parent space.
 * Zero when unrotated; for 180° rotation this is typically (+width, +height)
 * because `x` is the transform translation, not the bounding-box left.
 */
export function transformOriginOffset(node: SceneNode): {
  dx: number;
  dy: number;
} {
  if (!("x" in node)) return { dx: 0, dy: 0 };
  const box = "absoluteBoundingBox" in node ? node.absoluteBoundingBox : null;
  if (!box) return { dx: 0, dy: 0 };
  const parent = node.parent;
  const parentBox =
    parent && "absoluteBoundingBox" in parent
      ? parent.absoluteBoundingBox
      : null;
  const originX = parentBox?.x ?? 0;
  const originY = parentBox?.y ?? 0;
  const lm = node as LayoutMixin;
  return {
    dx: lm.x - (box.x - originX),
    dy: lm.y - (box.y - originY),
  };
}

/**
 * Write x/y (and optional size) so absoluteBoundingBox lands at the parent-local
 * box. Assigning AABB left/top to `node.x`/`node.y` shifts rotated layers.
 */
export function placeLocalBox(
  node: SceneNode,
  localX: number,
  localY: number,
  w?: number,
  h?: number,
): void {
  if (!("x" in node)) return;
  const rotated =
    "rotation" in node && Math.abs((node as LayoutMixin).rotation) > 0.5;
  // AABB size is larger than layout size when rotated; resizing to the box grows the node.
  if (
    !rotated &&
    typeof w === "number" &&
    typeof h === "number" &&
    "resize" in node &&
    node.type !== "LINE" &&
    w >= 0.5 &&
    h >= 0.5
  ) {
    const curW = Math.abs(node.width);
    const curH = Math.abs(node.height);
    if (Math.abs(curW - w) > 0.5 || Math.abs(curH - h) > 0.5) {
      try {
        (node as LayoutMixin).resize(Math.max(1, w), Math.max(1, h));
      } catch (e) {
        logError(`resize failed (${safeNodeRef(node)})`, e);
      }
    }
  }
  const { dx, dy } = transformOriginOffset(node);
  try {
    (node as LayoutMixin).x = localX + dx;
    (node as LayoutMixin).y = localY + dy;
  } catch (e) {
    logError(`absolute box write failed (${safeNodeRef(node)})`, e);
  }
}

function parentAbsOrigin(parent: BaseNode & ChildrenMixin): {
  x: number;
  y: number;
} {
  if ("absoluteBoundingBox" in parent && parent.absoluteBoundingBox) {
    return {
      x: parent.absoluteBoundingBox.x,
      y: parent.absoluteBoundingBox.y,
    };
  }
  return { x: 0, y: 0 };
}

/**
 * Replace a GROUP with an equivalent FRAME in-place so it can use
 * layoutPositioning ABSOLUTE inside page Auto Layout.
 *
 * Place from AABB vs the *immediate* parent. `group.x`/`group.y` are relative
 * to the nearest FRAME, not intermediate GROUPs — nesting shells with those
 * values packs Mask/sun at (0,0) and leaves children in ancestor space.
 */
export function convertGroupToFrame(group: GroupNode): FrameNode {
  const parent = group.parent;
  if (!parent || !("appendChild" in parent)) {
    throw new Error(`Group "${group.name}" has no parent`);
  }

  const index = parent.children.indexOf(group);
  const groupBox = group.absoluteBoundingBox;
  const parentBox =
    "absoluteBoundingBox" in parent ? parent.absoluteBoundingBox : null;
  // Snapshot before any reparent — group AABB shrinks as children leave.
  const targetW = Math.max(1, groupBox?.width ?? group.width);
  const targetH = Math.max(1, groupBox?.height ?? group.height);
  const targetX = groupBox && parentBox ? groupBox.x - parentBox.x : group.x;
  const targetY = groupBox && parentBox ? groupBox.y - parentBox.y : group.y;
  const savedAbs = groupBox
    ? { x: groupBox.x, y: groupBox.y, w: groupBox.width, h: groupBox.height }
    : null;
  const children = [...group.children].map((child) => ({
    node: child,
    snap: snapAbs(child),
  }));

  const frame = figma.createFrame();
  frame.name = group.name;
  frame.fills = [];
  frame.clipsContent = false;

  if ("opacity" in group) frame.opacity = group.opacity;
  if ("blendMode" in group) frame.blendMode = group.blendMode;
  if ("isMask" in group) frame.isMask = group.isMask;
  if ("locked" in group) frame.locked = group.locked;
  if ("visible" in group) frame.visible = group.visible;

  parent.insertChild(index >= 0 ? index : parent.children.length, frame);
  try {
    frame.resizeWithoutConstraints(targetW, targetH);
  } catch (e) {
    logError(`group→frame resize failed (${safeNodeRef(frame)})`, e);
  }
  try {
    placeLocalBox(frame, targetX, targetY);
  } catch (e) {
    logError(`group→frame place failed (${safeNodeRef(frame)})`, e);
  }

  for (const { node, snap } of children) {
    if (!node.parent) continue;
    try {
      frame.appendChild(node);
      if (snap) {
        const frameAbs = frame.absoluteBoundingBox;
        if (frameAbs) {
          placeLocalBox(node, snap.x - frameAbs.x, snap.y - frameAbs.y);
        }
      }
    } catch (e) {
      logError(`group→frame reparent failed (${safeNodeRef(node)})`, e);
    }
  }

  try {
    if (group.parent) group.remove();
  } catch (e) {
    logError(`group→frame remove failed (${safeNodeRef(group)})`, e);
  }

  // Re-assert shell to the pre-convert world box (not stale group.x).
  const parentAbs = parentAbsOrigin(parent);
  if (savedAbs) {
    try {
      frame.resizeWithoutConstraints(
        Math.max(1, savedAbs.w),
        Math.max(1, savedAbs.h),
      );
      placeLocalBox(frame, savedAbs.x - parentAbs.x, savedAbs.y - parentAbs.y);
    } catch (e) {
      logError(`group→frame reassert failed (${safeNodeRef(frame)})`, e);
    }
  } else {
    try {
      frame.resizeWithoutConstraints(targetW, targetH);
      placeLocalBox(frame, targetX, targetY);
    } catch (e) {
      logError(`group→frame reassert failed (${safeNodeRef(frame)})`, e);
    }
  }
  const frameAbs = frame.absoluteBoundingBox;
  if (frameAbs) {
    for (const { node, snap } of children) {
      if (!snap || !node.parent) continue;
      placeLocalBox(node, snap.x - frameAbs.x, snap.y - frameAbs.y);
    }
  }
  return frame;
}

/**
 * Position a node so its absoluteBoundingBox matches the snapshot, compensating
 * for rotation (node.x is the transform origin, not the AABB left).
 */
function restoreNodeAbs(node: SceneNode, target: AbsSnap): void {
  if (!("x" in node)) return;
  const parent = node.parent;
  let originX = 0;
  let originY = 0;
  if (parent && "absoluteBoundingBox" in parent && parent.absoluteBoundingBox) {
    originX = parent.absoluteBoundingBox.x;
    originY = parent.absoluteBoundingBox.y;
  }
  try {
    if ("layoutPositioning" in node) {
      (node as FrameNode).layoutPositioning = "AUTO";
    }
  } catch (e) {
    logError(`layoutPositioning write failed (${safeNodeRef(node)})`, e);
  }
  placeLocalBox(
    node,
    target.x - originX,
    target.y - originY,
    target.w,
    target.h,
  );
}

/**
 * Turn off parent Auto Layout but keep tidy wrappers: restore each direct
 * child's box from a mid-apply snapshot (taken after wrappers were built).
 */
export function revertParentAutoLayoutKeepWrappers(
  frame: FrameNode,
  mid: Map<string, AbsSnap>,
): void {
  try {
    if ("layoutMode" in frame && frame.layoutMode !== "NONE") {
      frame.layoutMode = "NONE";
    }
  } catch (e) {
    logError(`parent layoutMode NONE failed (${safeNodeRef(frame)})`, e);
  }

  const frameSnap = mid.get(frame.id);
  if (frameSnap && "resize" in frame) {
    try {
      frame.resize(Math.max(1, frameSnap.w), Math.max(1, frameSnap.h));
    } catch (e) {
      logError(`parent resize failed (${safeNodeRef(frame)})`, e);
    }
  }

  for (const child of [...frame.children] as SceneNode[]) {
    const snap = mid.get(child.id);
    if (snap) restoreNodeAbs(child, snap);
  }
}

/**
 * Revert a frame subtree to pre-tidy absolute positions: disable Auto Layout,
 * unwrap tidy wrapper frames, and restore every snapshotted descendant.
 */
export function restoreFramePixelPerfect(
  frame: FrameNode,
  before: Map<string, AbsSnap>,
): void {
  const wasLocked = frame.locked;
  if (wasLocked) frame.locked = false;

  try {
    // Auto Layout must be off before absolute repositioning is allowed.
    if ("layoutMode" in frame && frame.layoutMode !== "NONE") {
      frame.layoutMode = "NONE";
    }

    // Unwrap inference wrappers deepest-first so children land in the correct parent.
    const wrappers = frame.findAll(isTidyWrapper) as FrameNode[];
    wrappers.sort((a, b) => depthOf(b) - depthOf(a));

    for (const wrapper of wrappers) {
      const parent = wrapper.parent;
      if (!parent || !("appendChild" in parent)) continue;
      const insertAt = parent.children.indexOf(wrapper);
      const kids = [...wrapper.children];
      for (const child of kids) {
        const snap = before.get(child.id) ?? snapAbs(child);
        parent.insertChild(
          insertAt >= 0 ? insertAt : parent.children.length,
          child,
        );
        if (snap) restoreNodeAbs(child, snap);
      }
      try {
        if (wrapper.parent) wrapper.remove();
      } catch (e) {
        logError(`wrapper remove failed (${safeNodeRef(wrapper)})`, e);
      }
    }

    // Restore frame outer size from snapshot when available.
    const frameSnap = before.get(frame.id);
    if (frameSnap && "resize" in frame) {
      try {
        frame.resize(Math.max(1, frameSnap.w), Math.max(1, frameSnap.h));
      } catch (e) {
        logError(`frame resize failed (${safeNodeRef(frame)})`, e);
      }
    }

    // Walk remaining descendants — every snapshotted node returns to its absolute box.
    const restoreVisit = (node: SceneNode) => {
      const snap = before.get(node.id);
      if (snap && node.id !== frame.id) {
        restoreNodeAbs(node, snap);
      }
      if ("children" in node) {
        for (const child of (node as ChildrenMixin).children) {
          restoreVisit(child as SceneNode);
        }
      }
    };
    restoreVisit(frame);
  } finally {
    if (wasLocked) frame.locked = true;
  }
}

/** Stamp DFS paint indices on the clone before any reparenting. */
export function stampPaintOrder(root: SceneNode): void {
  let i = 0;
  const visit = (node: SceneNode) => {
    try {
      if ("setPluginData" in node) {
        (node as FrameNode).setPluginData(TIDY_PAINT_KEY, String(i++));
      }
    } catch (e) {
      logError(`stamp paint order failed (${safeNodeRef(node)})`, e);
    }
    if ("children" in node) {
      for (const child of (node as ChildrenMixin).children) {
        visit(child as SceneNode);
      }
    }
  };
  visit(root);
}

function readPaintKey(node: SceneNode): number | null {
  try {
    if (!("getPluginData" in node)) return null;
    const raw = (node as FrameNode).getPluginData(TIDY_PAINT_KEY);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Min paint key in subtree (new wrapper frames inherit from their leaves). */
export function paintKey(node: SceneNode): number {
  const own = readPaintKey(node);
  if (own !== null) return own;
  if ("children" in node && node.children.length > 0) {
    let min = Infinity;
    for (const child of (node as ChildrenMixin).children) {
      min = Math.min(min, paintKey(child as SceneNode));
    }
    if (min !== Infinity) return min;
  }
  return 1e9;
}

function isOpaqueCover(node: SceneNode): boolean {
  if (node.visible === false) return false;
  if ((node.opacity ?? 1) < 0.15) return false;
  if (
    node.type !== "RECTANGLE" &&
    node.type !== "ELLIPSE" &&
    node.type !== "VECTOR" &&
    node.type !== "FRAME" &&
    node.type !== "GROUP" &&
    node.type !== "BOOLEAN_OPERATION"
  ) {
    return false;
  }
  if (!("fills" in node)) return false;
  const fills = (node as MinimalFillsMixin).fills;
  if (fills === figma.mixed || !Array.isArray(fills)) return false;
  return fills.some(
    (f) =>
      f &&
      f.visible !== false &&
      (f.type === "SOLID" ||
        f.type === "IMAGE" ||
        f.type === "GRADIENT_LINEAR" ||
        f.type === "GRADIENT_RADIAL"),
  );
}

function collectsText(node: SceneNode): SceneNode[] {
  const out: SceneNode[] = [];
  const visit = (n: SceneNode) => {
    if (n.type === "TEXT") out.push(n);
    if ("children" in n) {
      for (const c of (n as ChildrenMixin).children) visit(c as SceneNode);
    }
  };
  visit(node);
  return out;
}

function coversCenter(cover: SceneNode, target: SceneNode): boolean {
  const cb = cover.absoluteBoundingBox;
  const tb = target.absoluteBoundingBox;
  if (!cb || !tb) return false;
  const cx = tb.x + tb.width / 2;
  const cy = tb.y + tb.height / 2;
  return (
    cx >= cb.x &&
    cx <= cb.x + cb.width &&
    cy >= cb.y &&
    cy <= cb.y + cb.height &&
    cb.width * cb.height > tb.width * tb.height * 0.5
  );
}

/**
 * Reparent opaque layers that sit on top of text but originally painted *between*
 * a wrapper's back layer and its text (e.g. contact card fill covering phone text).
 * Only touches tidy wrapper hosts — never reshuffles the whole tree.
 */
export function fixCoveringPaintOrder(root: SceneNode): void {
  const isTidyHost = (node: SceneNode): boolean => {
    try {
      return (
        node.type === "FRAME" &&
        typeof (node as FrameNode).getPluginData === "function" &&
        (node as FrameNode).getPluginData(TIDY_WRAPPER_KEY) === "1"
      );
    } catch {
      return false;
    }
  };

  const visit = (parent: SceneNode) => {
    if (!("children" in parent) || !("insertChild" in parent)) return;
    const frame = parent as FrameNode & ChildrenMixin;
    // Skip Auto Layout parents — child order is flow order.
    if (
      "layoutMode" in frame &&
      frame.layoutMode !== "NONE" &&
      frame.layoutMode !== undefined
    ) {
      for (const child of [...frame.children] as SceneNode[]) {
        visit(child);
      }
      return;
    }

    let guard = 0;
    while (guard++ < 32) {
      const kids = [...frame.children] as SceneNode[];
      let moved = false;
      for (const cover of kids) {
        if (cover.visible === false) continue;
        if (!isOpaqueCover(cover)) continue;
        const coverKey = paintKey(cover);
        for (const host of kids) {
          if (host === cover || !isTidyHost(host)) continue;
          if (
            "layoutMode" in host &&
            (host as FrameNode).layoutMode !== "NONE" &&
            (host as FrameNode).layoutMode !== undefined
          ) {
            continue;
          }
          const texts = collectsText(host).filter(
            (t) => t.visible !== false && coversCenter(cover, t),
          );
          if (texts.length === 0) continue;
          if (!texts.some((t) => paintKey(t) > coverKey)) continue;
          // Host must also contain something behind the cover (lower paint key).
          const hostKey = paintKey(host);
          if (hostKey >= coverKey) continue;

          const snap = snapAbs(cover);
          const hostKids = [...host.children] as SceneNode[];
          let at = hostKids.findIndex((k) => paintKey(k) > coverKey);
          if (at < 0) at = hostKids.length;
          try {
            host.insertChild(at, cover);
            if (snap) {
              const hb = host.absoluteBoundingBox;
              if (hb) {
                placeLocalBox(
                  cover,
                  snap.x - hb.x,
                  snap.y - hb.y,
                  snap.w,
                  snap.h,
                );
              }
            }
            moved = true;
          } catch (e) {
            logError(
              `fix covering paint order failed (${safeNodeRef(cover)})`,
              e,
            );
          }
          break;
        }
        if (moved) break;
      }
      if (!moved) break;
    }

    for (const child of [...frame.children] as SceneNode[]) {
      visit(child);
    }
  };
  visit(root);
}

/** Stable sibling order by original paint key (freeform parents only). */
export function restoreSiblingPaintOrder(root: SceneNode): void {
  const visit = (parent: SceneNode) => {
    if (!("children" in parent) || !("insertChild" in parent)) return;
    const frame = parent as FrameNode & ChildrenMixin;
    if (
      "layoutMode" in frame &&
      frame.layoutMode !== "NONE" &&
      frame.layoutMode !== undefined
    ) {
      for (const child of [...frame.children] as SceneNode[]) visit(child);
      return;
    }
    const kids = [...frame.children] as SceneNode[];
    if (kids.length >= 2) {
      const sorted = [...kids].sort((a, b) => paintKey(a) - paintKey(b));
      let same = true;
      for (let i = 0; i < kids.length; i++) {
        if (kids[i] !== sorted[i]) {
          same = false;
          break;
        }
      }
      if (!same) {
        for (let i = 0; i < sorted.length; i++) {
          try {
            frame.insertChild(i, sorted[i]);
          } catch (e) {
            logError(
              `restore sibling paint order failed (${safeNodeRef(sorted[i])})`,
              e,
            );
          }
        }
      }
    }
    for (const child of [...frame.children] as SceneNode[]) visit(child);
  };
  visit(root);
}

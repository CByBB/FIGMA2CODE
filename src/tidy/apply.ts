/** Applies an inferred TidyPlan to the live clone with pixel-drift rollback. */

import type {
  AutoLayoutSpec,
  FrameTidySpec,
  TidyPlan,
  WrapperSpec,
} from "./types";
import {
  AbsSnap,
  TIDY_WRAPPER_KEY,
  convertGroupToFrame,
  driftedIds,
  paintKey,
  placeLocalBox,
  restoreFramePixelPerfect,
  revertParentAutoLayoutKeepWrappers,
  snapAbs,
  snapTree,
} from "./preserve";
import { isRotatable } from "./classify";
import { tidyWarn } from "./warnings";
import { logError, safeNodeRef, isMissingNodeError } from "../shared/log";

async function getNode(id: string): Promise<BaseNode | null> {
  try {
    return await figma.getNodeByIdAsync(id);
  } catch (e) {
    logError(`getNodeByIdAsync failed for ${id}`, e);
    return null;
  }
}

function applyAutoLayout(frame: BaseFrameMixin, layout: AutoLayoutSpec): void {
  // FIXED outer size prevents Auto Layout from resizing the frame away from the snapshot.
  frame.layoutMode = layout.layoutMode;
  frame.primaryAxisSizingMode = "FIXED";
  frame.counterAxisSizingMode = "FIXED";
  frame.paddingLeft = layout.paddingLeft;
  frame.paddingRight = layout.paddingRight;
  frame.paddingTop = layout.paddingTop;
  frame.paddingBottom = layout.paddingBottom;
  frame.itemSpacing = layout.itemSpacing;
  // Conservative alignment: only use inferred values when they were explicitly chosen.
  frame.primaryAxisAlignItems =
    layout.primaryAxisAlignItems === "SPACE_BETWEEN"
      ? "SPACE_BETWEEN"
      : layout.primaryAxisAlignItems === "CENTER"
        ? "CENTER"
        : layout.primaryAxisAlignItems === "MAX"
          ? "MAX"
          : "MIN";
  frame.counterAxisAlignItems =
    layout.counterAxisAlignItems === "MAX"
      ? "MAX"
      : layout.counterAxisAlignItems === "CENTER"
        ? "CENTER"
        : "MIN";
  if (layout.layoutWrap === "WRAP") {
    frame.layoutWrap = "WRAP";
    if (
      typeof layout.counterAxisSpacing === "number" &&
      "counterAxisSpacing" in frame
    ) {
      (frame as FrameNode).counterAxisSpacing = layout.counterAxisSpacing;
    }
  } else if ("layoutWrap" in frame) {
    frame.layoutWrap = "NO_WRAP";
  }
}

/** Pin child to FIXED sizing so convert sees the same pixel box as before tidy. */
function pinFixedSize(node: SceneNode, w: number, h: number): void {
  if (!("layoutSizingHorizontal" in node)) return;
  const n = node as SceneNode & {
    layoutSizingHorizontal: "FIXED" | "HUG" | "FILL";
    layoutSizingVertical: "FIXED" | "HUG" | "FILL";
    layoutAlign: "MIN" | "CENTER" | "MAX" | "STRETCH" | "INHERIT";
    layoutGrow: number;
  };
  try {
    n.layoutSizingHorizontal = "FIXED";
    n.layoutSizingVertical = "FIXED";
    n.layoutGrow = 0;
    n.layoutAlign = "INHERIT";
    // AABB size ≠ layout size when rotated — resizing to the box grows the node.
    // Zero-width/height lines must not be forced to 1px (that alone fails pixel checks).
    // TEXT resize needs fonts loaded; skip no-op resizes to avoid glyph churn.
    if (
      "resize" in n &&
      !isRotatable(n) &&
      node.type !== "LINE" &&
      w >= 0.5 &&
      h >= 0.5
    ) {
      const curW = "width" in node ? Math.abs(node.width) : w;
      const curH = "height" in node ? Math.abs(node.height) : h;
      if (Math.abs(curW - w) > 0.5 || Math.abs(curH - h) > 0.5) {
        (n as LayoutMixin).resize(Math.max(1, w), Math.max(1, h));
      }
    }
  } catch (e) {
    logError(`layout sizing write failed (${safeNodeRef(n)})`, e);
  }
}

function parentAllowsAbsolute(node: SceneNode): boolean {
  const parent = node.parent;
  return Boolean(
    parent &&
    "layoutMode" in parent &&
    (parent as BaseFrameMixin).layoutMode !== "NONE",
  );
}

function applyAbsoluteAt(
  node: SceneNode,
  x: number,
  y: number,
  w?: number,
  h?: number,
): void {
  try {
    if (parentAllowsAbsolute(node) && "layoutPositioning" in node) {
      (node as FrameNode).layoutPositioning = "ABSOLUTE";
    }
  } catch (e) {
    logError(`layoutPositioning ABSOLUTE failed (${safeNodeRef(node)})`, e);
  }
  placeLocalBox(node, x, y, w, h);
}

function safeRemove(node: BaseNode): void {
  try {
    if (!node.parent) return;
    node.remove();
  } catch (e) {
    if (isMissingNodeError(e)) return;
    logError(`node remove failed (${safeNodeRef(node)})`, e);
  }
}

function parentAbsOrigin(node: BaseNode | null): { x: number; y: number } {
  if (node && "absoluteBoundingBox" in node && node.absoluteBoundingBox) {
    return {
      x: node.absoluteBoundingBox.x,
      y: node.absoluteBoundingBox.y,
    };
  }
  return { x: 0, y: 0 };
}

function unwrapGroup(group: GroupNode): SceneNode {
  const parent = group.parent;
  if (!parent || !("appendChild" in parent) || group.children.length !== 1) {
    return group;
  }
  const child = group.children[0];
  const snap = snapAbs(child);
  const index = parent.children.indexOf(group);
  parent.insertChild(index >= 0 ? index : parent.children.length, child);
  if (snap && "x" in child) {
    const dest = parentAbsOrigin(parent);
    placeLocalBox(child, snap.x - dest.x, snap.y - dest.y);
  }
  safeRemove(group);
  return child;
}

async function createWrapperFrame(
  parent: BaseFrameMixin & ChildrenMixin,
  spec: WrapperSpec,
  before: Map<string, AbsSnap>,
): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.name = spec.name;
  frame.fills = [];
  frame.clipsContent = false;
  frame.setPluginData(TIDY_WRAPPER_KEY, "1");
  frame.resizeWithoutConstraints(
    Math.max(1, spec.bounds.width),
    Math.max(1, spec.bounds.height),
  );
  frame.x = spec.bounds.x;
  frame.y = spec.bounds.y;

  const moved: Array<{
    node: SceneNode;
    snap: AbsSnap | null;
    index: number;
  }> = [];
  for (const id of spec.childNodeIds) {
    const n = await getNode(id);
    if (!n || n.type === "DOCUMENT" || n.type === "PAGE") continue;
    const child = n as SceneNode;
    if (!("x" in child)) continue;
    const index = parent.children.indexOf(child);
    moved.push({
      node: child,
      snap: before.get(child.id) ?? snapAbs(child),
      index: index >= 0 ? index : parent.children.length,
    });
  }

  const insertAt =
    moved.length > 0
      ? Math.min(...moved.map((m) => m.index))
      : parent.children.length;

  parent.insertChild(insertAt, frame);

  // Append in original paint order so backgrounds stay under text (not LTR sort).
  moved.sort((a, b) => paintKey(a.node) - paintKey(b.node));

  const placeMoved = () => {
    const fa = frame.absoluteBoundingBox;
    for (const { node, snap } of moved) {
      if (!snap || !fa) continue;
      placeLocalBox(node, snap.x - fa.x, snap.y - fa.y, snap.w, snap.h);
      pinFixedSize(node, snap.w, snap.h);
    }
  };

  for (const { node } of moved) {
    frame.appendChild(node);
  }
  placeMoved();

  // Nested wrappers (row/col inside a canyon column) — bounds are local to `frame`.
  for (const nested of spec.wrappers ?? []) {
    await createWrapperFrame(frame, nested, before);
  }

  // Positions after grouping, before this wrapper's Auto Layout.
  const midWrap = snapTree(frame);

  // Try Auto Layout; if it shifts pixels, keep the group frame with freeform children.
  applyAutoLayout(frame, {
    ...spec.layout,
    primaryAxisAlignItems: "MIN",
    counterAxisAlignItems: "MIN",
    primaryAxisSizingMode: "FIXED",
    counterAxisSizingMode: "FIXED",
  });
  frame.resizeWithoutConstraints(
    Math.max(1, spec.bounds.width),
    Math.max(1, spec.bounds.height),
  );
  for (const { node, snap } of moved) {
    if (snap) pinFixedSize(node, snap.w, snap.h);
  }

  const bad = driftedIds(frame, before);
  if (bad.length > 0) {
    try {
      frame.layoutMode = "NONE";
    } catch (e) {
      logError(`wrapper layoutMode NONE failed (${safeNodeRef(frame)})`, e);
    }
    frame.resizeWithoutConstraints(
      Math.max(1, spec.bounds.width),
      Math.max(1, spec.bounds.height),
    );
    frame.x = spec.bounds.x;
    frame.y = spec.bounds.y;
    const fa = frame.absoluteBoundingBox;
    for (const child of [...frame.children] as SceneNode[]) {
      const s = midWrap.get(child.id);
      if (s && fa) {
        placeLocalBox(child, s.x - fa.x, s.y - fa.y, s.w, s.h);
      }
    }
  }

  return frame;
}

async function applyFrameSpec(
  spec: FrameTidySpec,
  before: Map<string, AbsSnap>,
): Promise<void> {
  if (spec.skipLayout) return;
  const node = await getNode(spec.nodeId);
  if (!node || !("children" in node) || !("layoutMode" in node)) return;

  const frame = node as FrameNode;
  const wasLocked = frame.locked;
  if (wasLocked) frame.locked = false;

  const frameSnap = before.get(frame.id) ?? snapAbs(frame);
  const preChildren = snapTree(frame);

  try {
    for (const wrapper of spec.wrappers) {
      await createWrapperFrame(frame, wrapper, before);
    }

    // Snapshot after nested wrappers exist — used if parent AL must roll back alone.
    const mid = snapTree(frame);
    const wrapDrift = driftedIds(frame, before);
    if (wrapDrift.length > 0) {
      tidyWarn(
        `Reverted wrappers on "${frame.name}" — would shift ${wrapDrift.length} layer(s)`,
      );
      restoreFramePixelPerfect(frame, before);
      return;
    }

    const bgId = spec.foldBackgroundId || spec.stretchBackgroundId;
    let bg: SceneNode | null = null;
    if (bgId) {
      const n = await getNode(bgId);
      if (n && n.type !== "DOCUMENT" && n.type !== "PAGE") {
        bg = n as SceneNode;
      }
    }
    const overlayNodes: {
      node: SceneNode;
      abs: (typeof spec.absoluteChildren)[number];
    }[] = [];
    for (const abs of spec.absoluteChildren) {
      const child = await getNode(abs.nodeId);
      if (!child || child.type === "DOCUMENT" || child.type === "PAGE")
        continue;
      overlayNodes.push({ node: child as SceneNode, abs });
    }

    const pinAbsoluteChildren = () => {
      const frameAbsNow = frame.absoluteBoundingBox;
      if (bg) {
        const snap = before.get(bg.id) ?? snapAbs(bg);
        if (snap && frameAbsNow) {
          applyAbsoluteAt(
            bg,
            snap.x - frameAbsNow.x,
            snap.y - frameAbsNow.y,
            snap.w,
            snap.h,
          );
        }
      }
      for (const { node: child, abs } of overlayNodes) {
        const snap = before.get(abs.nodeId);
        if (snap && frameAbsNow) {
          applyAbsoluteAt(
            child,
            snap.x - frameAbsNow.x,
            snap.y - frameAbsNow.y,
            snap.w,
            snap.h,
          );
        } else {
          applyAbsoluteAt(child, abs.x, abs.y);
        }
      }
    };

    if (spec.layout) {
      const w = frameSnap?.w ?? frame.width;
      const h = frameSnap?.h ?? frame.height;
      const absoluteIds = new Set(
        [
          spec.foldBackgroundId,
          spec.stretchBackgroundId,
          ...spec.absoluteChildren.map((a) => a.nodeId),
        ].filter((id): id is string => Boolean(id)),
      );

      // Pin flow children to FIXED before enabling Auto Layout so reflow cannot resize them.
      for (const child of [...frame.children]) {
        if (absoluteIds.has(child.id)) continue;
        if (
          "layoutPositioning" in child &&
          (child as FrameNode).layoutPositioning === "ABSOLUTE"
        ) {
          continue;
        }
        const snap = before.get(child.id) ?? preChildren.get(child.id);
        if (snap) pinFixedSize(child, snap.w, snap.h);
        else if ("width" in child) {
          pinFixedSize(child, child.width, child.height);
        }
      }

      applyAutoLayout(frame, {
        ...spec.layout,
        // Only honor MAX/CENTER when inference explicitly detected them; otherwise MIN for stability.
        counterAxisAlignItems:
          spec.layout.counterAxisAlignItems === "MAX" ||
          spec.layout.counterAxisAlignItems === "CENTER"
            ? spec.layout.counterAxisAlignItems
            : "MIN",
      });
      frame.resize(Math.max(1, w), Math.max(1, h));
      frame.primaryAxisSizingMode = "FIXED";
      frame.counterAxisSizingMode = "FIXED";

      // Pull overlays/backgrounds out of the flow before padding can stack them.
      for (const child of [...frame.children]) {
        if (!absoluteIds.has(child.id)) continue;
        try {
          if ("layoutPositioning" in child) {
            (child as FrameNode).layoutPositioning = "ABSOLUTE";
          }
        } catch (e) {
          logError(
            `layoutPositioning ABSOLUTE failed (${safeNodeRef(child)})`,
            e,
          );
        }
      }

      // ABSOLUTE is only valid after the parent has Auto Layout.
      pinAbsoluteChildren();

      // Auto Layout can still nudge text/hug nodes — re-pin from the snapshot.
      for (const child of [...frame.children]) {
        if (
          "layoutPositioning" in child &&
          (child as FrameNode).layoutPositioning === "ABSOLUTE"
        ) {
          const snap = before.get(child.id);
          const fa = frame.absoluteBoundingBox;
          if (snap && fa) {
            applyAbsoluteAt(
              child,
              snap.x - fa.x,
              snap.y - fa.y,
              snap.w,
              snap.h,
            );
          }
          continue;
        }
        const snap = before.get(child.id) ?? preChildren.get(child.id);
        if (snap) pinFixedSize(child, snap.w, snap.h);
      }
    } else {
      pinAbsoluteChildren();
    }

    // Revert this frame if any descendant moved — convert must see identical pixels.
    // Prefer keeping successful nested wrappers when only the parent stack drifts.
    const bad = driftedIds(frame, before);
    if (bad.length > 0) {
      if (spec.wrappers.length > 0) {
        tidyWarn(
          `Kept nested wrappers on "${frame.name}" — parent Auto Layout reverted (${bad.length} layer(s))`,
        );
        revertParentAutoLayoutKeepWrappers(frame, mid);
        if (driftedIds(frame, before).length > 0) {
          tidyWarn(
            `Reverted Auto Layout on "${frame.name}" — would shift ${bad.length} layer(s)`,
          );
          restoreFramePixelPerfect(frame, before);
        }
      } else {
        tidyWarn(
          `Reverted Auto Layout on "${frame.name}" — would shift ${bad.length} layer(s)`,
        );
        restoreFramePixelPerfect(frame, before);
      }
    }
  } finally {
    if (wasLocked) frame.locked = true;
  }
}

/**
 * Mutates the clone tree in place. Any frame that would shift pixels is rolled back
 * to freeform absolute positions matching the pre-apply snapshot.
 */
export async function applyTidyPlan(
  plan: TidyPlan,
  root: SceneNode,
): Promise<void> {
  const unwrapIds = [...new Set(plan.groupsToUnwrap)];
  const frameIds = [...new Set(plan.groupsToFrame)];

  for (const id of unwrapIds) {
    const n = await getNode(id);
    if (n && n.type === "GROUP") {
      unwrapGroup(n as GroupNode);
    }
  }

  const idRemap = new Map<string, string>();
  for (const id of frameIds) {
    const n = await getNode(id);
    if (!n) continue;
    if (n.type === "GROUP") {
      const frame = convertGroupToFrame(n as GroupNode);
      idRemap.set(id, frame.id);
    } else if (n.type === "FRAME") {
      idRemap.set(id, n.id);
    }
  }

  const mapId = (id: string) => idRemap.get(id) ?? id;

  const remapWrapper = (wrapper: WrapperSpec) => {
    wrapper.childNodeIds = wrapper.childNodeIds.map(mapId);
    for (const sizing of wrapper.childSizing) {
      sizing.nodeId = mapId(sizing.nodeId);
    }
    for (const nested of wrapper.wrappers ?? []) {
      remapWrapper(nested);
    }
  };

  for (const spec of plan.frames) {
    spec.nodeId = mapId(spec.nodeId);
    if (spec.foldBackgroundId) {
      spec.foldBackgroundId = mapId(spec.foldBackgroundId);
    }
    if (spec.stretchBackgroundId) {
      spec.stretchBackgroundId = mapId(spec.stretchBackgroundId);
    }
    for (const abs of spec.absoluteChildren) {
      abs.nodeId = mapId(abs.nodeId);
    }
    for (const sizing of spec.childSizing) {
      sizing.nodeId = mapId(sizing.nodeId);
    }
    for (const wrapper of spec.wrappers) {
      remapWrapper(wrapper);
    }
  }

  // Snapshot after group→frame conversion (visually identical) but before Auto Layout runs.
  const before = snapTree(root);

  // Deepest frames first so parent layout sees finalized child structure.
  const ordered = [...plan.frames].reverse();
  for (const spec of ordered) {
    await applyFrameSpec(spec, before);
  }

  // Do not restoreFramePixelPerfect the page when it is already a flow stack —
  // that sets layoutMode NONE and leaves sections on absolute Y from the page top.
  const page = root.type === "FRAME" ? (root as FrameNode) : null;
  if (page && page.layoutMode === "NONE") {
    const finalBad = driftedIds(root, before);
    if (finalBad.length > 0) {
      tidyWarn(
        `Final pixel check failed (${finalBad.length} layers) — restoring freeform on root`,
      );
      restoreFramePixelPerfect(page, before);
    }
  }
}

/* =============================================================================
   desktopPanel.js — the "desktop" PANEL TYPE
   -----------------------------------------------------------------------------
   A miniature Windows-style desktop, full-viewport, with draggable icons and
   stackable windows. Folders are containers (their windows host other icons,
   draggable in and out). Files of any registered type open their own windows
   (the type controls what's inside).

   THE FILE-TYPE SUB-REGISTRY
     Mirrors the project's panel-type / scene-type pattern at a smaller
     scope. File-type modules import `registerFileType` from this file and
     self-register on import; main.js side-effect-imports them to wire them
     in. The desktop never names a specific file type.

     The contract:
       registerFileType("image", {
         buildIcon(file)          — returns the inner DOM of the icon
         buildWindow(file, win)   — returns the inner DOM of the window
                                      `win` is a narrow handle:
                                      {
                                        fitToContent(w, h),  // ask the panel
                                                             //   to resize to
                                                             //   given aspect
                                        close(),             // programmatic
                                                             //   close
                                        onMinimize(fn),      // subscribe to
                                                             //   minimize
                                        onRestore(fn),       // subscribe to
                                                             //   restore
                                        onClose(fn),         // subscribe to
                                                             //   teardown
                                                             //   (fires
                                                             //   BEFORE DOM
                                                             //   destruction)
                                      }
         defaultWindow: { width, height }   — optional
       });

     onMinimize / onRestore / onClose are the lifecycle subscription
     channel — used by media file types to pause/resume on minimize and
     to commit per-window state (playback position, etc.) on close. See
     populateFileWindow for the full handle docs and ordering rationale.

   FOLDER IS BUILT-IN, NOT A REGISTERED FILE TYPE
     Folder is the container concept this whole panel depends on. Making it
     pluggable would push the drop-target / reparenting / hit-test logic
     into the file-type contract, which is a lot of abstraction for one
     container kind. If a second kind ever appears (tabbed window, stack
     view), we generalise then.

   STATE MODEL — FLAT, PARENT-POINTERED
     On init, the authored hierarchy is flattened into `state.items`, a
     Map<itemId, item>. Every item carries `parent` (the desktop, or a
     folder item's id). Reparenting a file = update item.parent. Listing
     a folder's contents = filter items by parent.

     Authored data is read once and never mutated; the live state is the
     mutable layer. Scrolling away and back to a DIFFERENT desktop panel
     of the same type leaves its state intact (per-instance Maps).

   DRAG PORTAL
     During an icon drag, the icon is reparented to `state.surface` (the
     desktop layer) so the folder window's `overflow:hidden` doesn't clip
     it mid-drag. Coordinates translate window-space → desktop-space on
     drag start, and desktop-space → final-container-space on drag end.

   COUPLED WITH
     - infiniteScroll.js: registerPanelType, registerWeight, isClearToEnter.
     - desktopDraggable.js: makeDraggable.
     - desktopStyles.css: emits all .desktop-* classes used here.
     - main.js: importing this file installs the "desktop" type.
   ========================================================================== */

import { registerPanelType, registerWeight, isClearToEnter } from "./infiniteScroll.js";
import { makeDraggable } from "./desktopDraggable.js";
import { buildTaskbar } from "./desktopTaskbar.js";
import { isLocked, requestUnlock } from "./desktopLockGate.js";

/* -----------------------------------------------------------------------------
   FILE-TYPE SUB-REGISTRY
   -----------------------------------------------------------------------------
   A Map keyed by type name. File-type modules call registerFileType at
   import time. Lookups in this module use getFileType, which returns null
   for unknown types (silent no-op rather than throw — matches the
   self-guarding style of invokeSceneAction).
   --------------------------------------------------------------------------- */
const fileTypes = new Map();

export function registerFileType(name, def) {
  fileTypes.set(name, def);
}

function getFileType(name) {
  return fileTypes.get(name) || null;
}

/* -----------------------------------------------------------------------------
   PANEL-TYPE TUNABLES (local on purpose — type-local lives in the type file)
   -----------------------------------------------------------------------------
   THE WIREFRAME ASSEMBLY ANIMATION
     `state.grow` is the single channel that drives both the handoff gate
     (other panels wait for it to reach near-0) and the entrance/exit
     visual. The visual is a "wireframe drawing itself" — a dark dot
     grows horizontally into a hairline, then the line splits, top half
     sliding up and bottom half sliding down, with side edges growing
     to keep them connected. The result is the rectangular border of
     the desktop screen, which then remains as the screen's permanent
     chrome.

     The desktop content inside is revealed via clip-path that exactly
     matches the rectangle bounded by the four moving lines — as the
     frame draws itself, the content appears within it.

     Phases of grow:
       [0,         LINE_END ]  horizontal sweep (dot → hairline at centre)
       [LINE_END,  OPEN_END ]  vertical split (line → rectangle outline)
       [OPEN_END,  1.0      ]  settled (no further visual change)

     Easing is ASYMMETRIC — slower on the way in, faster on the way out.
     Same rationale as before: the rise has character; the fall should
     not delay the next panel's entry.
   --------------------------------------------------------------------------- */
const BLOOM_SPEED_IN     = 3.0;    // ease rate (s⁻¹) when grow is rising.
                                   //   ~1s to reach 95%. Reads as a
                                   //   deliberate, character-laden draw-on.
const BLOOM_SPEED_OUT    = 8.0;    // ease rate when grow is falling.
                                   //   ~0.4s to drop to 5%. Snappier exit
                                   //   so other panels don't wait too long.

const LINE_END           = 0.20;   // grow value at which the horizontal
                                   //   sweep completes — the central
                                   //   hairline reaches the screen's
                                   //   full width.
const OPEN_END           = 0.75;   // grow value at which the rectangle
                                   //   outline finishes assembling —
                                   //   top + bottom lines have reached
                                   //   their final positions, sides
                                   //   are fully drawn.

const INTERACT_THRESHOLD = 0.7;    // grow level at which .is-clear flips on,
                                   //   gating pointer-events on the desktop's
                                   //   interactive bits. Same value as
                                   //   turnPanel.js — see its comment on why
                                   //   this is independent of .is-active.
                                   //   At 0.7, the frame is ~92% assembled
                                   //   (ySplit ≈ 0.92) — visually stable
                                   //   enough to interact with.

const ICON_W             = 88;     // icon hit-target width in px. CSS sizes
                                   //   the visible artwork inside; this is
                                   //   the auto-layout cell width.
const ICON_H             = 96;     // icon hit-target height in px.

const ICON_PAD           = 24;     // pad from container edge for auto-layout.
const ICON_GAP_X         = 8;      // gap between icons in auto-layout (x).
const ICON_GAP_Y         = 8;      // gap between icons in auto-layout (y).

const WIN_DEFAULT_W      = 520;    // default window width if file-type doesn't
                                   //   override.
const WIN_DEFAULT_H      = 380;    // default window height if file-type
                                   //   doesn't override.
const WIN_MIN_W          = 240;    // refuse to shrink below this when fitting.
const WIN_MIN_H          = 180;
const WIN_VIEWPORT_FRAC  = 0.82;   // max window size as a fraction of the
                                   //   panel viewport. Keeps a margin around
                                   //   the window even at maximum fit.

const WIN_STACK_OFFSET   = 28;     // each newly-opened window offsets from
                                   //   the previous by this much, so a stack
                                   //   of windows doesn't perfectly overlap.

const HEADER_H           = 36;     // window header (drag handle) height. Used
                                   //   for clamping — title bar must stay
                                   //   inside the viewport.

/* -----------------------------------------------------------------------------
   PER-INSTANCE STATE
   -----------------------------------------------------------------------------
   One entry per panel of this type, keyed by panel index. Created in
   buildDOM (so the DOM refs are available immediately); populated further
   in init.
   --------------------------------------------------------------------------- */
const instances = new Map();

/* -----------------------------------------------------------------------------
   MATH HELPERS
   --------------------------------------------------------------------------- */

// Classic smoothstep — clamps x into [edge0, edge1], normalises to [0,1],
// then applies the 3x²-2x³ Hermite curve. Used by tick() to map ranges of
// `grow` onto the bloom animation's visual properties (scaleX, scaleY,
// phosphor opacity) with soft edges instead of linear ramps.
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/* -----------------------------------------------------------------------------
   STATE HELPERS
   -----------------------------------------------------------------------------
   Item ids are deterministic per panel + path through the authored
   hierarchy: "5:2:0" = panel 5, top-level item 2, child item 0. Reading
   an id tells you who owns it. Reparenting changes parent, not id.
   --------------------------------------------------------------------------- */
function flattenAuthoredItems(panelIndex, authored) {
  // Walks the authored tree and returns a flat Map of item state.
  // Folders nest arbitrarily — each item's `parent` field captures
  // the tree shape, so depth is unbounded by this function. The drag
  // system supports arbitrary nesting at runtime (a user can drop a
  // folder into another folder's window and the item's `parent` is
  // just updated); authored data follows the same model so what
  // an author can write matches what a user can build by dragging.
  //
  // Item ids are deterministic from authoring order — "panelIdx:i:j:k"
  // for a depth-3 entry. Readable from a glance ("third child of
  // first child of second top-level item on panel 0") and stable
  // across re-mounts.
  //
  // x/y start as null — the sentinel for "auto-layout will assign this
  // on first render." Using null (not 0/0) means a user-positioned icon
  // at (0, 0) doesn't get clobbered as if it had never been positioned.
  const items = new Map();

  function flatten(entry, parent, id) {
    items.set(id, {
      id,
      type: entry.type,
      name: entry.name || "",
      parent,
      x: null, y: null,
      ...spreadTypeFields(entry),
      windowState: null,
    });

    if (entry.type === "folder" && Array.isArray(entry.contents)) {
      entry.contents.forEach((child, j) => {
        flatten(child, id, `${id}:${j}`);
      });
    }
  }

  const list = authored.items || [];
  list.forEach((entry, i) => {
    flatten(entry, "desktop", `${panelIndex}:${i}`);
  });

  return items;
}

function spreadTypeFields(authoredEntry) {
  // Copy everything that isn't a structural field (type / name / contents)
  // onto the item. Lets file-types declare arbitrary authored fields
  // (src, alt, content, ...) without this module knowing them.
  const out = {};
  for (const k of Object.keys(authoredEntry)) {
    if (k === "type" || k === "name" || k === "contents") continue;
    out[k] = authoredEntry[k];
  }
  return out;
}

function childrenOf(state, parentId) {
  // All items whose current parent is parentId. Order is insertion order
  // (Map preserves it), which matches authored order at first render and
  // reflects drop order after reparenting.
  const out = [];
  for (const item of state.items.values()) {
    if (item.parent === parentId) out.push(item);
  }
  return out;
}

/* -----------------------------------------------------------------------------
   AUTO-LAYOUT — assign x,y to icons that don't have positions yet
   -----------------------------------------------------------------------------
   A simple column-major grid: pack downward inside the container, wrap to
   the next column when out of vertical room. Called once per container
   when its icons first need positions (top-level items at init; folder
   children when the folder first opens).

   The `startIndex` parameter shifts the slot numbering — used when adding
   a single new item to a container that already has items placed: pass
   the count of already-placed siblings as startIndex so the new item
   goes to the next available slot in column-major order rather than to
   slot 0 (which would overlap the first existing icon).
   --------------------------------------------------------------------------- */
function autoLayoutIcons(items, containerW, containerH, startIndex = 0) {
  const colHeight = Math.max(1, Math.floor((containerH - ICON_PAD * 2 + ICON_GAP_Y) / (ICON_H + ICON_GAP_Y)));
  items.forEach((item, i) => {
    const slot = startIndex + i;
    const col = Math.floor(slot / colHeight);
    const row = slot % colHeight;
    item.x = ICON_PAD + col * (ICON_W + ICON_GAP_X);
    item.y = ICON_PAD + row * (ICON_H + ICON_GAP_Y);
  });
}

/* -----------------------------------------------------------------------------
   ICON DOM
   -----------------------------------------------------------------------------
   The outer wrapper is built by the panel; the inside (thumbnail / glyph /
   label) is built by the file-type via buildIcon (or by the built-in folder
   path). The wrapper handles positioning, drag, click, and the
   .is-dragging visual state.

   The icon's element stays in the items Map's per-item record as `el` so
   we can find it for reparenting / removal without DOM queries.
   --------------------------------------------------------------------------- */
function buildIconEl(state, item) {
  const el = document.createElement("div");
  el.className = `desktop-icon desktop-icon--${item.type}`;
  el.style.width = `${ICON_W}px`;
  el.style.height = `${ICON_H}px`;
  positionEl(el, item.x, item.y);

  // Inner content: folder gets a built-in glyph; files defer to their
  // file-type's buildIcon. Unknown file types render an empty placeholder
  // (silent fallback — matches the project's "missing things are silent
  // no-ops" rule).
  let inner;
  if (item.type === "folder") {
    inner = buildFolderIconInner(item);
  } else {
    const ft = getFileType(item.type);
    inner = ft && ft.buildIcon ? ft.buildIcon(item) : document.createElement("div");
  }
  inner.classList.add("desktop-icon-inner");
  el.appendChild(inner);

  // Per-icon tint. If the author put `lineColor` and/or `fillColor` on
  // the entry, apply them as the --icon-line and --icon-fill CSS
  // variables on this element. Glyphs that use currentColor for strokes
  // pick up --icon-line; glyph paths marked with class="desktop-glyph-fill"
  // pick up --icon-fill. Raster-image types ignore both because <img>
  // doesn't read either. Both variables fall back to sensible defaults
  // in CSS when not set here, so authoring just one of the two works.
  if (item.lineColor) {
    el.style.setProperty("--icon-line", item.lineColor);
  }
  if (item.fillColor) {
    el.style.setProperty("--icon-fill", item.fillColor);
  }

  const label = document.createElement("div");
  label.className = "desktop-icon-label";
  label.textContent = item.name;
  el.appendChild(label);

  // Locked marker. The panel only emits the class; the badge itself is
  // pure CSS in desktopLockGateStyles.css (::after) — the same
  // emit/consume split as .is-clear and the taskbar. isLocked comes from
  // the gate module so badge and open-intercept can't disagree on what
  // "locked" means (locked: true without a password is NOT locked).
  el.classList.toggle("is-locked", isLocked(item));

  wireIconInteraction(state, item, el);

  // Store the live DOM reference on the item. Lets callers find an
  // icon's element via state.items.get(id).el without DOM queries.
  // After a folder window closes the icon's el is detached, but the
  // reference is still valid — operations like positionEl(el, ...) on
  // a detached node are silent no-ops (the transform sticks for when
  // the node is re-attached). On folder reopen, buildIconEl is called
  // again and overwrites item.el with the new node.
  item.el = el;
  return el;
}

function buildFolderIconInner(_item) {
  // Built-in folder glyph. SVG is inline so the icon stays a single DOM
  // node with no external asset dependency. Tabbed-folder silhouette,
  // currentColor for stroke so --icon-line tints the outline, and the
  // body path is marked class="desktop-glyph-fill" so --icon-fill tints
  // the interior (default near-transparent white via CSS fallback).
  const wrap = document.createElement("div");
  wrap.className = "desktop-folder-glyph";
  wrap.innerHTML = `
    <svg viewBox="0 0 48 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3 9 H18 L22 13 H45 V35 H3 Z"
            class="desktop-glyph-fill"
            stroke="currentColor" stroke-width="1.5"
            stroke-linejoin="round" />
      <path d="M3 15 H45" stroke="currentColor" stroke-width="1" opacity="0.5" />
    </svg>
  `;
  return wrap;
}

function positionEl(el, x, y) {
  // translate3d to keep the icon on its own compositor layer during drag.
  el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
}

/* -----------------------------------------------------------------------------
   ICON INTERACTION — click opens, drag moves (with portal + reparenting)
   -----------------------------------------------------------------------------
   onDragStart records the icon's starting position and reparents the
   icon to the desktop surface (portal) so it can move across container
   boundaries without being clipped. Coordinates are translated into
   surface-space at that moment.

   onDrag writes the icon's transform from the recorded start + delta.

   onDragEnd hit-tests against any open folder windows (in z-order, top
   first) and the desktop. The target container determines the new parent
   and the coordinate space; the icon is reparented there (unless target
   is the same as origin, in which case no reparent is needed). For a
   non-container drop target (e.g. an image window), we snap the icon
   back to its origin — drag is a no-op.
   --------------------------------------------------------------------------- */
function wireIconInteraction(state, item, el) {
  // dragInfo lives for the duration of one drag. Stored last position lets
  // onDragEnd hit-test from a single source of truth (the model) rather
  // than parsing the element's transform back out of CSS.
  let dragInfo = null;

  makeDraggable(el, {
    onClick: () => {
      // Locked items route through the gate instead of opening. Drag is
      // deliberately NOT intercepted — the lock guards opening, not
      // arranging. On a correct key the gate unlocks the live item
      // (session-only) and calls back here to open it.
      if (isLocked(item)) {
        requestUnlock(state, item, () => openWindowFor(state, item));
        return;
      }
      openWindowFor(state, item);
    },

    onDragStart: () => {
      el.classList.add("is-dragging");

      // Convert the icon's current position to surface-space. If the icon
      // is currently inside a folder window's content area, add the
      // window's offset (and the header height) to translate.
      let surfaceX = item.x;
      let surfaceY = item.y;
      if (item.parent !== "desktop") {
        const win = state.windows.get(item.parent);
        if (win) {
          surfaceX = win.x + item.x;
          surfaceY = win.y + HEADER_H + item.y;
        }
      }

      // Reparent the icon to the surface (the drag portal). The browser
      // keeps event flow intact across reparenting because pointer
      // capture is on the element itself, not its parent.
      state.surface.appendChild(el);
      positionEl(el, surfaceX, surfaceY);

      dragInfo = {
        startSurfaceX: surfaceX,
        startSurfaceY: surfaceY,
        lastX: surfaceX,
        lastY: surfaceY,
        candidateEl: null,    // current drop-target element with .is-drop-candidate
      };
    },

    onDrag: (dx, dy) => {
      if (!dragInfo) return;
      dragInfo.lastX = dragInfo.startSurfaceX + dx;
      dragInfo.lastY = dragInfo.startSurfaceY + dy;
      positionEl(el, dragInfo.lastX, dragInfo.lastY);

      // Drop-candidate highlight. Hit-test against the same predicate
      // onDragEnd will use, then add/remove .is-drop-candidate on the
      // target element. We track the current candidate so we can move
      // the class off it on the next pointer move (rather than scanning
      // the DOM each frame).
      const cx = dragInfo.lastX + ICON_W / 2;
      const cy = dragInfo.lastY + ICON_H / 2;
      const target = findDropTarget(state, cx, cy, item);

      let candidateEl = null;
      if (target.kind === "folder") {
        // Highlight what the pointer is OVER — the window if we hit-
        // tested via the window's content area, the icon if we hit-
        // tested via the icon. Both are valid drop visualisations;
        // matching the pointer's actual location feels right.
        if (target.via === "window") {
          const folderWin = state.windows.get(target.folderId);
          if (folderWin) candidateEl = folderWin.el;
        } else {
          const folderItem = state.items.get(target.folderId);
          if (folderItem) candidateEl = folderItem.el;
        }
      }

      if (candidateEl !== dragInfo.candidateEl) {
        if (dragInfo.candidateEl) dragInfo.candidateEl.classList.remove("is-drop-candidate");
        if (candidateEl) candidateEl.classList.add("is-drop-candidate");
        dragInfo.candidateEl = candidateEl;
      }
    },

    onDragEnd: () => {
      if (!dragInfo) return;
      el.classList.remove("is-dragging");

      // Clear the drop-candidate highlight before doing the drop —
      // otherwise a brief flash of the candidate's highlight remains
      // after the drop completes.
      if (dragInfo.candidateEl) {
        dragInfo.candidateEl.classList.remove("is-drop-candidate");
      }

      const finalX = dragInfo.lastX;
      const finalY = dragInfo.lastY;

      // Use the icon's centre for a more forgiving drop test. Walk
      // windows in descending z-order so the topmost wins.
      const cx = finalX + ICON_W / 2;
      const cy = finalY + ICON_H / 2;

      const target = findDropTarget(state, cx, cy, item);

      if (target.kind === "folder") {
        dropIntoFolder(state, item, target.folderId, el, finalX, finalY);
      } else if (target.kind === "desktop") {
        // Drop on the desktop. Surface-space IS desktop-space.
        reparentItem(state, item, "desktop", el, state.surface, finalX, finalY);
      } else {
        // Dropped on a non-container window (or somewhere otherwise
        // invalid). Snap back to the icon's origin — drag was a no-op.
        snapBackToOrigin(state, item, el);
      }

      dragInfo = null;
    },
  });
}

function findDropTarget(state, surfaceX, surfaceY, draggingItem) {
  // Two-pass hit test, in painting/z-order priority:
  //
  //   1. Open windows (top-z first). A drop inside a folder window's
  //      content area resolves to that folder. A drop on a folder window
  //      header, or inside any non-folder window, is invalid (snap back).
  //
  //   2. Folder icons on the desktop. A folder's icon is a valid drop
  //      target even when its window is closed — dropping there moves
  //      the dragged item into the folder logically; it'll appear inside
  //      the folder the next time it's opened.
  //
  //   3. Default: the desktop.
  //
  // The two folder targets (window vs icon) return the SAME shape so the
  // caller doesn't need to branch on how the folder was hit. The caller
  // does check separately whether the drop point falls inside an open
  // window's content area to decide between "exact position" placement
  // and "next available slot" placement.

  // Pass 1: open windows.
  const winsByZ = Array.from(state.windows.values()).sort((a, b) => b.zIndex - a.zIndex);

  for (const win of winsByZ) {
    // Minimized windows preserve their geometry (so restore puts them
    // back where they were) but they're invisible — skip them for
    // hit-testing so drops fall through to whatever's actually visible
    // underneath.
    if (win.minimized) continue;
    if (surfaceX >= win.x && surfaceX <= win.x + win.w &&
        surfaceY >= win.y && surfaceY <= win.y + win.h) {
      // Inside this window's bounds. Is it a folder window?
      const item = state.items.get(win.itemId);
      if (item && item.type === "folder" && item.id !== draggingItem.id) {
        // Inside folder window. Check we're in the CONTENT area (below header).
        if (surfaceY >= win.y + HEADER_H) {
          return { kind: "folder", folderId: item.id, via: "window" };
        }
        // Dropping on the header is invalid — snap back.
        return { kind: "invalid" };
      }
      // Inside a non-container window. Invalid.
      return { kind: "invalid" };
    }
  }

  // Pass 2: top-level folder icons on the desktop. Folder nesting IS
  // allowed (authoring + drag both produce nested folders); the gap
  // here is that a nested folder icon visible inside an open parent
  // window can't be hit-tested as a drop target — pass 1 above will
  // resolve the drop to "into the parent window" first. To drop into
  // a nested folder specifically, the user opens it (clicking it)
  // and drops into its window. Acceptable for now; can be lifted by
  // having pass 1 also check for nested folder icons under the cursor
  // before resolving to the containing window.
  for (const candidate of state.items.values()) {
    if (candidate.type !== "folder") continue;
    if (candidate.parent !== "desktop") continue;
    if (candidate.id === draggingItem.id) continue;
    if (candidate.x === null || candidate.y === null) continue;  // not yet laid out

    if (surfaceX >= candidate.x && surfaceX <= candidate.x + ICON_W &&
        surfaceY >= candidate.y && surfaceY <= candidate.y + ICON_H) {
      return { kind: "folder", folderId: candidate.id, via: "icon" };
    }
  }

  // Pass 3: default — the desktop.
  return { kind: "desktop" };
}

function reparentItem(state, item, newParent, el, newParentEl, newX, newY) {
  // Update model + DOM atomically. If newParent === item.parent, this is
  // just a position update in the same container.
  item.parent = newParent;
  item.x = newX;
  item.y = newY;
  newParentEl.appendChild(el);
  positionEl(el, newX, newY);
}

/* -----------------------------------------------------------------------------
   DROP INTO A FOLDER
   -----------------------------------------------------------------------------
   Used for both "drop into open folder window" and "drop onto folder icon"
   cases. The branching is on whether the folder's window is open AND
   whether the drop point falls inside that window's content area:

     A. Folder window open, pointer inside its content area:
          Use the EXACT drop coordinates (translated to window-content-
          space). This is the natural "place it where I dropped it" feel.
     B. Folder window open, but pointer is outside (e.g. on the folder
        icon, which is somewhere else on the desktop):
          Use auto-layout to find the next available slot in the window.
          The drop point doesn't make sense as a position because it's
          not even inside the window.
     C. Folder window closed (only possible when hit-tested via icon):
          Update the model only. Remove the icon's DOM (it has no live
          container). On next folder-window open, the item will appear
          at an auto-laid-out position.

   Cases B and C both rely on the null-x sentinel that populateFolderWindow
   already understands — for case B we resolve it immediately because the
   window is rendered now; for case C we leave it null for later.
   --------------------------------------------------------------------------- */
function dropIntoFolder(state, item, folderId, el, surfaceX, surfaceY) {
  const folderWin = state.windows.get(folderId);

  // Case C: folder closed.
  if (!folderWin) {
    item.parent = folderId;
    item.x = null;
    item.y = null;
    el.remove();
    return;
  }

  // The window is open. Determine whether the pointer is genuinely inside
  // its content area, or whether we hit-tested into this folder via its
  // icon (which is elsewhere on the surface).
  const insideContent = (
    surfaceX >= folderWin.x &&
    surfaceX <= folderWin.x + folderWin.w &&
    surfaceY >= folderWin.y + HEADER_H &&
    surfaceY <= folderWin.y + folderWin.h
  );

  if (insideContent) {
    // Case A: place at the exact drop point in window-content-space.
    const localX = surfaceX - folderWin.x;
    const localY = surfaceY - (folderWin.y + HEADER_H);
    reparentItem(state, item, folderId, el, folderWin.content, localX, localY);
    return;
  }

  // Case B: open window, but pointer is on the folder's icon (not in the
  // window). Auto-layout into the next available slot.
  //
  // Count existing positioned siblings (excluding the dragging item, in
  // case it's coming back to the same folder it left). The new item takes
  // the slot AFTER all of them in column-major order.
  const placedCount = childrenOf(state, folderId)
    .filter((c) => c.id !== item.id && c.x !== null)
    .length;

  // autoLayoutIcons mutates item.x / item.y in place. We pass a single-item
  // array because we only want the dragging item positioned, not the
  // already-placed siblings.
  autoLayoutIcons([item], folderWin.w, folderWin.h - HEADER_H, placedCount);
  reparentItem(state, item, folderId, el, folderWin.content, item.x, item.y);
}

function snapBackToOrigin(state, item, el) {
  // item.parent / item.x / item.y are still the ORIGIN (we never wrote
  // the move). Reparent the DOM back to the origin container and replay
  // its position.
  if (item.parent === "desktop") {
    state.surface.appendChild(el);
  } else {
    const win = state.windows.get(item.parent);
    if (win) {
      win.content.appendChild(el);
    } else {
      // Origin folder is no longer open. The icon's logical home is still
      // that folder, but there's nowhere to put the DOM. Destroy it; it'll
      // be rebuilt next time the folder opens.
      el.remove();
      return;
    }
  }
  positionEl(el, item.x, item.y);
}

/* -----------------------------------------------------------------------------
   WINDOWS-CHANGED NOTIFICATION
   -----------------------------------------------------------------------------
   A tiny pub/sub for "the set of open windows, their z-order, or their
   minimized state has changed." The taskbar subscribes to drive its
   slot re-renders; future readers (a window-count indicator, anything
   else that wants to react to window state) plug in here without the
   window-management code knowing they exist.

   THREE WINDOW STATES
     - Visible & focused  — top zIndex among non-minimized windows
     - Visible & background — lower zIndex, not minimized
     - Minimized          — win.minimized = true, .is-minimized class
                            on the DOM element (visibility: hidden).
                            Geometry preserved; restored by restoreWindow.

   The principle from the project's architecture: one source of truth
   (state.windows + win.minimized flag), many readers. The window
   machinery writes; readers only ever read. This module exposes ONLY
   the subscribe direction — internal callers use notifyWindowsChanged
   directly.
   --------------------------------------------------------------------------- */

function notifyWindowsChanged(state) {
  // Snapshot to a local array so a subscriber that itself unsubscribes
  // during the callback doesn't reorder the iteration mid-flight.
  const subs = state.windowsChangedSubscribers.slice();
  for (const fn of subs) fn(state);
}

export function subscribeWindowsChanged(state, fn) {
  state.windowsChangedSubscribers.push(fn);
  return () => {
    const i = state.windowsChangedSubscribers.indexOf(fn);
    if (i >= 0) state.windowsChangedSubscribers.splice(i, 1);
  };
}

/* -----------------------------------------------------------------------------
   WINDOW LIFECYCLE HOOKS
   -----------------------------------------------------------------------------
   A small helper used by minimize / restore / close to invoke any file-type
   callbacks registered against a window's lifecycle. The hooks themselves
   live as arrays on the window record (onMinimizeFns / onRestoreFns /
   onCloseFns), populated by the file-type's buildWindow via the narrow
   handle's onMinimize / onRestore / onClose methods.

   The reason this is its own helper rather than three inline loops:

     - SNAPSHOT-BEFORE-ITERATE: same defensive pattern as
       notifyWindowsChanged. A hook callback that registers another hook
       during its run (uncommon but legal) doesn't reorder iteration
       mid-flight; the new hook just doesn't fire this cycle.

     - PER-HOOK try/catch: one buggy file type can't break the lifecycle
       for the whole panel. A throw in someone's onClose hook still lets
       the rest of the close path complete (geometry persist, DOM remove,
       taskbar notify). Errors are surfaced via console so they're not
       silent.

   The `label` argument is purely for the error log so devtools shows
   *which* lifecycle the buggy hook came from.
   --------------------------------------------------------------------------- */
function fireHooks(fns, label) {
  const snapshot = fns.slice();
  for (const fn of snapshot) {
    try { fn(); }
    catch (e) { console.error(`[desktopPanel] ${label} hook error:`, e); }
  }
}

function minimizeWindow(state, win) {
  // No-op if already minimized; lets callers fire this freely without
  // guarding. The .is-minimized class sets visibility: hidden in CSS,
  // which preserves layout but stops paint + pointer events — so the
  // minimized window can't be clicked or dragged while hidden, and
  // doesn't intercept the surface's wheel/click pass-through either.
  if (win.minimized) return;
  win.minimized = true;
  win.el.classList.add("is-minimized");

  // Fire file-type minimize hooks AFTER the class toggle — by the time
  // a hook runs, the window has already finished its visual transition
  // to minimized state. A media file type's pause-on-minimize callback
  // is the canonical use. Hooks fire BEFORE the panel-level notify so
  // file-type state settles before panel-level readers (taskbar) react.
  fireHooks(win.onMinimizeFns, "onMinimize");

  notifyWindowsChanged(state);
}

function restoreWindow(state, win) {
  // Inverse of minimize. Callers typically follow this with focusWindow
  // to bring the restored window forward; the two are kept separate so
  // composing is explicit at the call site (and so focusWindow's z-bump
  // doesn't happen as a side-effect of un-hiding when that's not wanted).
  if (!win.minimized) return;
  win.minimized = false;
  win.el.classList.remove("is-minimized");

  // Fire restore hooks AFTER the class toggle (window is visible again
  // by the time the hook runs). Mirrors the minimize ordering. Media
  // file types that paused on minimize can resume from here.
  fireHooks(win.onRestoreFns, "onRestore");

  notifyWindowsChanged(state);
}

export function focusWindowById(state, itemId) {
  // The taskbar's slot-click entry point. Behavior depends on the
  // window's current state — three cases:
  //
  //   - The window is minimized:
  //       Restore it and bring to front. The standard OS gesture for
  //       "find this hidden thing and show it again."
  //
  //   - The window is the currently-focused (top-z visible) one:
  //       Minimize it. Clicking the slot of what's already in front
  //       is a "put this away" gesture — matches Windows taskbar
  //       behavior. The user can still minimize via the header's −
  //       button for discoverability without learning this rule.
  //
  //   - The window is visible but in the background:
  //       Bring it to front. The standard "switch to this window"
  //       gesture.
  //
  // No-op if the id doesn't correspond to an open window (defensive
  // against stale notifications during open/close transitions).
  const win = state.windows.get(itemId);
  if (!win) return;

  if (win.minimized) {
    restoreWindow(state, win);
    focusWindow(state, win);
    return;
  }

  // Find the topmost visible window. If `win` IS that window, the
  // click means "minimize me." Otherwise it means "focus me."
  let topZ = -Infinity;
  let topWin = null;
  for (const [, w] of state.windows) {
    if (w.minimized) continue;
    if (w.zIndex > topZ) {
      topZ = w.zIndex;
      topWin = w;
    }
  }

  if (win === topWin) {
    minimizeWindow(state, win);
  } else {
    focusWindow(state, win);
  }
}

/* -----------------------------------------------------------------------------
   WINDOW DOM
   -----------------------------------------------------------------------------
   A frosted-glass shell with a header (drag handle + minimize + close
   buttons) and a content area. The content's inner DOM is built by the
   panel for folder windows (recursive icons) and by the file-type for
   file windows.
   --------------------------------------------------------------------------- */
/* -----------------------------------------------------------------------------
   Default window size for an item — the file type's declared defaultWindow,
   or the panel's own defaults (folders have no file type). Shared by
   openWindowFor's geometry resolution and the openOnLoad pass in init
   (which needs the effective size for edge clamping before the window
   exists).
   --------------------------------------------------------------------------- */
function defaultWindowSize(item) {
  if (item.type === "folder") return { w: WIN_DEFAULT_W, h: WIN_DEFAULT_H };
  const ft = getFileType(item.type);
  return {
    w: ft?.defaultWindow?.width  ?? WIN_DEFAULT_W,
    h: ft?.defaultWindow?.height ?? WIN_DEFAULT_H,
  };
}

function openWindowFor(state, item, authored = null) {
  // `authored` is optional pixel geometry ({ x?, y?, w?, h? }) from an
  // openOnLoad spec, resolved by init's openOnLoad pass. It slots into
  // the precedence chain BELOW windowState: in practice windowState is
  // always null when this path runs (the pass fires once, at init,
  // before any user interaction), but keeping windowState first means
  // the precedence reads the same everywhere — the user's session
  // layout always wins.

  // Idempotent: if a window for this item is already open, restore it
  // from minimized (if it was) and bring it to the front.
  const existing = state.windows.get(item.id);
  if (existing) {
    if (existing.minimized) restoreWindow(state, existing);
    focusWindow(state, existing);
    return;
  }

  // Determine initial size + position. Persisted windowState wins if
  // present (preserves user's last layout for this item this session).
  const def = defaultWindowSize(item);
  const w = item.windowState?.w ?? authored?.w ?? def.w;
  const h = item.windowState?.h ?? authored?.h ?? def.h;

  // Position: persisted state wins, else authored, else stagger from a
  // fresh slot.
  const slot = state.windows.size;
  const x = item.windowState?.x ?? authored?.x ?? (40 + slot * WIN_STACK_OFFSET);
  const y = item.windowState?.y ?? authored?.y ?? (40 + slot * WIN_STACK_OFFSET);

  const el = document.createElement("div");
  el.className = `desktop-window desktop-window--${item.type}`;

  const header = document.createElement("div");
  header.className = "desktop-window-header";
  const title = document.createElement("div");
  title.className = "desktop-window-title";
  title.textContent = item.name;
  const minimizeBtn = document.createElement("button");
  minimizeBtn.className = "desktop-window-minimize";
  minimizeBtn.setAttribute("aria-label", "Minimize window");
  minimizeBtn.innerHTML = "&minus;";
  const closeBtn = document.createElement("button");
  closeBtn.className = "desktop-window-close";
  closeBtn.setAttribute("aria-label", "Close window");
  closeBtn.innerHTML = "&times;";
  header.appendChild(title);
  header.appendChild(minimizeBtn);
  header.appendChild(closeBtn);

  const content = document.createElement("div");
  content.className = "desktop-window-content";

  el.appendChild(header);
  el.appendChild(content);
  state.surface.appendChild(el);

  // Build the window record. zIndex starts at the next available value;
  // assigned via focusWindow below.
  //
  // userResized is persisted across open/close in windowState — once the
  // user has resized the window, file-types' fitToContent calls become
  // no-ops so re-opening doesn't reset their custom shape. An AUTHORED
  // size (openOnLoad w/h) counts as resized for the same reason: the
  // author chose that shape, so fit-to-aspect types (image, video)
  // shouldn't snap away from it on load. Authored position alone does
  // not set it — fit behavior stays intact when only x/y are given.
  const authoredSize = authored?.w != null || authored?.h != null;
  //
  // The three on*Fns arrays hold lifecycle callbacks registered by the
  // file-type via the narrow handle exposed in populateFileWindow
  // (win.onMinimize / win.onRestore / win.onClose). Empty arrays by
  // default — folder windows never expose a handle so they stay empty,
  // and file types that don't register hooks behave exactly as they
  // did before this contract grew (the canonical case for image / note).
  const win = {
    itemId: item.id,
    el, header, content,
    x, y, w, h,
    zIndex: 0,
    userResized: item.windowState?.userResized || authoredSize,
    // Visible by default. minimizeWindow sets true (visibility: hidden
    // via .is-minimized class); restoreWindow sets back to false. New
    // windows always open visible — minimize is a user action only.
    minimized: false,
    onMinimizeFns: [],
    onRestoreFns: [],
    onCloseFns: [],
  };
  state.windows.set(item.id, win);

  applyWindowGeometry(win);
  focusWindow(state, win);

  // Header drag — moves the window. Clicking (no drag) is a focus-only
  // operation (handled implicitly by the pointerdown bubble below, which
  // bumps z BEFORE the drag-or-click resolution).
  wireWindowDrag(state, win);

  // Pointerdown anywhere on the window bumps z (so click-to-front works
  // on the content too, not just the header). The header's drag still
  // works because this fires on bubble — the header's pointerdown handler
  // (installed by makeDraggable) runs first.
  el.addEventListener("pointerdown", () => focusWindow(state, win));

  // Close button. The pointerdown is stopped at this element so it never
  // reaches the header above. Without that, the header's makeDraggable
  // pointerdown handler would fire, call setPointerCapture on the header,
  // and from that moment all pointer events for that pointer — including
  // the synthesised `click` — would be retargeted to the header instead
  // of this button, and the close handler would never run. Stopping the
  // propagation keeps the click on the button where it belongs.
  closeBtn.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
  });
  closeBtn.addEventListener("click", () => closeWindow(state, win));

  // Minimize button — same stopPropagation pattern as close, for the
  // same reason (don't let the header's drag handler steal the click).
  minimizeBtn.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
  });
  minimizeBtn.addEventListener("click", () => minimizeWindow(state, win));

  // Resize handles — 8 invisible elements at corners and edges. Each
  // gets a cursor + a data-resize direction; wireWindowResize translates
  // pointer drag on a handle into the right edge math for that direction.
  // Universal across file types: every window gets resize for free,
  // no opt-in from the file-type.
  RESIZE_DIRECTIONS.forEach((dir) => {
    const handle = document.createElement("div");
    handle.className = `desktop-window-resize-handle desktop-window-resize-handle--${dir}`;
    handle.setAttribute("aria-hidden", "true");
    el.appendChild(handle);
    wireWindowResize(state, win, handle, dir);
  });

  // Content: folder window = child icons; file window = file-type DOM.
  if (item.type === "folder") {
    populateFolderWindow(state, item, win);
  } else {
    populateFileWindow(state, item, win);
  }
}

function applyWindowGeometry(win) {
  win.el.style.width  = `${win.w}px`;
  win.el.style.height = `${win.h}px`;
  win.el.style.transform = `translate3d(${win.x}px, ${win.y}px, 0)`;
}

function focusWindow(state, win) {
  // Bump to the top of the stack. nextZ starts at 1 in state init, so
  // window z-indices live in [1..N] within the desktop's stacking
  // context. CSS sets a base z on .desktop-window; we write zIndex
  // directly so it composes additively.
  state.nextZ += 1;
  win.zIndex = state.nextZ;
  win.el.style.zIndex = String(win.zIndex);

  // Notify readers (currently the taskbar) that the focused window
  // has changed. Fires even when focusing the already-focused window
  // — harmless because the readers' re-render is cheap and idempotent.
  notifyWindowsChanged(state);
}

function closeWindow(state, win) {
  // Fire close hooks FIRST — before geometry persistence, DOM removal,
  // or state.windows deletion. This is the asymmetric twin of the
  // minimize/restore ordering: those fire AFTER their state change
  // because their hook callback observes a completed transition; close
  // fires BEFORE because the callback needs the live DOM and state to
  // still exist (e.g. reading video.currentTime to commit it to
  // file.playbackPosition, or removing window-level listeners that
  // were attached in buildWindow).
  fireHooks(win.onCloseFns, "onClose");

  // Persist last geometry + userResized flag so reopening this item later
  // in the session restores the user's layout. Children's x/y are already
  // in sync with their drag positions (the icon drag handlers write back
  // to item.x/y on every drop), so destroying the icon DOM here loses
  // nothing.
  const item = state.items.get(win.itemId);
  if (item) {
    item.windowState = {
      x: win.x, y: win.y, w: win.w, h: win.h,
      userResized: win.userResized,
    };
  }

  win.el.remove();
  state.windows.delete(win.itemId);

  // Notify readers (currently the taskbar) that a window has closed.
  notifyWindowsChanged(state);
}

function wireWindowDrag(state, win) {
  let startX = 0, startY = 0;
  makeDraggable(win.header, {
    // Click on header (no drag) does nothing beyond the focus the
    // pointerdown bubble already triggered.
    onClick: () => {},

    onDragStart: () => {
      startX = win.x;
      startY = win.y;
      win.el.classList.add("is-dragging");
    },

    onDrag: (dx, dy) => {
      win.x = clampWindowX(state, win, startX + dx);
      win.y = clampWindowY(state, win, startY + dy);
      applyWindowGeometry(win);
    },

    onDragEnd: () => {
      win.el.classList.remove("is-dragging");
    },
  });
}

function clampWindowX(state, win, x) {
  // Keep at least 80px of the window inside the surface horizontally on
  // both sides — enough to grab the header.
  const surfaceW = state.surface.clientWidth;
  return Math.max(80 - win.w, Math.min(x, surfaceW - 80));
}

function clampWindowY(state, win, y) {
  // Title bar must stay fully visible: y >= 0 and y + HEADER_H <= surfaceH.
  const surfaceH = state.surface.clientHeight;
  return Math.max(0, Math.min(y, surfaceH - HEADER_H));
}

/* -----------------------------------------------------------------------------
   WINDOW RESIZE
   -----------------------------------------------------------------------------
   Every window has 8 invisible drag handles (4 corners + 4 edges). Each
   handle is wired through the same makeDraggable utility used everywhere
   else; on drag we update window geometry using edge-based math.

   THE EDGE MAP
     For each direction, we declare which of the 4 edges (left, right,
     top, bottom) the pointer's delta moves. The math then becomes simple
     and uniform: each edge that "moves" gets its position updated by the
     corresponding pointer-delta component; edges that don't move stay
     put. From the new edges we re-derive (x, y, w, h).

   CONSTRAINTS
     - Min size: each window has a floor (WIN_MIN_W / WIN_MIN_H). When a
       drag would push two opposing edges past each other minus the min,
       the MOVING edge gets clamped (the stationary edge stays where it
       was, the moving one stops at the floor).
     - Surface bounds: edges can't escape the desktop surface. Clamping
       newLeft/newTop to >= 0 and newRight/newBottom to <= surfaceDim
       happens after the min-size clamp.

   FOLDER CONTENT
     During a folder-window resize, child icon positions are clamped to
     keep them inside the new content area (clampIconsToContent). This
     preserves the user's arrangement as much as possible — icons that
     still fit stay where the user put them; icons that would fall off
     the new edge get nudged in.

   USAGE BY FILE-TYPES
     File-types don't participate. Their content is sized via CSS (the
     image's `object-fit: contain` adapts naturally; future text/video
     types would use the same `width/height: 100%` pattern). After the
     user resizes, fitToContent calls from the file-type are ignored
     (see userResized check in fitWindowToContent).
   --------------------------------------------------------------------------- */

const RESIZE_DIRECTIONS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

// Per-direction: which edges does the pointer-delta move?
// l = left edge, r = right edge, t = top, b = bottom. 1 means "this
// edge moves with the corresponding axis of pointer movement"; 0 means
// "stays put."
const RESIZE_EDGE_MAP = {
  nw: { l: 1, r: 0, t: 1, b: 0 },
  n:  { l: 0, r: 0, t: 1, b: 0 },
  ne: { l: 0, r: 1, t: 1, b: 0 },
  e:  { l: 0, r: 1, t: 0, b: 0 },
  se: { l: 0, r: 1, t: 0, b: 1 },
  s:  { l: 0, r: 0, t: 0, b: 1 },
  sw: { l: 1, r: 0, t: 0, b: 1 },
  w:  { l: 1, r: 0, t: 0, b: 0 },
};

function wireWindowResize(state, win, handleEl, dir) {
  let startGeom = null;

  makeDraggable(handleEl, {
    onClick: () => {},

    onDragStart: () => {
      startGeom = { x: win.x, y: win.y, w: win.w, h: win.h };
      win.el.classList.add("is-resizing");
    },

    onDrag: (dx, dy) => {
      if (!startGeom) return;
      applyResize(state, win, dir, startGeom, dx, dy);
    },

    onDragEnd: () => {
      win.el.classList.remove("is-resizing");
      win.userResized = true;       // sticks across open/close via windowState
      startGeom = null;
    },
  });
}

function applyResize(state, win, dir, start, dx, dy) {
  const e = RESIZE_EDGE_MAP[dir];

  // Compute the four candidate edges from the start state + pointer delta.
  let newLeft   = start.x + (e.l ? dx : 0);
  let newRight  = start.x + start.w + (e.r ? dx : 0);
  let newTop    = start.y + (e.t ? dy : 0);
  let newBottom = start.y + start.h + (e.b ? dy : 0);

  // Min-size: clamp the MOVING edge if the two opposing edges have closed
  // past the floor. The non-moving edge stays put.
  if (newRight - newLeft < WIN_MIN_W) {
    if (e.l)      newLeft  = newRight - WIN_MIN_W;
    else if (e.r) newRight = newLeft  + WIN_MIN_W;
  }
  if (newBottom - newTop < WIN_MIN_H) {
    if (e.t)      newTop    = newBottom - WIN_MIN_H;
    else if (e.b) newBottom = newTop    + WIN_MIN_H;
  }

  // Surface bounds: window can't extend past the desktop edges.
  const surfaceW = state.surface.clientWidth;
  const surfaceH = state.surface.clientHeight;
  if (newLeft   < 0)         newLeft   = 0;
  if (newTop    < 0)         newTop    = 0;
  if (newRight  > surfaceW)  newRight  = surfaceW;
  if (newBottom > surfaceH)  newBottom = surfaceH;

  // Re-check min-size after bounds clamping — bounds may have pushed
  // an edge such that the window is now too small. If so, snap the
  // moving edge back to maintain min size.
  if (newRight - newLeft < WIN_MIN_W) {
    if (e.l)      newLeft  = newRight - WIN_MIN_W;
    else if (e.r) newRight = newLeft  + WIN_MIN_W;
  }
  if (newBottom - newTop < WIN_MIN_H) {
    if (e.t)      newTop    = newBottom - WIN_MIN_H;
    else if (e.b) newBottom = newTop    + WIN_MIN_H;
  }

  // Commit to the window state.
  win.x = newLeft;
  win.y = newTop;
  win.w = newRight - newLeft;
  win.h = newBottom - newTop;
  applyWindowGeometry(win);

  // Folder windows: keep child icons inside the new content area, then
  // push apart any overlaps so the user always sees distinct icons. Both
  // run every resize frame — clamping handles the "out of bounds" case
  // (more frequent when shrinking); relaxing handles the "clustered"
  // case (which clamping itself can cause, or which can be a leftover
  // from a previous shrink that the user is now undoing by growing).
  // For file windows (e.g. images), CSS handles content adaptation.
  const item = state.items.get(win.itemId);
  if (item && item.type === "folder") {
    clampIconsToContent(state, item.id, win);
    relaxIcons(state, item.id, win);
  }
}

function clampIconsToContent(state, folderId, win) {
  // After a resize, icons whose position would fall outside the visible
  // content area get nudged just inside. Already-visible icons keep
  // their positions exactly — only the strays move. Non-destructive:
  // if nothing needs moving, nothing changes.
  const contentW = win.w;
  const contentH = win.h - HEADER_H;
  const maxX = Math.max(0, contentW - ICON_W);
  const maxY = Math.max(0, contentH - ICON_H);

  for (const child of childrenOf(state, folderId)) {
    if (child.x === null || child.y === null) continue;
    const newX = Math.max(0, Math.min(child.x, maxX));
    const newY = Math.max(0, Math.min(child.y, maxY));
    if (newX !== child.x || newY !== child.y) {
      child.x = newX;
      child.y = newY;
      if (child.el) positionEl(child.el, newX, newY);
    }
  }
}

/* -----------------------------------------------------------------------------
   RELAX ICONS — push overlapping icons apart
   -----------------------------------------------------------------------------
   Called after clampIconsToContent on every resize frame. Resolves
   overlaps that clamping can create (icons stacked against the same
   edge) and lets icons spread out when the window grows back to give
   them room.

   ALGORITHM — iterative pair-wise separation
     For each pair (i, j), if their AABBs interpenetrate by more than a
     small buffer, push them apart along the axis of LEAST penetration
     (cheaper move, more stable). Each icon takes half the push. Clamp
     both to bounds after each push. Repeat until no pair overlaps or
     MAX_ITERS hit (defensive cap).

     The buffer (a fraction of ICON_GAP) gives the resolved layout a
     small breathing space so icons read as distinct, not flush.

     This isn't a grid — icons land where pair-wise pushes settle them.
     Matches the user's "they can just land where they land" spec.

   PER-FRAME COST
     O(N² · iters). For typical V1 folders (≤ ~20 icons): trivial. If
     a folder ever has dozens of icons and this gets called every resize
     frame, consider spatial partitioning, but no need yet.

   CONVERGENCE
     For "many icons stacked in a corner against a wall" pathological
     cases, half-pushes mean penetration halves each iter — converges
     to sub-pixel within ~10 iters. MAX_ITERS = 15 leaves headroom.
   --------------------------------------------------------------------------- */
function relaxIcons(state, folderId, win) {
  const icons = childrenOf(state, folderId).filter((c) => c.x !== null);
  if (icons.length < 2) return;

  const contentW = win.w;
  const contentH = win.h - HEADER_H;
  const maxX = Math.max(0, contentW - ICON_W);
  const maxY = Math.max(0, contentH - ICON_H);

  // Required separation: icon dimension + a small breathing gap. Using
  // half of ICON_GAP keeps the look airy without forcing the layout to
  // sprawl as much as the grid would.
  const BUFFER_X = ICON_GAP_X / 2;
  const BUFFER_Y = ICON_GAP_Y / 2;
  const MIN_SEP_X = ICON_W + BUFFER_X;
  const MIN_SEP_Y = ICON_H + BUFFER_Y;
  const MAX_ITERS = 15;

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    let anyMoved = false;

    for (let i = 0; i < icons.length; i++) {
      for (let j = i + 1; j < icons.length; j++) {
        const a = icons[i];
        const b = icons[j];

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const penX = MIN_SEP_X - Math.abs(dx);
        const penY = MIN_SEP_Y - Math.abs(dy);

        // Both penetrations positive ⇒ AABBs interpenetrate.
        if (penX > 0 && penY > 0) {
          // Push along the axis of least penetration. Each icon takes
          // half the separation — clamping below may leave them stuck
          // against a wall, but additional iterations propagate the
          // resolution.
          if (penX < penY) {
            const half = penX / 2;
            const sign = dx >= 0 ? 1 : -1;
            b.x += sign * half;
            a.x -= sign * half;
          } else {
            const half = penY / 2;
            const sign = dy >= 0 ? 1 : -1;
            b.y += sign * half;
            a.y -= sign * half;
          }

          a.x = Math.max(0, Math.min(maxX, a.x));
          a.y = Math.max(0, Math.min(maxY, a.y));
          b.x = Math.max(0, Math.min(maxX, b.x));
          b.y = Math.max(0, Math.min(maxY, b.y));

          anyMoved = true;
        }
      }
    }

    if (!anyMoved) break;   // converged early
  }

  // Single DOM write per icon at the end of the relaxation. Even if
  // an icon moved across many iterations, the browser only sees its
  // final position.
  for (const icon of icons) {
    if (icon.el) positionEl(icon.el, icon.x, icon.y);
  }
}

/* -----------------------------------------------------------------------------
   POPULATING WINDOW CONTENTS
   -----------------------------------------------------------------------------
   Folder window: build icon DOM for each child item (parent === folder id)
   and append into the window's content area. If a child has no x/y set
   yet (first time this folder has opened in this session), auto-layout
   over the content area's dimensions.

   File window: ask the file-type's buildWindow to produce its DOM,
   passing it a small handle (fitToContent, close). Append into the
   content area as-is.
   --------------------------------------------------------------------------- */
function populateFolderWindow(state, item, win) {
  const children = childrenOf(state, item.id);

  // First-open auto-layout: any child whose x is still null (the sentinel
  // from flattenAuthoredItems, or set when a file is dropped onto a closed
  // folder icon) gets positioned in a grid over the content area. Already-
  // positioned siblings keep their x/y. We pass their count as startIndex
  // so the un-positioned ones go to the next column-major slots rather
  // than overlapping the first existing icon at (ICON_PAD, ICON_PAD).
  const placed = children.filter(c => c.x !== null);
  const needsLayout = children.filter(c => c.x === null);
  if (needsLayout.length > 0) {
    autoLayoutIcons(needsLayout, win.w, win.h - HEADER_H, placed.length);
  }

  children.forEach((child) => {
    const el = buildIconEl(state, child);
    win.content.appendChild(el);
  });
}

function populateFileWindow(state, item, win) {
  const ft = getFileType(item.type);
  if (!ft || !ft.buildWindow) {
    // Unknown file type or no buildWindow defined. Render empty content;
    // the close button still works.
    return;
  }

  // The handle passed to the file-type. Intentionally narrow — exposes
  // exactly the capabilities a file type needs and no more. Adding
  // anything here is a deliberate API expansion (the bar is "every
  // future file type might use it"), not a one-off accommodation.
  //
  // Two capability families today:
  //
  //   IMPERATIVE (fitToContent, close):
  //     The file type asks the panel to do something now. Synchronous.
  //
  //   LIFECYCLE HOOKS (onMinimize, onRestore, onClose):
  //     The file type subscribes to a future panel event. Hooks push
  //     onto arrays on the window record; the panel fires them at the
  //     corresponding lifecycle moment (see fireHooks above). The
  //     subscription's lifetime is the window's lifetime — there's no
  //     unsubscribe because the natural cleanup boundary is window
  //     teardown (any hook stops firing forever once onClose has run
  //     and the window record is gone). A use case for "stop listening
  //     while the window stays open" hasn't appeared, so the API stays
  //     simple; if one ever does, the right move is returning an
  //     unsubscribe fn from each on*, not adding a separate off*.
  //
  // Multiple hooks per channel are legal (just push more than once).
  // They fire in registration order; one throwing doesn't block the
  // others (see fireHooks).
  const handle = {
    fitToContent: (naturalW, naturalH) => fitWindowToContent(state, win, naturalW, naturalH),
    close: () => closeWindow(state, win),
    onMinimize: (fn) => { win.onMinimizeFns.push(fn); },
    onRestore:  (fn) => { win.onRestoreFns.push(fn); },
    onClose:    (fn) => { win.onCloseFns.push(fn); },
  };

  const inner = ft.buildWindow(item, handle);
  if (inner instanceof Node) {
    win.content.appendChild(inner);
  }
}

function fitWindowToContent(state, win, naturalW, naturalH) {
  // Once the user has resized this window, their shape is sticky — a
  // file-type asking us to fit-to-content (typically the image module's
  // onload callback) becomes a no-op. Otherwise reopening a manually-
  // resized image would snap it back to natural aspect, undoing the
  // user's choice.
  if (win.userResized) return;

  // Policy: clamp to WIN_VIEWPORT_FRAC * surface dimensions, preserve
  // aspect, respect mins, then re-clamp position so the title bar stays
  // visible at the new size.
  const surfaceW = state.surface.clientWidth;
  const surfaceH = state.surface.clientHeight;

  const maxW = surfaceW * WIN_VIEWPORT_FRAC;
  const maxH = surfaceH * WIN_VIEWPORT_FRAC - HEADER_H;

  const aspect = naturalW / naturalH;
  let contentW = Math.min(naturalW, maxW);
  let contentH = contentW / aspect;
  if (contentH > maxH) {
    contentH = maxH;
    contentW = contentH * aspect;
  }

  win.w = Math.max(WIN_MIN_W, Math.round(contentW));
  win.h = Math.max(WIN_MIN_H, Math.round(contentH + HEADER_H));

  // Re-clamp position with the new size — title bar must stay in bounds.
  // The window stays anchored where the user placed it (we don't recentre
  // on resize because that would jerk a window the user is looking at).
  win.x = clampWindowX(state, win, win.x);
  win.y = clampWindowY(state, win, win.y);

  applyWindowGeometry(win);
}

/* -----------------------------------------------------------------------------
   REGISTER WITH THE CORE
   -----------------------------------------------------------------------------
   buildDOM creates the three-element structure that separates concerns:

     .desktop-overlay     — the core's --shift target. Full viewport. Owns
                            opacity (which gates the whole panel's visibility).
                            Does not transform with scroll itself.
       ├── .desktop-html-overlay  — consumes --shift; visible scroll
                                    indicator. For now, a horizontal line.
                                    Sits BEHIND the screen in DOM order.
       └── .desktop-screen        — the screen rect: viewport minus margins
                                    that clear the fixed instruments (the
                                    MENU trigger / scroll strip on the right,
                                    the music player bottom-right), centered.
                                    Hosts the four wireframe frame lines,
                                    .desktop-surface, and (at rest) all of
                                    the icons + windows. The custom
                                    properties --x-scale, --y-split are
                                    set on THIS element so they inherit
                                    only to the screen subtree (the html
                                    overlay sibling stays unaffected by
                                    the assembly animation).

   init populates per-instance state, lays out top-level icons inside the
   screen's content area, and registers the wireframe weight with the
   handoff gate. tick maps grow to xScale + ySplit — asymmetric easing
   with .is-clear gating inherited from turnPanel.
   --------------------------------------------------------------------------- */
const PANEL_REF = "__desktopPanelRef__";

registerPanelType("desktop", {

  buildDOM(panel /*, index */) {
    const overlay = document.createElement("div");
    overlay.className = "infinite-overlay desktop-overlay";

    // The html-overlay layer. Consumes --shift via its own transform so
    // it slides with scroll, even though the parent overlay no longer
    // does. Painted first so the screen (next sibling) hides it where
    // they overlap.
    //
    // For now the element is just a styled rule (a 1px line); later, if
    // authored HTML is wanted in this layer (kicker/title/credits), the
    // panel-type can render panel.html into here.
    const htmlOverlay = document.createElement("div");
    htmlOverlay.className = "desktop-html-overlay";
    overlay.appendChild(htmlOverlay);

    // The screen — fixed-size, centered, frame-bordered. The four frame
    // lines (top, bottom, left, right) animate inside it during the
    // wireframe assembly and remain as the screen's permanent border at
    // rest. The surface lives inside the screen alongside the frame
    // lines; clip-path keeps its visible region inside the rectangle
    // the frame lines define.
    const screen = document.createElement("div");
    screen.className = "desktop-screen";

    // The surface fills the screen. It's the drag container, the icon
    // host, and the drop-target for files dropped on "the desktop."
    const surface = document.createElement("div");
    surface.className = "desktop-surface";
    screen.appendChild(surface);

    // The four wireframe lines. No JS state, no per-frame writes from
    // tick — they read --x-scale and --y-split inherited from the
    // screen and compute their own position/size in CSS. Appended
    // AFTER surface so they paint above it (the frame is the screen's
    // chrome; it overlays the contents). The two horizontal lines are
    // coincident at center while ySplit=0, so during the horizontal
    // sweep they read as a single growing line.
    const frameTop    = document.createElement("div");
    frameTop.className    = "desktop-frame desktop-frame--top";
    const frameBottom = document.createElement("div");
    frameBottom.className = "desktop-frame desktop-frame--bottom";
    const frameLeft   = document.createElement("div");
    frameLeft.className   = "desktop-frame desktop-frame--left";
    const frameRight  = document.createElement("div");
    frameRight.className  = "desktop-frame desktop-frame--right";
    screen.appendChild(frameTop);
    screen.appendChild(frameBottom);
    screen.appendChild(frameLeft);
    screen.appendChild(frameRight);

    overlay.appendChild(screen);

    // Stash refs so init() can read them. We keep `screen` separately
    // from `surface` because tick() writes the wireframe params on the
    // screen (so they inherit to the four frame lines + surface) but
    // the surface is what icons + windows attach to. htmlOverlay is
    // also stashed so tick() can drive its OWN opacity (gradual fade
    // — see tick comment).
    overlay[PANEL_REF] = { panel, htmlOverlay, screen, surface };
    return overlay;
  },

  init(index, overlay) {
    const { panel, htmlOverlay, screen, surface } = overlay[PANEL_REF];

    // Flatten authored hierarchy into the live items map. Authored data
    // is never mutated past this point.
    const items = flattenAuthoredItems(index, panel);

    const state = {
      grow: 0,
      clear: false,
      overlay,
      htmlOverlay,
      screen,
      surface,
      items,
      windows: new Map(),
      nextZ: 0,
      // Subscribers for the windows-changed notification. Currently
      // the only reader is the taskbar (built below in this init).
      // Future readers register via subscribeWindowsChanged.
      windowsChangedSubscribers: [],
    };
    instances.set(index, state);

    // Build the taskbar and append it to the screen. The taskbar is a
    // sibling of the surface and the frame lines; it sits visually
    // anchored to the bottom of the screen rectangle. Its subscription
    // to window changes is wired up internally — desktopPanel doesn't
    // need to drive its re-renders directly.
    const taskbar = buildTaskbar(state);
    screen.appendChild(taskbar);

    // Standard handoff-gate participation. Same shape as emptyPanel.
    registerWeight(index, () => state.grow);

    // Initial top-level icon layout. Surface dimensions may be 0 if the
    // overlay hasn't laid out yet (e.g., when init runs before the first
    // paint). The screen box in desktopStyles.css is the source of truth
    // for the real size (viewport minus instrument-clearing margins, which
    // have pixel floors and so aren't a fixed fraction of the viewport).
    // This fallback is a deliberately CONSERVATIVE approximation of it:
    // undershooting is safe (icons land inside the real surface and the
    // first measured layout corrects them), overshooting would push them
    // past the right/bottom edges of the visible surface.
    const surfaceW = surface.clientWidth  || window.innerWidth  * 0.8;
    const surfaceH = surface.clientHeight || window.innerHeight * 0.8;

    const topLevel = childrenOf(state, "desktop");
    autoLayoutIcons(topLevel, surfaceW, surfaceH);

    topLevel.forEach((item) => {
      const el = buildIconEl(state, item);
      surface.appendChild(el);
    });

    // AUTHORED-OPEN WINDOWS (openOnLoad)
    // Items authored with `openOnLoad` start with their window already
    // open — the greeting-note case. Any item qualifies, nested ones
    // included (windows don't require their parent folder to be open).
    //
    //   openOnLoad: true              — default size, stagger position
    //   openOnLoad: { x, y }          — position as FRACTIONS 0..1 of the
    //                                   surface (fractions stay meaningful
    //                                   across the screen's viewport-
    //                                   dependent size; pixels wouldn't)
    //   openOnLoad: { x, y, w, h }    — plus explicit PIXEL size; counts
    //                                   as user-resized so fitToContent
    //                                   types (image, video) won't snap
    //                                   away from the authored shape
    //
    // Deferred one frame: the fractions need the surface's real
    // dimensions, and init can run before first layout. The icon pass
    // above tolerates the zero-size fallback because auto-layout is
    // approximate anyway; a greeting window landing in the wrong place
    // is conspicuous, so this pass waits for layout and only falls back
    // if the surface still hasn't sized (same conservative constants).
    //
    // Runs once per page load. Closing the window keeps it closed for
    // the session; reload restores it — the authored-data model that
    // governs everything else on the desktop.
    // Locked items never auto-open — an authored openOnLoad on a locked
    // item would bypass the gate it was also authored with; the lock wins.
    const toOpen = [...state.items.values()]
      .filter((it) => it.openOnLoad && !isLocked(it));
    if (toOpen.length) {
      requestAnimationFrame(() => {
        const sw = surface.clientWidth  || window.innerWidth  * 0.8;
        const sh = surface.clientHeight || window.innerHeight * 0.8;

        toOpen.forEach((item) => {
          const spec = item.openOnLoad;
          let authored = null;

          if (spec && typeof spec === "object") {
            const w = Number.isFinite(spec.w) ? spec.w : null;
            const h = Number.isFinite(spec.h) ? spec.h : null;

            // Fractions → pixels, clamped so the window opens fully on
            // the surface even when fraction + size would spill past an
            // edge on a small viewport. Clamping uses the EFFECTIVE size
            // (authored, else the type default) — that's what the window
            // will actually open at.
            const def = defaultWindowSize(item);
            const effW = w ?? def.w;
            const effH = h ?? def.h;

            const x = Number.isFinite(spec.x)
              ? Math.max(0, Math.min(spec.x * sw, sw - effW))
              : null;
            const y = Number.isFinite(spec.y)
              ? Math.max(0, Math.min(spec.y * sh, sh - effH))
              : null;

            authored = { x, y, w, h };
          }

          openWindowFor(state, item, authored);
        });
      });
    }
  },

  tick(index, overlay, _presence, _dist, dt /*, t */) {
    const state = instances.get(index);
    if (!state) return;

    // ASYMMETRIC EASING for `grow`. Slower on the way in (CRT-warm-up
    // feel) than on the way out (snappier turn-off so other panels don't
    // wait). Direction is determined by comparing target vs current —
    // changing speed mid-frame is fine because the easing law converges
    // either way; only the rate changes.
    const target = isClearToEnter(index) ? 1 : 0;
    const speed  = (target > state.grow) ? BLOOM_SPEED_IN : BLOOM_SPEED_OUT;
    state.grow  += (target - state.grow) * (1 - Math.exp(-speed * dt));

    const grow = state.grow;

    // WIREFRAME ASSEMBLY MAPPING — two parameters drive both the four
    // frame-line positions/sizes AND the surface's clip-path:
    //
    //   xScale ∈ [0,1]  — horizontal extent of the assembled frame
    //                     (0 = nothing, 1 = full screen width)
    //   ySplit ∈ [0,1]  — vertical separation of the top and bottom
    //                     lines from the centre line (0 = coincident,
    //                     1 = fully apart at top/bottom edges)
    //
    // CSS reads these as custom properties and computes both the four
    // frame line positions/sizes AND the surface's clip-path inset.
    // The clip-path always matches the rectangle bounded by the lines,
    // so the frame literally outlines the visible content as it draws.
    const xScale = smoothstep(0, LINE_END, grow);
    const ySplit = smoothstep(LINE_END, OPEN_END, grow);

    // Write to the SCREEN so the values inherit only to the screen
    // subtree (the four frame children + .desktop-surface). The
    // html-overlay sibling stays unaffected.
    state.screen.style.setProperty("--x-scale", xScale.toFixed(4));
    state.screen.style.setProperty("--y-split", ySplit.toFixed(4));

    // Opacity SNAP-IN on the OVERLAY. The dark frame lines should
    // appear sharp on the light surface — no muddy fade — so we snap
    // overlay opacity to 1 the moment grow leaves zero by a hair.
    overlay.style.opacity = smoothstep(0, 0.04, grow).toFixed(3);

    // GRADUAL FADE on the HTML OVERLAY (the scroll-indicator line).
    // turnPanel-style — opacity = grow directly. Effective rendered
    // alpha = overlay.opacity × htmlOverlay.opacity = (~1) × grow.
    state.htmlOverlay.style.opacity = grow.toFixed(3);

    // INTERACTION GATING — same pattern as turnPanel.js. .is-clear flips
    // on at INTERACT_THRESHOLD so drags can't fire on a half-built
    // screen. At 0.7, ySplit ≈ 0.92 — the rectangle is almost fully
    // assembled, visually stable enough to interact with.
    const wantClear = grow > INTERACT_THRESHOLD;
    if (wantClear !== state.clear) {
      state.clear = wantClear;
      overlay.classList.toggle("is-clear", wantClear);
    }
  },
});
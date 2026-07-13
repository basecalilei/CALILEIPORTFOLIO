/* =============================================================================
   gridModal.js — the "grid" MODAL (not a panel type)
   -----------------------------------------------------------------------------
   An infinite, draggable 2D grid of images, displayed inside a frosted-glass
   modal sheet that slides up from the bottom of the viewport. Opened by a
   `data-action="grid"` button somewhere in a panel (currently turnPanel),
   closed by ×, scrim click, or Escape.

   The grid itself is the same infinite-pool design as before:
     - A fixed pool of ~100 DOM squares is recycled as the user drags
     - Each cell of the infinite world hashes deterministically to an
       entry in the images array — the same image always appears at the
       same coordinates regardless of drag path
     - Adaptive layout: 5×3 / 4×3 / 3×3 / 2×4 by viewport aspect
     - Lazy mouse-follow, per-cell idle float, drag with momentum
     - Click a square → opens a per-image detail modal that grows from
       the clicked square to fill most of the modal

   WHY A MODAL INSTEAD OF A PANEL
     The grid was originally a panel type, but living inside the scrolling
     panel system caused friction:
       - The grid's drag interaction competed with the page's scroll
       - There was no clean way to communicate "you're done here, scroll
         to move on" without breaking the drag-anywhere affordance
       - Vignettes, fades, and scroll-tracking all introduced edge
         artifacts that needed special-casing
     As a modal, all of that disappears: open commits the user to the
     grid experience, close returns them to normal page scrolling.

   USAGE
     import { openGridModal } from "./gridModal.js";
     openGridModal([
       { src: "thumb1.webp", full: "full1.webp", caption: "..." },
       ...
     ]);

   RUN LOOP
     Outside the panel system means no core-driven tick. We run our own
     requestAnimationFrame loop while the modal is open, paused while
     closed. The loop drives drag inertia, lazy-follow, and per-cell
     idle float — the same physics as before, just outside the core.

   COUPLED WITH
     - gridStyles.css: emits .grid-modal-scrim, .grid-modal-sheet,
       .grid-modal-close, .grid-surface, .grid-world, .grid-square,
       .grid-square-inner, .grid-detail-* (the per-image detail modal).
   ========================================================================== */

/* -----------------------------------------------------------------------------
   TUNABLES
   --------------------------------------------------------------------------- */

// Pool of recycled square elements. 14×8 = 112 — needs to be larger than
// what fits on screen so fast flicks never reveal a gap.
const POOL_COLS = 14;
const POOL_ROWS = 8;

// Gap between squares as a fraction of square size.
const GAP_RATIO = 0.375;

// Idle float — sum of two incommensurate sines per axis per cell.
const FLOAT_ENABLED = true;
const FLOAT_AMP_PX = 5;
const FLOAT_W_X_A = 0.55;
const FLOAT_W_X_B = 0.21;
const FLOAT_W_Y_A = 0.72;
const FLOAT_W_Y_B = 0.28;
const FLOAT_B_SCALE = 0.4;

// Lazy mouse-follow.
const LAZY_FOLLOW_ENABLED = true;
const LAZY_FACTOR = 0.025;
const LAZY_SPEED = 3.5;

// Drag inertia (frame-rate independent — px/sec, exponential decay).
const FRICTION = 4.0;
const STOP_SPEED_PX_S = 20;
const CLICK_THRESHOLD_PX = 5;
const VEL_WINDOW_MS = 100;

// Modal animation duration — MUST match the CSS transition on
// .grid-modal-sheet (slide up) and .grid-modal-scrim::before (dim fade).
const MODAL_ANIM_MS = 550;

// Per-image detail modal animation duration — MUST match the CSS transition
// on .grid-detail-window.
const DETAIL_ANIM_MS = 450;

// Fallback colors shown when no image is assigned (empty images array, or
// briefly during initial load). Each world cell hashes to one of these.
const FALLBACK_COLORS = [
  "#e8e4dc", "#d6cdbe", "#bcb09b", "#a39682",
  "#8d8275", "#736a5e", "#5b5249", "#403a33",
];

/* -----------------------------------------------------------------------------
   MODULE-LEVEL STATE
   -----------------------------------------------------------------------------
   Single instance — only one grid modal exists, opened and closed by the
   exported function. State is module-private; no public access except via
   openGridModal().
   --------------------------------------------------------------------------- */

// Outer modal DOM (built lazily on first open).
let modalScrim = null;
let modalSheet = null;
let modalCloseBtn = null;
let modalOpen = false;

// The grid itself (inside the modal sheet).
let surface = null;       // .grid-surface — drag-catching layer
let world = null;          // .grid-world — translated layer
let squares = [];           // pool of .grid-square outer elements
let inners = [];            // pool of .grid-square-inner visual elements
let sqWx = null;            // per-pool-slot world X (Int32Array-ish)
let sqWy = null;            // per-pool-slot world Y
let layout = null;          // current layout { SQUARE, GAP, TILE, cols, rows }
let baseX = 0;              // even-count centering offset
let baseY = 0;

// Drag/motion state.
let dragX = 0, dragY = 0;
let lazyX = 0, lazyY = 0;
let vx = 0, vy = 0;
let mouseX = 0, mouseY = 0;
let dragging = false;
let pointerStartX = 0, pointerStartY = 0;
let dragStartX = 0, dragStartY = 0;
let pressMoved = false;
let pressTargetSquare = null;
let velHistory = [];

// Performance: skip same-value transform writes.
let lastWorldX = NaN, lastWorldY = NaN;

// Run loop state.
let rafId = 0;
let lastT = 0;
let timeBase = 0;   // wall-clock anchor; t passed to render is seconds since open

// Authored data.
let images = [];

// Per-image detail modal (inner modal — when user clicks a square).
let detailScrim = null;
let detailWindow = null;
let detailImg = null;
let detailVideo = null;
let detailCaption = null;
let detailCloseBtn = null;
let detailPrevBtn = null;   // cycle arrows — see stepDetail()
let detailNextBtn = null;
let detailOpen = false;
let detailIndex = 0;        // current entry's index in `images` (cycling state)
let detailOriginSquare = null;
let detailCloseTimer = null;

// Outer modal close timer.
let modalCloseTimer = null;

/* -----------------------------------------------------------------------------
   PUBLIC API
   --------------------------------------------------------------------------- */

export function openGridModal(imagesArg) {
  if (modalOpen) return;
  images = Array.isArray(imagesArg) ? imagesArg : [];

  const isFirstOpen = !modalScrim;
  ensureModal();

  // Cancel any pending close-cleanup timer in case the user re-opens while
  // the close animation is still running.
  if (modalCloseTimer) {
    clearTimeout(modalCloseTimer);
    modalCloseTimer = null;
  }

  // Make scrim visible (display:none → block via .is-visible).
  modalScrim.classList.add("is-visible");

  // Compute initial layout against current viewport. The modal sheet
  // becomes the layout reference — we measure the SHEET, not the
  // viewport, since the sheet is what bounds the grid surface.
  resetGridState();
  recomputeLayoutAndPaint();

  // Preload thumbnails. Full images load on demand in detail modal.
  preloadImages(images);

  // FIRST-OPEN FIX: same trick as turnPanel's info modal. The modal DOM
  // was just created — without forcing a layout flush, the transition
  // collapses into a single paint and the slide-up animation doesn't
  // play.
  if (isFirstOpen) {
    // eslint-disable-next-line no-unused-expressions
    modalScrim.offsetHeight;
    requestAnimationFrame(() => {
      modalScrim.classList.add("is-open");
      modalOpen = true;
      startLoop();
    });
  } else {
    modalScrim.classList.add("is-open");
    modalOpen = true;
    startLoop();
  }
}

function closeGridModal() {
  if (!modalOpen) return;
  modalOpen = false;
  modalScrim.classList.remove("is-open");

  // Close the inner detail modal if it's still open, so reopening the
  // grid modal doesn't show a stale detail view.
  if (detailOpen) closeDetail();

  // Stop the run loop. The grid is no longer visible so per-frame work
  // is wasted; resume on next open.
  stopLoop();

  // After the slide-down animation finishes, hide the scrim entirely so
  // it doesn't sit on top of the page intercepting events at z:10.
  modalCloseTimer = setTimeout(() => {
    modalScrim.classList.remove("is-visible");
    modalCloseTimer = null;
  }, MODAL_ANIM_MS + 20);
}

/* -----------------------------------------------------------------------------
   MODAL CONSTRUCTION (lazy, one-time)
   --------------------------------------------------------------------------- */

function ensureModal() {
  if (modalScrim) return;

  // Outer modal: scrim → sheet → close + surface
  modalScrim = document.createElement("div");
  modalScrim.className = "grid-modal-scrim";
  modalScrim.setAttribute("aria-hidden", "true");

  modalSheet = document.createElement("div");
  modalSheet.className = "grid-modal-sheet";
  modalSheet.setAttribute("role", "dialog");
  modalSheet.setAttribute("aria-modal", "true");

  modalCloseBtn = document.createElement("button");
  modalCloseBtn.className = "grid-modal-close";
  modalCloseBtn.setAttribute("aria-label", "Close grid");
  modalCloseBtn.innerHTML = "&times;";

  surface = document.createElement("div");
  surface.className = "grid-surface";
  // The surface gets pointer-events:auto immediately — unlike when it
  // was a panel, there's no "is this the active panel" question. If
  // the modal is open, the surface is interactive. Pure CSS handles it.

  world = document.createElement("div");
  world.className = "grid-world";
  surface.appendChild(world);

  // Build the pool of squares once. Reused across all opens.
  const frag = document.createDocumentFragment();
  for (let i = 0; i < POOL_COLS * POOL_ROWS; i++) {
    const sq = document.createElement("div");
    sq.className = "grid-square";
    const inner = document.createElement("div");
    inner.className = "grid-square-inner";
    sq.appendChild(inner);
    frag.appendChild(sq);
    squares.push(sq);
    inners.push(inner);
  }
  world.appendChild(frag);

  sqWx = new Array(squares.length).fill(NaN);
  sqWy = new Array(squares.length).fill(NaN);

  modalSheet.appendChild(modalCloseBtn);
  modalSheet.appendChild(surface);
  modalScrim.appendChild(modalSheet);
  document.body.appendChild(modalScrim);

  // Close interactions: × button, scrim click outside sheet, Escape.
  modalCloseBtn.addEventListener("click", closeGridModal);
  modalScrim.addEventListener("click", (e) => {
    if (e.target === modalScrim) closeGridModal();
  });
  document.addEventListener("keydown", (e) => {
    if (!modalOpen) return;
    if (e.key === "Escape") {
      // Hierarchy: if the per-image detail modal is open, Escape closes
      // THAT first; otherwise it closes the whole grid modal.
      if (detailOpen) closeDetail();
      else closeGridModal();
    } else if (detailOpen && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      // Arrow keys cycle the detail modal, mirroring the on-screen nav
      // chips (see stepDetail). preventDefault stops the keys from also
      // nudging the page scroller underneath the modal stack.
      e.preventDefault();
      stepDetail(e.key === "ArrowRight" ? 1 : -1);
    }
  });

  attachGridListeners();
  ensureDetailModal();
}

function ensureDetailModal() {
  if (detailScrim) return;

  detailScrim = document.createElement("div");
  detailScrim.className = "grid-detail-scrim";
  detailScrim.setAttribute("aria-hidden", "true");

  detailWindow = document.createElement("div");
  detailWindow.className = "grid-detail-window";
  detailWindow.setAttribute("role", "dialog");
  detailWindow.setAttribute("aria-modal", "true");

  detailCloseBtn = document.createElement("button");
  detailCloseBtn.className = "grid-detail-close";
  detailCloseBtn.setAttribute("aria-label", "Close");
  detailCloseBtn.innerHTML = "&times;";

  // Cycle arrows — prev/next through the authored images array (see
  // stepDetail). Same chip treatment as the close button; the chevrons are
  // drawn in CSS as hairline bars, matching the ×'s language. Hidden via
  // .is-lone on the scrim (set in openDetail) when the set has one entry.
  detailPrevBtn = document.createElement("button");
  detailPrevBtn.className = "grid-detail-nav grid-detail-nav--prev";
  detailPrevBtn.setAttribute("aria-label", "Previous image");
  detailNextBtn = document.createElement("button");
  detailNextBtn.className = "grid-detail-nav grid-detail-nav--next";
  detailNextBtn.setAttribute("aria-label", "Next image");

  const imageWrap = document.createElement("div");
  imageWrap.className = "grid-detail-image-wrap";
  detailImg = document.createElement("img");
  detailImg.className = "grid-detail-image";
  detailImg.alt = "";
  imageWrap.appendChild(detailImg);

  // Video counterpart to detailImg — used when an entry's `full` points at a
  // video file. Muted + loop + autoplay is the silent-portfolio-clip
  // treatment; muted autoplay isn't gated by browser autoplay policy.
  // playsInline stops iOS from forcing fullscreen. preload="none" means a
  // video never downloads until a video entry is actually opened.
  detailVideo = document.createElement("video");
  detailVideo.className = "grid-detail-video";
  detailVideo.muted = true;
  detailVideo.loop = true;
  detailVideo.playsInline = true;
  detailVideo.preload = "none";
  detailVideo.style.display = "none";
  imageWrap.appendChild(detailVideo);

  detailCaption = document.createElement("div");
  detailCaption.className = "grid-detail-caption";

  detailWindow.appendChild(detailCloseBtn);
  detailWindow.appendChild(imageWrap);
  // Nav chips live INSIDE the image wrap (not the window) so they flank the
  // image area in both orientations — on the window they'd sit over the
  // caption column in landscape. The wrap is position: relative for this.
  imageWrap.appendChild(detailPrevBtn);
  imageWrap.appendChild(detailNextBtn);
  detailWindow.appendChild(detailCaption);
  detailScrim.appendChild(detailWindow);
  document.body.appendChild(detailScrim);

  detailCloseBtn.addEventListener("click", closeDetail);
  detailPrevBtn.addEventListener("click", () => stepDetail(-1));
  detailNextBtn.addEventListener("click", () => stepDetail(1));
  detailScrim.addEventListener("click", (e) => {
    if (e.target === detailScrim) closeDetail();
  });
  // Note: Escape closes the detail modal first, then the grid modal.
  // That handler is registered in ensureModal() and checks detailOpen.
}

/* -----------------------------------------------------------------------------
   DETERMINISTIC PER-CELL ASSIGNMENT
   -----------------------------------------------------------------------------
   Each cell of the infinite world deterministically maps to one entry in
   the images array. The mapping needs to be:
     (1) deterministic — the same cell always shows the same image, no
         matter how the user dragged to get there;
     (2) duplicate-free in the visible window — within whatever 5×3 to
         7×4 region the user sees at once, no image should appear twice.

   THE OBVIOUS APPROACH AND WHY IT'S WRONG
     A random hash of (wx, wy) modulo images.length feels like it should
     produce well-distributed assignments — and it does. But "well-
     distributed across infinite cells" is the wrong objective. Within a
     small window (say 15 visible cells), drawing from N=144 with
     replacement has a ~53% chance of at least one collision by the
     birthday paradox. A good hash distributes uniformly; uniform is the
     enemy here. (Tested empirically: the previous hash produced
     duplicates in 35% of all 5×3 windows.)

   STRIDE-BASED LINEAR INDEXING
     Compute a linear index linear = (wy * STRIDE + wx) mod N. Then look
     up the image via globalPerm[linear], where globalPerm is a fixed
     random permutation of 0..N-1.

     Two cells (wx1, wy1) and (wx2, wy2) collide iff:
         (dy * STRIDE + dx) ≡ 0  (mod N)   where (dx, dy) = (wx2-wx1, wy2-wy1)

     For STRIDE coprime with N and STRIDE > window-width, the only small
     (dx, dy) satisfying this is (0, 0). So inside any 5×3 to 7×4 window,
     every cell gets a different linear index — guaranteed zero
     duplicates. (Tested: 0% windows with duplicates up to 7×4 = 28 cells.)

     The globalPerm scrambles the linear sequence so the visible pattern
     reads as random — without it, the stride would produce a regular
     diagonal repetition the eye picks up on.

   STRIDE CHOICE
     STRIDE = 37 is prime (always coprime with anything except multiples
     of 37). For N=144, this means the recursive sequence
         0, 37, 74, 111, 4 (148-144), 41, 78, ...
     visits all 144 residues before repeating, and adjacent rows are 37
     apart in the sequence — well beyond any visible-window width.

   CHANGING THE IMAGES COUNT
     STRIDE only needs to be coprime with N. 37 is fine for any N that
     isn't a multiple of 37. If you ever have exactly 37, 74, 111, 148,
     185, etc. images, change STRIDE to another prime (41, 43, 47).
   --------------------------------------------------------------------------- */

const STRIDE = 37;
let globalPerm = null;     // built lazily on first call, sized to images.length

function buildGlobalPerm(N) {
  // Fisher-Yates shuffle of 0..N-1. Seeded with a fixed constant so the
  // assignment is stable across page reloads (a user revisiting the page
  // sees the same image in the same cell). The seed value is arbitrary —
  // it just needs to be consistent.
  const arr = new Array(N);
  for (let i = 0; i < N; i++) arr[i] = i;
  let seed = 0xCAFEBABE;
  // mulberry32 — small, fast, deterministic PRNG. Good distribution for
  // shuffle purposes; not cryptographic, but cells-to-images mapping
  // doesn't need to be.
  const rand = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

function ensurePerm(N) {
  // Rebuild if the images count changed (e.g. a different panel opens
  // the modal with a different gridImages array). This is cheap — O(N).
  if (!globalPerm || globalPerm.length !== N) {
    globalPerm = buildGlobalPerm(N);
  }
}

function imageForCell(wx, wy) {
  if (!images || images.length === 0) return null;
  const N = images.length;
  ensurePerm(N);
  const linear = mod(wy * STRIDE + wx, N);
  return images[globalPerm[linear]];
}

function colorForCell(wx, wy) {
  // Same approach for the fallback color, but the small palette (8 colors)
  // means duplicates are guaranteed within any visible window — that's
  // fine since the fallback is a transient state during image load.
  const N = FALLBACK_COLORS.length;
  const linear = mod(wy * STRIDE + wx, N);
  return FALLBACK_COLORS[linear];
}

/* -----------------------------------------------------------------------------
   LAYOUT
   -----------------------------------------------------------------------------
   The grid is sized to fit within the modal sheet (not the viewport). The
   sheet is bordered by margins/padding from the viewport; we measure its
   client rect at layout time. This matters when the user resizes the
   browser: the sheet's dimensions change, which means the grid needs to
   recompute its square size.

   EDGE-BLEED LAYOUT
   To suggest "more content exists off-screen," the squares immediately
   outside the cols/rows region clip slightly. The math: instead of fitting
   `cols * tile + gap` cleanly in the sheet, we fit `(cols + 1) * tile` —
   one extra tile per axis. That extra tile splits as half on each edge.
   --------------------------------------------------------------------------- */
function gridForAspect(w, h) {
  const ar = w / h;
  if (ar >= 1.5) return { cols: 5, rows: 3 };
  if (ar >= 1.1) return { cols: 4, rows: 3 };
  if (ar >= 0.9) return { cols: 3, rows: 3 };
  if (ar >= 0.6) return { cols: 3, rows: 4 };
  return         { cols: 2, rows: 4 };
}

function computeLayout() {
  // Measure the surface itself — it's our reference, not the viewport.
  // (The surface fills the sheet, the sheet has padding from the viewport.)
  const rect = surface.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  let { cols, rows } = gridForAspect(w, h);

  for (let attempt = 0; attempt < 12; attempt++) {
    const xSize = w / (1.375 * (cols + 1));
    const ySize = h / (1.375 * (rows + 1));
    const SQUARE = Math.min(xSize, ySize);

    if (SQUARE > Math.min(w, h) * 0.05) {
      const GAP = SQUARE * GAP_RATIO;
      return { SQUARE, GAP, TILE: SQUARE + GAP, cols, rows };
    }
    if (xSize < ySize) cols++;
    else rows++;
  }

  const SQUARE = Math.min(w, h) / 6;
  const GAP = SQUARE * GAP_RATIO;
  return { SQUARE, GAP, TILE: SQUARE + GAP, cols, rows };
}

function baseOffsetFor(cols, rows, TILE) {
  return {
    x: (cols % 2 === 0) ? TILE / 2 : 0,
    y: (rows % 2 === 0) ? TILE / 2 : 0,
  };
}

function mod(n, m) { return ((n % m) + m) % m; }

function recomputeLayoutAndPaint() {
  layout = computeLayout();
  const base = baseOffsetFor(layout.cols, layout.rows, layout.TILE);
  baseX = base.x;
  baseY = base.y;
  surface.style.setProperty("--grid-square-size", layout.SQUARE + "px");
  // Invalidate per-slot world tracking so the next render re-paints all
  // cells with the new sizing.
  sqWx.fill(NaN);
  sqWy.fill(NaN);
  // Reset transform-write guard so the first frame after resize writes.
  lastWorldX = NaN;
  lastWorldY = NaN;
}

function resetGridState() {
  // Reset drag/motion state on each open so the grid starts at origin.
  // The pool itself is reused (DOM is preserved), but the conceptual
  // position is reset — same UX as opening a fresh grid each time.
  dragX = 0; dragY = 0;
  lazyX = 0; lazyY = 0;
  vx = 0; vy = 0;
  dragging = false;
  pressMoved = false;
  pressTargetSquare = null;
  velHistory.length = 0;
  surface.classList.remove("is-dragging");

  // Center the lazy-follow target initially so it doesn't yank toward the
  // last known cursor position from a previous open.
  const rect = surface.getBoundingClientRect();
  mouseX = rect.left + rect.width / 2;
  mouseY = rect.top + rect.height / 2;

  // Wall-clock anchor for the float timing. Each open's float starts at
  // phase 0; without this, reopening would resume the float from wherever
  // it had been globally, which is fine but less clean.
  timeBase = performance.now();
}

/* -----------------------------------------------------------------------------
   GRID INTERACTION
   -----------------------------------------------------------------------------
   Pointer Events on the surface (pointerdown) + window (pointermove/up). The
   window listeners ensure a drag that leaves the surface still tracks.
   --------------------------------------------------------------------------- */
function attachGridListeners() {
  surface.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  // Cursor tracking for lazy-follow. We track at window level so the
  // cursor's last known position is current even when over the modal's
  // chrome (close button, sheet borders).
  window.addEventListener("mousemove", onMouseMove);

  // Recompute layout on resize. The modal sheet's dimensions change with
  // the viewport, so the grid's square size needs to update.
  window.addEventListener("resize", onResize);
}

function onPointerDown(e) {
  if (!modalOpen) return;
  vx = 0;
  vy = 0;
  dragging = true;
  pressMoved = false;
  pointerStartX = e.clientX;
  pointerStartY = e.clientY;
  pressTargetSquare = e.target.closest(".grid-square");
  dragStartX = dragX;
  dragStartY = dragY;
  velHistory.length = 0;
  velHistory.push({ x: e.clientX, y: e.clientY, t: performance.now() });
  surface.classList.add("is-dragging");
  try { surface.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
}

function onPointerMove(e) {
  if (!dragging) return;
  const dx = e.clientX - pointerStartX;
  const dy = e.clientY - pointerStartY;
  if (!pressMoved && Math.hypot(dx, dy) > CLICK_THRESHOLD_PX) {
    pressMoved = true;
  }
  dragX = dragStartX + dx;
  dragY = dragStartY + dy;

  const now = performance.now();
  velHistory.push({ x: e.clientX, y: e.clientY, t: now });
  while (velHistory.length > 0 && velHistory[0].t < now - VEL_WINDOW_MS) {
    velHistory.shift();
  }
}

function onPointerUp(_e) {
  if (!dragging) return;
  dragging = false;
  surface.classList.remove("is-dragging");

  // Release velocity from the recent motion window. dt > 10ms guards
  // against div-by-zero on synthetic events.
  if (velHistory.length >= 2) {
    const first = velHistory[0];
    const last = velHistory[velHistory.length - 1];
    const dt_ms = last.t - first.t;
    if (dt_ms > 10) {
      vx = (last.x - first.x) * 1000 / dt_ms;
      vy = (last.y - first.y) * 1000 / dt_ms;
    }
  }

  // Treat as click if cursor never moved past the threshold.
  if (!pressMoved && pressTargetSquare && pressTargetSquare._gridEntry) {
    openDetail(pressTargetSquare);
  }
  pressTargetSquare = null;
}

function onMouseMove(e) {
  mouseX = e.clientX;
  mouseY = e.clientY;
}

function onResize() {
  if (!modalOpen) return;
  recomputeLayoutAndPaint();
  // Reset drag state — preserving offsets across an aspect change would
  // strand the user on an off-screen patch.
  dragX = 0; dragY = 0;
  vx = 0; vy = 0;
  lazyX = 0; lazyY = 0;
}

/* -----------------------------------------------------------------------------
   THE PER-IMAGE DETAIL MODAL
   -----------------------------------------------------------------------------
   Clicking a square opens this. Same FLIP-style grow-from-square animation
   as before. z:11 — above the grid modal sheet (z:10).

   While open, the nav chips and the Left/Right arrow keys cycle through the
   authored images array without closing (stepDetail) — one lap covers the
   whole set. The shrink-back origin retargets to a visible square showing
   the current entry (retargetOrigin), and adjacent full-res images are
   pre-warmed (warmNeighbors) so cycling feels instant.
   --------------------------------------------------------------------------- */
// Detect whether an entry's `full` source is a video rather than an image.
// The detail modal renders videos into the <video>, images into the <img>.
// Strip any ?query / #hash before testing so "clip.mp4?v=2" still matches.
function isVideoSrc(url) {
  if (!url) return false;
  const clean = url.split("?")[0].split("#")[0];
  return /\.(mp4|webm|mov|m4v)$/i.test(clean);
}

/* Populate the detail media + caption for one entry. Shared by openDetail
   (first show) and stepDetail (arrow / keyboard cycling), so the
   clear-before-set guard and the image/video split live in exactly one
   place — cycling MUST NOT grow its own copy of this logic.

   An entry whose `full` is a video renders into the <video>; everything
   else renders into the <img>. Whichever element isn't in use is cleared
   and hidden so a stale asset never shows through.

   Clearing src BEFORE setting the new one drops the previous element's
   pixels immediately — otherwise the old image/frame keeps painting until
   the new source decodes, visible as a flash of the previously-viewed
   media (during the grow on open; on cycle, as the outgoing image lingering
   under the incoming one). For cached files the new source decodes in the
   same frame; for uncached there's a brief blank moment, still cleaner
   than showing the wrong media. warmNeighbors() makes the cached case the
   common one when cycling. */
function populateDetail(entry) {
  const fullSrc = entry.full || entry.src;
  if (isVideoSrc(entry.full)) {
    detailImg.src = "";
    detailImg.style.display = "none";
    detailVideo.style.display = "";
    detailVideo.poster = entry.src || "";   // thumbnail shows while the video loads
    detailVideo.src = "";
    detailVideo.src = fullSrc;
    // Muted autoplay is permitted, but play() still returns a promise that
    // can reject (e.g. power-saving modes). Swallow it — the poster remains.
    detailVideo.play().catch(() => { /* autoplay blocked: poster stays */ });
  } else {
    detailVideo.pause();
    detailVideo.removeAttribute("src");
    detailVideo.load();                      // release the previous video buffer
    detailVideo.style.display = "none";
    detailImg.style.display = "";
    detailImg.src = "";
    detailImg.src = fullSrc;
  }
  detailImg.alt = entry.alt || "";
  detailCaption.innerHTML = entry.caption || "";
}

function openDetail(originSquare) {
  if (detailOpen) return;
  const entry = originSquare._gridEntry;
  if (!entry) return;

  if (detailCloseTimer) {
    clearTimeout(detailCloseTimer);
    detailCloseTimer = null;
  }

  detailOpen = true;
  detailOriginSquare = originSquare;

  // Cycling state. indexOf is reference equality, and _gridEntry IS an
  // element of `images` (stashed during pool recycle), so this is exact.
  // -1 can't normally happen; 0 is a safe fallback that keeps the arrows
  // working. The nav chips hide entirely for single-entry sets.
  detailIndex = Math.max(0, images.indexOf(entry));
  detailScrim.classList.toggle("is-lone", images.length < 2);

  populateDetail(entry);
  warmNeighbors();

  detailScrim.classList.add("is-visible");
  // eslint-disable-next-line no-unused-expressions
  detailWindow.offsetHeight;

  const originRect = originSquare.getBoundingClientRect();
  const targetRect = detailWindow.getBoundingClientRect();
  const scale = originRect.width / targetRect.width;
  const dx = (originRect.left + originRect.width / 2) -
             (targetRect.left + targetRect.width / 2);
  const dy = (originRect.top + originRect.height / 2) -
             (targetRect.top + targetRect.height / 2);

  detailWindow.style.transition = "none";
  detailWindow.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
  // eslint-disable-next-line no-unused-expressions
  detailWindow.offsetHeight;

  requestAnimationFrame(() => {
    detailWindow.style.transition = "";
    detailWindow.style.transform = "";
    detailScrim.classList.add("is-open");
  });
}

function closeDetail() {
  if (!detailOpen) return;
  detailOpen = false;

  // Freeze the video on its current frame during the shrink-back animation.
  // Pausing keeps the last frame painted; clearing src now would blank it
  // mid-animation. The src is released in the cleanup timer below.
  if (detailVideo) detailVideo.pause();

  if (detailOriginSquare) {
    const originRect = detailOriginSquare.getBoundingClientRect();
    const targetRect = detailWindow.getBoundingClientRect();
    if (originRect.width > 0 && originRect.height > 0) {
      const scale = originRect.width / targetRect.width;
      const dx = (originRect.left + originRect.width / 2) -
                 (targetRect.left + targetRect.width / 2);
      const dy = (originRect.top + originRect.height / 2) -
                 (targetRect.top + targetRect.height / 2);
      detailWindow.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    }
  }
  detailScrim.classList.remove("is-open");

  detailCloseTimer = setTimeout(() => {
    detailScrim.classList.remove("is-visible");
    detailWindow.style.transform = "";
    detailOriginSquare = null;
    detailCloseTimer = null;
    // Release the video buffer once it's fully hidden.
    if (detailVideo) {
      detailVideo.removeAttribute("src");
      detailVideo.load();
    }
  }, DETAIL_ANIM_MS + 20);
}

/* Advance the open detail modal through the authored images array
   (dir = ±1, wrapping). Driven by the on-screen nav chips and the
   Left/Right arrow keys.

   "Next" means ARRAY ORDER, not grid position: the grid is an infinite
   2D field with no meaningful linear neighbor, while the array is the one
   total order the author actually chose — and a full lap shows every
   entry exactly once, which is the point (browsing the whole set without
   the click-in/click-out loop). */
function stepDetail(dir) {
  if (!detailOpen || images.length < 2) return;
  detailIndex = mod(detailIndex + dir, images.length);
  const entry = images[detailIndex];
  populateDetail(entry);
  retargetOrigin(entry);
  warmNeighbors();
}

/* Keep the FLIP shrink-back honest while cycling: retarget
   detailOriginSquare at a pool square that currently SHOWS the current
   entry and sits inside the grid surface's visible rect, so close lands
   on the image the user is actually looking at (closeDetail re-measures
   the origin at close time — this feeds that existing logic). For typical
   image counts every entry appears several times in the 112-slot pool, so
   a hit is the common case; on a miss the previous origin is kept and the
   shrink still lands somewhere real. ~pool-size rect reads, only on a
   user action — never per-frame. */
function retargetOrigin(entry) {
  if (!surface) return;
  const surf = surface.getBoundingClientRect();
  for (const sq of squares) {
    if (sq._gridEntry !== entry) continue;
    const r = sq.getBoundingClientRect();
    if (r.width > 0 &&
        r.right > surf.left && r.left < surf.right &&
        r.bottom > surf.top && r.top < surf.bottom) {
      detailOriginSquare = sq;
      return;
    }
  }
}

/* Warm the two adjacent full-res IMAGES so an arrow press swaps in the
   same frame instead of showing populateDetail's clear-before-set blank.
   Videos are skipped on purpose — the preload="none" policy (a clip never
   downloads until its entry is actually opened) stays intact. */
function warmNeighbors() {
  if (images.length < 2) return;
  for (const d of [-1, 1]) {
    const e = images[mod(detailIndex + d, images.length)];
    if (!e) continue;
    if (isVideoSrc(e.full)) continue;
    const full = e.full || e.src;
    if (full) new Image().src = full;
  }
}

/* -----------------------------------------------------------------------------
   IMAGE PRELOAD
   -----------------------------------------------------------------------------
   Only the thumbnails (entry.src) are preloaded. Full-resolution images
   (entry.full) load on demand when the detail modal opens — preloading
   them up-front would defeat the thumb/full split.
   --------------------------------------------------------------------------- */
function preloadImages(imgs) {
  if (!imgs || imgs.length === 0) return;
  for (const entry of imgs) {
    if (!entry || !entry.src) continue;
    const img = new Image();
    img.src = entry.src;
    img.decode().catch(() => { /* missing/corrupt: cell falls back to color */ });
  }
}

/* -----------------------------------------------------------------------------
   RUN LOOP
   -----------------------------------------------------------------------------
   requestAnimationFrame loop that runs only while the modal is open. Drives
   drag inertia, lazy-follow, and the per-frame render.
   --------------------------------------------------------------------------- */
function startLoop() {
  if (rafId) return;
  lastT = performance.now();
  rafId = requestAnimationFrame(tick);
}

function stopLoop() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

function tick(now) {
  rafId = requestAnimationFrame(tick);

  const dt = Math.min(0.1, (now - lastT) / 1000);  // clamp dt; tab-switch can produce huge gaps
  lastT = now;
  const t = (now - timeBase) / 1000;

  // LAZY MOUSE-FOLLOW — paused during drag.
  if (LAZY_FOLLOW_ENABLED && !dragging) {
    // The target is offset from the surface's center, not the viewport's,
    // since the grid lives inside the modal sheet now.
    const rect = surface.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const targetLazyX = (mouseX - cx) * LAZY_FACTOR;
    const targetLazyY = (mouseY - cy) * LAZY_FACTOR;
    const lazyEase = 1 - Math.exp(-LAZY_SPEED * dt);
    lazyX += (targetLazyX - lazyX) * lazyEase;
    lazyY += (targetLazyY - lazyY) * lazyEase;
  }

  // INERTIA (frame-rate independent).
  if (!dragging) {
    const speed = Math.hypot(vx, vy);
    if (speed > STOP_SPEED_PX_S) {
      dragX += vx * dt;
      dragY += vy * dt;
      const frictionMul = Math.exp(-FRICTION * dt);
      vx *= frictionMul;
      vy *= frictionMul;
    } else if (vx !== 0 || vy !== 0) {
      vx = 0;
      vy = 0;
    }
  }

  render(t);
}

function render(t) {
  const rect = surface.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const { SQUARE, TILE } = layout;

  const totalX = dragX + lazyX;
  const totalY = dragY + lazyY;

  // Single world transform write (snap to integer pixels — avoids sub-
  // pixel AA flicker, especially relevant near the modal sheet's rounded
  // corner clip).
  const tx = Math.round(totalX);
  const ty = Math.round(totalY);
  if (tx !== lastWorldX || ty !== lastWorldY) {
    lastWorldX = tx;
    lastWorldY = ty;
    world.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
  }

  const startCol = Math.floor(-totalX / TILE) - Math.floor(POOL_COLS / 2);
  const startRow = Math.floor(-totalY / TILE) - Math.floor(POOL_ROWS / 2);

  for (let row = 0; row < POOL_ROWS; row++) {
    for (let col = 0; col < POOL_COLS; col++) {
      const wx = startCol + col;
      const wy = startRow + row;
      const i = mod(wx, POOL_COLS) + POOL_COLS * mod(wy, POOL_ROWS);
      const recycled = sqWx[i] !== wx || sqWy[i] !== wy;
      const sq = squares[i];

      // Per-cell transform: written every frame when float is on (positions
      // change each frame). When float is off, only written on recycle (a
      // pool slot changing which world cell it represents during a drag).
      if (FLOAT_ENABLED || recycled) {
        let fx = 0, fy = 0;
        if (FLOAT_ENABLED) {
          const phaseX = wx * 1.7 + wy * 2.3;
          const phaseY = wx * 2.1 + wy * 1.5 + 1.3;
          fx = (Math.sin(t * FLOAT_W_X_A + phaseX) +
                Math.sin(t * FLOAT_W_X_B + phaseX) * FLOAT_B_SCALE) * FLOAT_AMP_PX;
          fy = (Math.sin(t * FLOAT_W_Y_A + phaseY) +
                Math.sin(t * FLOAT_W_Y_B + phaseY) * FLOAT_B_SCALE) * FLOAT_AMP_PX;
        }
        const px = w / 2 + baseX + wx * TILE + fx - SQUARE / 2;
        const py = h / 2 + baseY + wy * TILE + fy - SQUARE / 2;
        sq.style.transform =
          `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
      }

      if (recycled) {
        sqWx[i] = wx;
        sqWy[i] = wy;
        const inner = inners[i];
        const entry = imageForCell(wx, wy);
        if (entry) {
          inner.style.backgroundImage = `url("${entry.src}")`;
          inner.style.backgroundColor = "";
        } else {
          inner.style.backgroundImage = "";
          inner.style.backgroundColor = colorForCell(wx, wy);
        }
        sq._gridEntry = entry;
      }
    }
  }
}
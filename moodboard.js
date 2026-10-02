/* =============================================================================
   moodboard.js — interactive moodboard canvas (a media-stack widget)
   -----------------------------------------------------------------------------
   Replaces the "one flattened contact-sheet image" way of showing a
   moodboard. A landscape canvas holds the board's images as a loose
   cluster of squares — one hero at the top of a size ladder, the rest
   stepping down, with negative space around and inside the cluster. The
   tiles drift slowly at rest. Clicking a tile promotes it to hero: it
   grows into the hero's slot and every tile it displaced steps one rung
   down the ladder, all in one smooth, staggered motion.

   AUTHORING (declarative — a placeholder in a project's `media` HTML)
     <div class="moodboard"
          data-moodboard="images/projects/broncosCapsule/moodboards/spike"
          data-count="12"
          data-hero="1"
          data-seed="spike"
          aria-label="1997–2023 Broncos uniform reference"></div>

       data-moodboard — directory holding 1full.webp … Nfull.webp
       data-count     — N, how many images the directory holds
       data-hero      — 1-based number of the image that opens as hero
                        (default 1)
       data-order     — optional, comma-separated image numbers that set
                        the opening rank order (listed first, in order;
                        unlisted images follow in numeric order). data-hero
                        still wins rank 0 if both are given.
       data-seed      — optional string seeding the layout's random choices
                        (default: the directory). Change it to get a
                        different arrangement of the same slots.

     The host (projectModal) calls mountMoodboards(root) after injecting
     media HTML and unmountMoodboards() before discarding it. Nothing else
     is required per project.

   THE LAYOUT — SLOTS, RANKS, AND WHY THEY'RE SEPARATE
     The canvas is a GRID_COLS-wide unit grid (rows follow the canvas's
     real aspect, which CSS owns). A SIZE_LADDER gives each RANK a square
     size in units: rank 0 is the hero, ranks 1–2 the mediums, and so on.
     packLayout() places one square per rank — hero first, then each next
     size at the free spot nearest the hero (with a landscape stretch, a
     rightward lean, and seeded jitter so the cluster isn't a blob) — and
     re-centres the cluster on the canvas. That set of rects is the board's
     SLOTS, computed once per (count, rows, seed).

     Images map to slots through an ORDER array (rank → image index).
     Promoting image j at rank k moves it to rank 0 and shifts ranks
     0..k-1 down by one. Images ranked below k don't move at all. The
     composition never changes shape; images travel between its slots.
     This is why the slots and the order are separate: re-packing on every
     click would scatter the whole board; rotating the order keeps it
     calm, and the cascade of "each one steps down a rung" is the visible
     story of the click.

   MOTION
     Two layers, both in grid units so a canvas resize mid-flight is just
     a change of scale:
       - TWEEN: each tile carries from/to rects and a start time; frames
         interpolate with an ease-in-out. Retargeting mid-tween starts the
         new tween from the CURRENT interpolated rect, so a fast second
         click never snaps. Displaced tiles start STAGGER_MS × (old rank +
         1) after the promoted tile, so the ladder visibly cascades.
       - DRIFT: two incommensurate sines per axis per tile (the same idle
         idiom as gridModal's cells), amplitude DRIFT_AMP < GAP_UNITS / 2
         so two neighbours drifting toward each other can never touch.
     Position is written as a translate transform every frame; size is
     written as width/height ONLY when it changes (during tweens and on
     resize), so images re-rasterise crisp at every rung instead of being
     GPU-downscaled from one big texture, and the idle loop touches only
     the compositor.

     The frame loop runs only while the canvas is on screen
     (IntersectionObserver) and stops on unmount. Under
     prefers-reduced-motion the drift is off and the loop idles between
     clicks; the promote tween still plays — it IS the interaction's
     meaning, not decoration.

   COUPLED WITH
     - moodboardStyles.css: emits .moodboard (the canvas — owns the aspect
       ratio), .moodboard-tile (+ .is-loaded, .is-hero).
     - projectModal.js: the host — mounts after populating media, unmounts
       before repopulating and after close.
     - sidebarProjects.js: authors the placeholders inside project `media`.
   ========================================================================== */

/* -----------------------------------------------------------------------------
   TUNABLES
   --------------------------------------------------------------------------- */

// Grid resolution across the canvas. Rows follow the canvas's real aspect
// (16:9 → 27 rows). One unit is also the gap, so this sets the gap's share
// of the width: 48 → gap ≈ 2% of the canvas.
const GRID_COLS  = 48;
const GAP_UNITS  = 1;     // minimum clear space between tiles, in units
const EDGE_UNITS = 1;     // minimum clear space between a tile and the canvas edge

// Square size (units) per rank. Ranks past the end use SIZE_REST. With 12
// images on 48×27 the cluster fills ~36% of the canvas; with 18, ~43%.
const SIZE_LADDER = [14, 8, 8, 5, 5, 5, 5, 4, 4, 4, 4];
const SIZE_REST   = 3;

// Placement scoring (lower wins). Vertical distance is weighted up so the
// cluster spreads sideways on a landscape canvas; candidates LEFT of the
// hero are penalised so the cluster grows rightward and, after
// re-centring, the hero sits left of centre. Jitter (units) is seeded
// noise added per candidate so the pick among near-equal spots varies.
const SPREAD_Y     = 1.35;
const LEFT_PENALTY = 1.4;
const PLACE_JITTER = 4;

// Promote tween. Displaced tiles start STAGGER_MS × (old rank + 1) late.
const TWEEN_MS   = 1100;
const STAGGER_MS = 40;

// Idle drift. Amplitude in units — keep below GAP_UNITS / 2 (see MOTION).
// Angular frequencies in rad/s: 0.30–0.55 → periods of 11–21 s.
const DRIFT_AMP   = 0.35;
const DRIFT_W_MIN = 0.30;
const DRIFT_W_MAX = 0.55;
const DRIFT_B_MIX = 0.4;  // weight of the second (slower) sine

/* -----------------------------------------------------------------------------
   MODULE-LEVEL STATE
   -----------------------------------------------------------------------------
   Every mounted board, so unmountMoodboards() can stop them all at once.
   Boards are private objects; nothing about them leaks past this module.
   --------------------------------------------------------------------------- */

const boards = [];

const reducedMotion =
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/* =============================================================================
   PUBLIC API
   ========================================================================== */

/**
 * Find every `[data-moodboard]` placeholder under `root` and turn it into a
 * live board. Safe to call on a root with none (no-op).
 */
export function mountMoodboards(root) {
  if (!root) return;
  root.querySelectorAll("[data-moodboard]").forEach((el) => {
    const board = createBoard(el);
    if (board) boards.push(board);
  });
}

/**
 * Stop every mounted board: cancel its frame loop and disconnect its
 * observers. Call before the host discards the boards' DOM (innerHTML
 * replacement) — the elements themselves go with the host's subtree.
 */
export function unmountMoodboards() {
  for (const board of boards) destroyBoard(board);
  boards.length = 0;
}

/* =============================================================================
   PRIVATE — board construction
   ========================================================================== */

function createBoard(canvas) {
  const dir   = canvas.dataset.moodboard;
  const count = parseInt(canvas.dataset.count, 10);
  if (!dir || !Number.isInteger(count) || count < 1) {
    console.warn("moodboard: placeholder needs data-moodboard and data-count", canvas);
    return null;
  }

  const order = initialOrder(canvas, count);
  const rng   = seededRandom(canvas.dataset.seed || dir);

  const board = {
    canvas,
    dir,
    count,
    order,               // rank → image index (0-based)
    rng,
    rows:  0,            // grid rows, derived from the canvas's real aspect
    unit:  0,            // px per grid unit
    slots: [],           // rank → { x, y, s } in units
    tiles: [],           // image index → tile state (see makeTile)
    visible: false,
    rafId: 0,
    ro: null,
    io: null,
  };

  canvas.classList.add("moodboard", "is-mounted");
  canvas.setAttribute("role", "group");

  // Tiles. Each is a button (keyboard-reachable, Enter/Space promote it)
  // wrapping the image. The image is decorative inside a labelled button —
  // the button's aria-label names it for assistive tech.
  for (let i = 0; i < count; i++) {
    const tile = makeTile(board, i);
    board.tiles.push(tile);
    canvas.appendChild(tile.el);
  }
  setHeroClass(board);

  // First measurement is synchronous so tiles have a real slot before the
  // first paint; the ResizeObserver then owns re-measurement (including
  // an aspect change at the narrow breakpoint, which regenerates slots).
  measure(board);
  board.ro = new ResizeObserver(() => measure(board));
  board.ro.observe(canvas);

  // Only spend frames while the canvas is actually on screen — the modal's
  // content scrolls, and a board far above or below the viewport shouldn't
  // keep the compositor busy.
  board.io = new IntersectionObserver((entries) => {
    board.visible = entries.some((e) => e.isIntersecting);
    if (board.visible) requestFrame(board);
  });
  board.io.observe(canvas);

  return board;
}

function makeTile(board, index) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "moodboard-tile";
  el.setAttribute("aria-label", `Reference image ${index + 1} of ${board.count}`);

  const img = document.createElement("img");
  img.src = `${board.dir}/${index + 1}full.webp`;
  img.alt = "";
  img.loading  = "lazy";
  img.decoding = "async";
  // Fade in once the bitmap is there; a tile that pops in mid-drift reads
  // as a glitch. `complete` covers a cached image whose load event already
  // fired before the listener was attached.
  const reveal = () => el.classList.add("is-loaded");
  if (img.complete && img.naturalWidth > 0) reveal();
  else img.addEventListener("load", reveal, { once: true });
  el.appendChild(img);

  el.addEventListener("click", () => promote(board, index));

  const rng = board.rng;
  return {
    el,
    index,
    rank: board.order.indexOf(index),
    // Rects in grid units. `cur` is what's rendered; from/to bracket a
    // tween in flight. All three are seeded by the first measure().
    cur:  { x: 0, y: 0, s: 1 },
    from: { x: 0, y: 0, s: 1 },
    to:   { x: 0, y: 0, s: 1 },
    t0: 0,
    tweening: false,
    lastSizePx: -1,      // last width/height written, so we only write on change
    // Per-tile drift signature: two frequencies and a phase per axis.
    drift: {
      wxa: lerp(DRIFT_W_MIN, DRIFT_W_MAX, rng()),
      wxb: lerp(DRIFT_W_MIN, DRIFT_W_MAX, rng()) * 0.5,
      wya: lerp(DRIFT_W_MIN, DRIFT_W_MAX, rng()),
      wyb: lerp(DRIFT_W_MIN, DRIFT_W_MAX, rng()) * 0.5,
      px:  rng() * Math.PI * 2,
      py:  rng() * Math.PI * 2,
    },
  };
}

/**
 * Opening rank order from data-order / data-hero. Bad or duplicate numbers
 * are ignored rather than thrown — a typo in a project entry should cost
 * one image's placement, not the whole board.
 */
function initialOrder(canvas, count) {
  const seen  = new Set();
  const order = [];
  const push  = (n) => {
    if (Number.isInteger(n) && n >= 1 && n <= count && !seen.has(n - 1)) {
      seen.add(n - 1);
      order.push(n - 1);
    }
  };
  push(parseInt(canvas.dataset.hero, 10));
  (canvas.dataset.order || "").split(",").forEach((t) => push(parseInt(t, 10)));
  for (let i = 1; i <= count; i++) push(i);
  return order;
}

function destroyBoard(board) {
  if (board.rafId) cancelAnimationFrame(board.rafId);
  board.rafId = 0;
  board.ro?.disconnect();
  board.io?.disconnect();
  board.visible = false;
}

/* =============================================================================
   PRIVATE — measurement and slot generation
   -----------------------------------------------------------------------------
   The canvas's CSS owns its aspect ratio; here we read the box it ended up
   with, derive the unit size and the row count, and (re)generate slots
   whenever the row count changes. A width-only resize just rescales.
   ========================================================================== */

function measure(board) {
  // clientWidth/Height, not getBoundingClientRect: the modal sheet is
  // scale-transformed while it FLIPs open, and the ResizeObserver's first
  // callback lands inside that window. Layout metrics ignore transforms;
  // the bounding rect would hand us the thumbnail-sized version of the
  // canvas. They're also the padding box — the box the absolute tiles are
  // positioned against — so the border isn't counted as canvas.
  const width  = board.canvas.clientWidth;
  const height = board.canvas.clientHeight;
  if (width < 1 || height < 1) return;             // hidden — nothing to lay out

  board.unit = width / GRID_COLS;
  const rows = Math.max(SIZE_LADDER[0] + 2 * EDGE_UNITS, Math.round(height / board.unit));

  if (rows !== board.rows) {
    // First layout: seed the tiles in place (no tween). Later ones (an
    // aspect change): glide to the new slots, no stagger.
    const first = board.slots.length === 0;
    board.rows  = rows;
    board.slots = packLayout(sizesFor(board.count), GRID_COLS, rows, board.rng);
    retarget(board, performance.now(), () => 0, first);
  }

  // Unit changed → every size in px changed. Force a rewrite, and write
  // the layout NOW rather than waiting for a frame: frames are gated on
  // visibility, and a board below the fold must already be in place when
  // the user scrolls down to it, not snap into place as it enters view.
  for (const tile of board.tiles) tile.lastSizePx = -1;
  render(board, performance.now());
  requestFrame(board);
}

function sizesFor(count) {
  const sizes = [];
  for (let r = 0; r < count; r++) {
    sizes.push(r < SIZE_LADDER.length ? SIZE_LADDER[r] : SIZE_REST);
  }
  return sizes;
}

/**
 * Place one square per rank on a cols×rows unit grid and return their rects
 * ({ x, y, s } in units), re-centred as a cluster. Pure: same inputs and
 * the same rng state give the same layout. Exported so the arrangement can
 * be tuned from Node (print it as ASCII) without a browser.
 *
 * Greedy nearest-free-spot placement. Every candidate position that keeps
 * GAP_UNITS clear of placed squares (and EDGE_UNITS clear of the canvas
 * edge) is scored by a stretched distance from the hero's centre plus
 * seeded jitter; the best wins. If a size finds no room at all it shrinks a
 * unit and retries — with the shipped ladder on a 16:9 canvas that never
 * triggers, but a board with 30 images shouldn't silently lose tiles.
 */
export function packLayout(sizes, cols, rows, rng) {
  const occ = new Uint8Array(cols * rows);
  const rects = [];

  const isFree = (x, y, s) => {
    const x0 = Math.max(0, x - GAP_UNITS), y0 = Math.max(0, y - GAP_UNITS);
    const x1 = Math.min(cols, x + s + GAP_UNITS), y1 = Math.min(rows, y + s + GAP_UNITS);
    for (let yy = y0; yy < y1; yy++) {
      const row = yy * cols;
      for (let xx = x0; xx < x1; xx++) if (occ[row + xx]) return false;
    }
    return true;
  };
  const mark = (x, y, s) => {
    for (let yy = y; yy < y + s; yy++) occ.fill(1, yy * cols + x, yy * cols + x + s);
  };

  // Hero: left of centre, roughly mid-height, a little seeded play.
  const s0 = Math.min(sizes[0], cols - 2 * EDGE_UNITS, rows - 2 * EDGE_UNITS);
  const hx = clampInt(Math.round((cols - s0) * lerp(0.34, 0.44, rng())), EDGE_UNITS, cols - s0 - EDGE_UNITS);
  const hy = clampInt(Math.round((rows - s0) * lerp(0.40, 0.60, rng())), EDGE_UNITS, rows - s0 - EDGE_UNITS);
  rects.push({ x: hx, y: hy, s: s0 });
  mark(hx, hy, s0);
  const cx = hx + s0 / 2;
  const cy = hy + s0 / 2;

  for (let r = 1; r < sizes.length; r++) {
    let s = sizes[r];
    let best = null;
    while (!best && s >= 1) {
      let bestScore = Infinity;
      for (let y = EDGE_UNITS; y <= rows - s - EDGE_UNITS; y++) {
        for (let x = EDGE_UNITS; x <= cols - s - EDGE_UNITS; x++) {
          if (!isFree(x, y, s)) continue;
          const dx = x + s / 2 - cx;
          const dy = y + s / 2 - cy;
          const score = Math.hypot(dx * (dx < 0 ? LEFT_PENALTY : 1), dy * SPREAD_Y) + rng() * PLACE_JITTER;
          if (score < bestScore) { bestScore = score; best = { x, y, s }; }
        }
      }
      if (!best) s -= 1;
    }
    if (!best) {
      console.warn(`moodboard: no room for rank ${r}; stacking it on the hero`);
      best = { x: hx, y: hy, s: 1 };
    }
    rects.push(best);
    mark(best.x, best.y, best.s);
  }

  // Re-centre the cluster's bounding box on the canvas.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.s); maxY = Math.max(maxY, r.y + r.s);
  }
  const shiftX = Math.round((cols - (maxX - minX)) / 2 - minX);
  const shiftY = Math.round((rows - (maxY - minY)) / 2 - minY);
  for (const r of rects) { r.x += shiftX; r.y += shiftY; }

  return rects;
}

/* =============================================================================
   PRIVATE — promotion and retargeting
   ========================================================================== */

function promote(board, index) {
  const k = board.order.indexOf(index);
  if (k <= 0) return;                       // already the hero (or unknown)

  board.order.splice(k, 1);
  board.order.unshift(index);

  // The promoted tile leads; each displaced tile follows by its old rank.
  // z-order: the grower crosses others on its way to the hero slot and
  // should pass in front of them.
  const now = performance.now();
  const delayFor = (tile) => (tile.index === index ? 0 : STAGGER_MS * (tile.rank + 1));
  board.tiles[index].el.style.zIndex = String(++zTop);
  retarget(board, now, delayFor, false);
  setHeroClass(board);
  requestFrame(board);
}

let zTop = 1;

/**
 * Point every tile at the slot its current rank owns. Tiles whose slot
 * didn't change are left alone. `snap` seeds cur/from/to all at once (the
 * first layout); otherwise a tween starts from the tile's CURRENT rect —
 * mid-flight or at rest — after `delayFor(tile)` ms.
 */
function retarget(board, now, delayFor, snap) {
  board.order.forEach((index, rank) => {
    const tile = board.tiles[index];
    const slot = board.slots[rank];
    const delay = delayFor(tile);
    tile.rank = rank;
    if (!slot) return;
    if (tile.to.x === slot.x && tile.to.y === slot.y && tile.to.s === slot.s && !snap) return;

    if (snap) {
      tile.cur = { ...slot };
      tile.from = { ...slot };
      tile.to = { ...slot };
      tile.tweening = false;
    } else {
      tile.from = { ...tile.cur };
      tile.to = { ...slot };
      tile.t0 = now + delay;
      tile.tweening = true;
    }
  });
}

function setHeroClass(board) {
  const hero = board.order[0];
  for (const tile of board.tiles) tile.el.classList.toggle("is-hero", tile.index === hero);
}

/* =============================================================================
   PRIVATE — frame loop
   ========================================================================== */

function requestFrame(board) {
  if (board.rafId || !board.visible) return;
  board.rafId = requestAnimationFrame((now) => {
    board.rafId = 0;
    frame(board, now);
  });
}

function frame(board, now) {
  if (render(board, now)) requestFrame(board);
}

/**
 * Write every tile's current rect (plus drift) to the DOM. Returns whether
 * anything is still in motion — a tween in flight, or the drift, which
 * never rests — so the caller knows to keep the loop alive.
 */
function render(board, now) {
  const t = now / 1000;
  const unit = board.unit;
  let busy = false;

  for (const tile of board.tiles) {
    if (tile.tweening) {
      const p = clamp((now - tile.t0) / TWEEN_MS, 0, 1);   // < 0 while staggered → holds at `from`
      const e = easeInOutCubic(p);
      tile.cur.x = lerp(tile.from.x, tile.to.x, e);
      tile.cur.y = lerp(tile.from.y, tile.to.y, e);
      tile.cur.s = lerp(tile.from.s, tile.to.s, e);
      if (p >= 1) tile.tweening = false; else busy = true;
    }

    let dx = 0, dy = 0;
    if (!reducedMotion) {
      const d = tile.drift;
      dx = (Math.sin(t * d.wxa + d.px) + Math.sin(t * d.wxb + d.px) * DRIFT_B_MIX) / (1 + DRIFT_B_MIX) * DRIFT_AMP;
      dy = (Math.sin(t * d.wya + d.py) + Math.sin(t * d.wyb + d.py) * DRIFT_B_MIX) / (1 + DRIFT_B_MIX) * DRIFT_AMP;
      busy = true;
    }

    const sizePx = tile.cur.s * unit;
    if (sizePx !== tile.lastSizePx) {
      tile.el.style.width  = `${sizePx}px`;
      tile.el.style.height = `${sizePx}px`;
      tile.lastSizePx = sizePx;
    }
    tile.el.style.transform =
      `translate3d(${(tile.cur.x + dx) * unit}px, ${(tile.cur.y + dy) * unit}px, 0)`;
  }

  return busy;
}

/* =============================================================================
   PRIVATE — small math
   ========================================================================== */

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function easeInOutCubic(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }

/**
 * Seeded PRNG (mulberry32) over a string hash, so a board's layout is the
 * same on every open and only changes when its data-seed does.
 */
function seededRandom(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

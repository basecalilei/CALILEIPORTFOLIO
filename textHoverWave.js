/* =============================================================================
   textHoverWave.js — cursor-driven spatial wave with snap-flash brand colors
   -----------------------------------------------------------------------------
   The first event-driven primitive in this category. Unlike textScramble,
   textFocus, and textTypewriter — which run a finite timeline to
   completion and then idle — textHoverWave responds continuously to
   cursor position over an unbounded interactive lifetime, falling silent
   when there's nothing to animate and waking back up when the cursor
   re-enters.

   THE MENTAL MODEL
     Each character has an "excitement" value in [0, 1] that:
       - is bumped up toward 1 when the cursor passes nearby, with a
         Gaussian falloff over distance (controlled by waveRadius)
       - decays exponentially toward 0 over time (controlled by
         decayHalfLifeMs)
     This excitement value is INVISIBLE on its own — it's an internal
     dynamic that drives a discrete color state. The visible color of
     each character is binary: pure ink, or pure tint. The character
     SNAPS between these states when excitement crosses litThreshold.

     Each character also stores a `tint` — a brand color picked from the
     pool. The tint is freshly randomized each time the character's
     excitement crosses colorRepickThreshold from below.

   TWO MODES — STANDALONE AND LAYERED
     This primitive runs in one of two modes, auto-detected at startup
     from rootEl's DOM shape:

     STANDALONE MODE (the typical case):
       rootEl contains plain text nodes. textHoverWave walks them,
       replaces each character with a per-character span, manages those
       spans as the sole owner. On cancel, restores text nodes.

     LAYERED MODE (sidebar views with both entry + hover):
       rootEl ALREADY contains per-character spans created by an entry
       primitive (textScramble or textTypewriter) that's running in
       parallel. textHoverWave borrows those spans — doesn't create new
       ones, doesn't restore them on cancel. The entry primitive
       remains the span owner; cancellation order in the view's cancels
       group ensures the entry primitive's cancel handles DOM restore
       after hover has stopped touching the spans.

     Auto-detection: if every text node found in rootEl is the sole
     child of a <span> parent (the structural shape entry primitives
     produce), assume layered mode. Otherwise standalone. The detection
     is reliable because the entry primitives are the only producers
     of that DOM shape in the project.

     The mode affects three things:
       1. Span ownership (described above)
       2. Per-frame color writes: layered mode writes every frame
          while a character is lit, because the entry primitive is
          also writing color and would otherwise overwrite hover's
          state between hover's ticks. Standalone mode writes only on
          state transitions (cheaper).
       3. Cancel behavior: layered mode clears inline colors on
          cancel (defensive cleanup, no DOM restore). Standalone mode
          restores DOM (text nodes back).

   WHY HOVER WINS THE COLOR FIGHT IN LAYERED MODE
     Both primitives have rAF callbacks. The browser fires them in
     registration order within a single frame, all before paint. The
     sidebar views add the entry primitive to the cancels group before
     hover, so entry's rAF registers first and ticks first each frame.
     Hover's writes come AFTER entry's in the same frame — and the
     paint shows hover's last-applied state. Hover wins for characters
     it touches; entry's writes show through for characters hover
     hasn't touched (or has released).

     On release (a character's excitement drops below litThreshold),
     hover clears the inline color. For characters where entry is
     still writing (scramble cycling), entry's next tick restores its
     color — the released character briefly shows ink for one tick.
     For characters where entry has finished writing (typewriter
     post-flash), the clear leaves the character in ink, which is
     correct. The brief ink moment during scramble is visually
     subsumed by scramble's existing chaos.

   IDLE BEHAVIOR
     The rAF loop runs only when there's something to animate:
       - Loop starts on mouseenter, OR on the first mousemove inside
         rootEl when the cursor was already inside at primitive start
         (see STARTING WHEN CURSOR IS ALREADY INSIDE below).
       - Loop continues each tick while ANY character has excitement
         above excitementThreshold OR while the cursor is currently
         inside the element.
       - Loop stops when both conditions go false.

   STARTING WHEN CURSOR IS ALREADY INSIDE
     mouseenter only fires on TRANSITIONS from outside to inside — if
     the cursor is already inside rootEl at the moment listeners are
     attached, mouseenter never fires for that session. The first
     mousemove inside rootEl serves as an implicit enter: marks
     cursorInside = true, recomputes positions, starts the loop.

   POSITION HANDLING
     Character centers (cx, cy) are computed from getBoundingClientRect
     and used for cursor-distance math. Computed at startup AND on every
     enter (real or deferred). See file header history comments —
     refreshing on enter fixes a sidebar-reopen bug where centers
     computed during a CSS transition pointed off-screen.

   USAGE
     import { startHoverWave } from "./textHoverWave.js";

     // Standalone (rootEl has plain text):
     const cancel = startHoverWave(rootEl);

     // Layered (rootEl already has per-char spans from entry primitive):
     // Same call — auto-detection handles it.
     const cancel = startHoverWave(rootEl);

     // Customised — any subset overrides the defaults:
     const cancel = startHoverWave(rootEl, {
       waveRadius:     40,
       litThreshold:   0.4,
     });

     // Always-callable cancel — removes listeners, restores DOM
     // (standalone) or cleans up inline colors (layered):
     cancel();

   CONCURRENCY
     Each startHoverWave call is independent. Calling it twice on the
     same element will corrupt both. Use the cancels-group pattern from
     cancels.js for exclusivity. In layered mode, the entry primitive
     and hover wave coordinate via tick ordering, not shared state —
     each runs its own rAF loop on the shared span set.
   ========================================================================== */

/* -----------------------------------------------------------------------------
   DEFAULTS
   --------------------------------------------------------------------------- */

const DEFAULTS = {
  waveRadius: 35,
  litThreshold: 0.3,
  peakExcitement: 1.0,
  decayHalfLifeMs: 300,
  excitementThreshold: 0.02,
  colorRepickThreshold: 0.5,
  colors: [
    "var(--brand-red)",
    "var(--brand-yellow)",
    "var(--brand-green)",
    "var(--brand-blue)",
  ],
};

/* -----------------------------------------------------------------------------
   PUBLIC API
   --------------------------------------------------------------------------- */

export function startHoverWave(rootEl, options = {}) {
  const opts = { ...DEFAULTS, ...options };

  // First pass: collect text nodes. Walking and mutating simultaneously
  // would invalidate the TreeWalker; gather refs first.
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) {
    if (n.textContent) textNodes.push(n);
  }
  if (textNodes.length === 0) return () => {};

  // Mode detection. If every text node is already inside a per-character
  // span (sole child of a <span> parent), we're in layered mode — an
  // entry primitive ran first and produced this DOM shape. Otherwise
  // we're standalone and need to create spans ourselves.
  const isLayered = textNodes.every((t) => {
    const p = t.parentNode;
    return p
        && p.nodeName === "SPAN"
        && p.childNodes.length === 1
        && p.firstChild === t;
  });

  const groups = []; // [{ originalNode, spans }, ...] — only populated in standalone mode
  const items  = []; // flat list, one per character

  if (isLayered) {
    // Borrow existing spans. The text node's parent IS the per-char span.
    for (const t of textNodes) {
      const span = t.parentNode;
      items.push({
        char:        t.textContent,
        span,
        cx:          0,
        cy:          0,
        excitement:  0,
        isLit:       false,
        tint:        null,
      });
    }
    // No groups entry — we don't own these spans and won't restore them.
  } else {
    // Standalone: create per-char spans, replacing text nodes.
    for (const node of textNodes) {
      const chars = Array.from(node.textContent);
      const spans = new Array(chars.length);
      const frag  = document.createDocumentFragment();
      for (let i = 0; i < chars.length; i++) {
        const span = document.createElement("span");
        span.textContent = chars[i];
        spans[i] = span;
        frag.appendChild(span);
      }
      node.parentNode.replaceChild(frag, node);
      groups.push({ originalNode: node, spans });
      for (let i = 0; i < chars.length; i++) {
        items.push({
          char:        chars[i],
          span:        spans[i],
          cx:          0,
          cy:          0,
          excitement:  0,
          isLit:       false,
          tint:        null,
        });
      }
    }
  }

  function recomputeCenters() {
    for (const it of items) {
      const r = it.span.getBoundingClientRect();
      it.cx = r.left + r.width  / 2;
      it.cy = r.top  + r.height / 2;
    }
  }
  recomputeCenters();

  /* ---------------------------------------------------------------------------
     CURSOR TRACKING + LOOP CONTROL
     ------------------------------------------------------------------------- */

  let cursorX        = -10000;
  let cursorY        = -10000;
  let cursorInside   = false;
  let rafId          = 0;
  let cancelled      = false;
  let lastTickTime   = 0;
  const colorsLen    = opts.colors.length;
  const hasColors    = colorsLen > 0;

  function activateAt(clientX, clientY) {
    cursorInside = true;
    cursorX = clientX;
    cursorY = clientY;
    recomputeCenters();
    ensureLoopRunning();
  }

  function onMouseEnter(e) {
    activateAt(e.clientX, e.clientY);
  }

  function onMouseMove(e) {
    cursorX = e.clientX;
    cursorY = e.clientY;
    if (!cursorInside) {
      activateAt(e.clientX, e.clientY);
    }
  }

  function onMouseLeave() {
    cursorInside = false;
    cursorX = -10000;
    cursorY = -10000;
  }

  rootEl.addEventListener("mouseenter", onMouseEnter);
  rootEl.addEventListener("mousemove",  onMouseMove);
  rootEl.addEventListener("mouseleave", onMouseLeave);

  /* ---------------------------------------------------------------------------
     THE LOOP
     ------------------------------------------------------------------------- */

  function ensureLoopRunning() {
    if (rafId || cancelled) return;
    lastTickTime = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  function tick(now) {
    if (cancelled) return;
    const dtMs = now - lastTickTime;
    lastTickTime = now;

    const decayMul = Math.pow(0.5, dtMs / opts.decayHalfLifeMs);
    const gaussianK = -1 / (2 * opts.waveRadius * opts.waveRadius);

    let anyActive = false;

    for (const it of items) {
      const prevExcitement = it.excitement;

      // (1) Decay.
      it.excitement *= decayMul;

      // (2) Cursor excitation.
      const dx = it.cx - cursorX;
      const dy = it.cy - cursorY;
      const distSq = dx * dx + dy * dy;
      const fromCursor = opts.peakExcitement * Math.exp(distSq * gaussianK);

      // (3) Color re-pick on rising crossing of colorRepickThreshold.
      if (hasColors
          && fromCursor >= opts.colorRepickThreshold
          && prevExcitement < opts.colorRepickThreshold) {
        it.tint = opts.colors[(Math.random() * colorsLen) | 0];
      }

      // (4) Max-combine.
      if (fromCursor > it.excitement) it.excitement = fromCursor;

      // (5) Lit state and color writes.
      //
      // Standalone mode: write only on lit/ink transitions — the inline
      // color persists between hover ticks because nothing else touches
      // it. Cheap.
      //
      // Layered mode: write every frame while lit, because the entry
      // primitive (scramble/typewriter) may have overwritten our color
      // since the last hover tick. The browser's frame-coalescing means
      // the additional writes don't cause additional paints; we're just
      // making sure hover's color is the last one applied each frame.
      const shouldBeLit = it.excitement >= opts.litThreshold && isAnimatable(it.char);
      if (shouldBeLit) {
        if (!it.isLit || isLayered) {
          if (it.tint) it.span.style.color = it.tint;
          it.isLit = true;
        }
      } else if (it.isLit) {
        // Releasing. Clear inline color. For chars where the entry
        // primitive is still actively writing (scramble cycling),
        // entry's next tick restores its color — the released char
        // shows ink for one tick at most. For post-entry chars (or
        // standalone mode), ink is the correct final state.
        it.span.style.color = "";
        it.isLit = false;
      }

      if (it.excitement >= opts.excitementThreshold) anyActive = true;
    }

    if (cursorInside || anyActive) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = 0;
    }
  }

  /* ---------------------------------------------------------------------------
     CANCEL
     ------------------------------------------------------------------------- */

  return () => {
    if (cancelled) return;
    cancelled = true;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    rootEl.removeEventListener("mouseenter", onMouseEnter);
    rootEl.removeEventListener("mousemove",  onMouseMove);
    rootEl.removeEventListener("mouseleave", onMouseLeave);

    if (isLayered) {
      // Defensive: clear any inline colors we set, in case the entry
      // primitive's cancel hasn't run yet (which would otherwise replace
      // these spans with text nodes and moot the cleanup). If entry's
      // cancel runs after ours, our color writes are on detached spans
      // and harmless; if entry's cancel never runs (unusual), the spans
      // are at least left with no hover-colored inline styles dangling.
      for (const it of items) {
        if (it.isLit) it.span.style.color = "";
      }
    } else {
      // Standalone: we own the spans, restore text nodes.
      for (const g of groups) {
        const firstSpan = g.spans[0];
        if (firstSpan && firstSpan.parentNode) {
          firstSpan.parentNode.replaceChild(g.originalNode, firstSpan);
        }
        for (let i = 1; i < g.spans.length; i++) g.spans[i].remove();
      }
    }
  };
}

/* -----------------------------------------------------------------------------
   INTERNAL HELPERS
   --------------------------------------------------------------------------- */

function isAnimatable(ch) {
  return !/\s/.test(ch);
}

/* =============================================================================
   textHoverScramble.js — cursor-driven spatial glyph scramble
   -----------------------------------------------------------------------------
   An interaction primitive — sibling to textHoverWave. Same wave dynamics
   (Gaussian falloff from cursor, exponential excitement decay, threshold-
   based snap states), different visual effect: characters near the cursor
   cycle random glyphs (with optional brand-color flicker) instead of just
   shifting color. The cursor leaves a wake of scrambling characters that
   snap back to authored text as excitement decays.

   Conceptually this is textScramble's per-character glyph cycling localized
   to the cursor's position via textHoverWave's spatial excitement model.
   Characters above the scramble threshold cycle glyphs; characters below
   show authored text.

   THE MENTAL MODEL
     Same excitement model as textHoverWave: each character has a value in
     [0, 1] that rises with cursor proximity (Gaussian falloff via
     waveRadius) and decays exponentially over time (decayHalfLifeMs).
     Above scrambleThreshold the character is "scrambled"; below it shows
     authored text. State transitions are snap, not gradual — same
     discrete-event color grammar the entry primitives use.

     What's different: instead of switching colors when scrambled, a
     character switches its DISPLAYED GLYPH to a random pick from the
     glyph pool, with optional brand-color flicker (same probability and
     pool as textScramble's colorChance). The picked glyph holds between
     glyph-tick refreshes (every randomTickMs, default ~18fps) and gets
     re-rolled on each tick. When the character drops below the threshold,
     it snaps back to authored text and clears any inline color.

     The result reads as textScramble's glyph cycling, but only where the
     cursor is — the rest of the text stays correctly authored.

   TWO MODES — STANDALONE AND LAYERED
     Same auto-detection as textHoverWave: if every text node in rootEl
     is the sole child of a <span> parent (the shape entry primitives
     produce), the primitive enters layered mode and borrows those spans;
     otherwise it creates its own.

     Mode flips two behaviors:
       1. Span ownership — layered mode doesn't restore DOM on cancel,
          just defensively restores authored characters and clears
          inline colors. Standalone restores text nodes.
       2. Per-frame writes — layered mode re-writes the cached glyph
          and color every frame for currently-scrambled characters,
          because another primitive might overwrite us between our
          ticks. Standalone writes only on state transitions and on
          glyph-tick refreshes.

   COMPOSITION CAVEAT
     Don't layer textHoverScramble on top of textScramble. Both write
     `span.textContent` AND `span.style.color`, both at ~18fps tempos.
     Neither would produce a stable visual against the other.

     Layering on top of textTypewriter is safe — typewriter sets
     textContent once on reveal and doesn't touch it after, so
     textHoverScramble's textContent writes don't fight typewriter's.
     Color writes might briefly conflict during typewriter's reveal-
     flash window, but that's a 130ms-per-char overlap, visually minor.

     Standalone usage (no entry primitive layered) is the canonical case
     — both dotsPanel and sidebarTest run textHoverScramble alone.

   IDLE BEHAVIOR
     The rAF loop runs only when there's something to animate:
       - Loop starts on mouseenter, OR on the first mousemove inside
         rootEl when the cursor was already inside at primitive start
         (see STARTING WHEN CURSOR IS ALREADY INSIDE below).
       - Loop continues each tick while ANY character has excitement
         above excitementThreshold OR while the cursor is currently
         inside the element.
       - Loop stops when both go false. No background CPU when nothing
         is happening.

   STARTING WHEN CURSOR IS ALREADY INSIDE
     Same deferred-enter fallback as textHoverWave: mouseenter only fires
     on transitions from outside to inside, so if the cursor is already
     over rootEl at primitive start (e.g., reaching it via a panel that
     appears under a stationary cursor), the first mousemove inside
     serves as an implicit enter.

   POSITION HANDLING
     Each character's center is computed from getBoundingClientRect at
     startup AND on every enter (real or deferred). Refreshing on enter
     keeps the math correct across layout shifts between hover sessions
     (e.g., scroll position changes in dotsPanel, sidebar reopen flow).
     See textHoverWave.js's file header for the bug history that motivated
     the recompute-on-enter pattern.

   USAGE
     import { startHoverScramble } from "./textHoverScramble.js";

     // Common case:
     const cancel = startHoverScramble(rootEl);

     // Customised:
     const cancel = startHoverScramble(rootEl, {
       waveRadius:     35,
       scrambleThreshold: 0.4,
       colorChance:    0,   // glyph cycling without color
     });

     // Cancel removes listeners, restores DOM (standalone) or restores
     // authored chars + clears inline colors (layered):
     cancel();

   CONCURRENCY
     Each startHoverScramble call is independent. Calling it twice on
     the same element corrupts both. Use cancels.js for exclusivity.

   PERFORMANCE
     Per character per frame: one Math.exp (Gaussian), one max, one decay
     multiply, occasional textContent + style.color writes. textContent
     writes are slightly heavier than style writes but still cheap at
     these volumes (~5-10 scrambled chars at default settings).

     Position recomputation on enter is ~150 getBoundingClientRect reads,
     batched into one layout flush. 1-3ms total, amortized over a hover
     session is negligible.
   ========================================================================== */

/* -----------------------------------------------------------------------------
   DEFAULTS
   --------------------------------------------------------------------------- */

const DEFAULTS = {
  // Wave dynamics (mirroring textHoverWave)
  waveRadius: 35,
  scrambleThreshold: 0.3,
  peakExcitement: 1.0,
  decayHalfLifeMs: 300,
  excitementThreshold: 0.02,

  // Glyph cycling (mirroring textScramble)
  glyphs: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#/.",
  randomTickMs: 55,
  colorChance: 0.10,
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

export function startHoverScramble(rootEl, options = {}) {
  const opts = { ...DEFAULTS, ...options };

  // Collect text nodes via TreeWalker. Same first-collect-then-mutate
  // pattern as the other primitives — mutating during walk invalidates
  // the walker.
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) {
    if (n.textContent) textNodes.push(n);
  }
  if (textNodes.length === 0) return () => {};

  // Mode detection — same heuristic as textHoverWave. If every text
  // node is the sole child of a span parent, an entry primitive ran
  // first and produced this DOM shape; we borrow.
  const isLayered = textNodes.every((t) => {
    const p = t.parentNode;
    return p
        && p.nodeName === "SPAN"
        && p.childNodes.length === 1
        && p.firstChild === t;
  });

  const groups = []; // only populated in standalone mode
  const items  = []; // flat list, one per character

  if (isLayered) {
    for (const t of textNodes) {
      const span = t.parentNode;
      items.push({
        char:          t.textContent,
        span,
        cx:            0,
        cy:            0,
        excitement:    0,
        isScrambled:   false,
        // Cached display state — used in layered mode to re-apply every
        // frame, and in standalone mode to skip re-picks between glyph
        // ticks. Initialized to authored values so a not-yet-scrambled
        // char's cached state matches what's in the DOM.
        currentGlyph:  t.textContent,
        currentColor:  "",
      });
    }
  } else {
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
          char:          chars[i],
          span:          spans[i],
          cx:            0,
          cy:            0,
          excitement:    0,
          isScrambled:   false,
          currentGlyph:  chars[i],
          currentColor:  "",
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
  let nextRandomTick = 0;
  const glyphsLen    = opts.glyphs.length;
  const colorsLen    = opts.colors.length;
  const hasColors    = colorsLen > 0 && opts.colorChance > 0;
  const hasGlyphs    = glyphsLen > 0;

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
     GLYPH + COLOR PICKING
     -------------------------------------------------------------------------
     Two helpers: one to re-roll the cached glyph and color for a scrambled
     char (called on state transitions and on glyph-tick refreshes), and
     one to push the cached values into the DOM (called every time we
     want the displayed state to match the cached state).
     ------------------------------------------------------------------- */

  function rollScrambledState(it) {
    if (hasGlyphs) {
      it.currentGlyph = opts.glyphs[(Math.random() * glyphsLen) | 0];
    }
    if (hasColors && Math.random() < opts.colorChance) {
      it.currentColor = opts.colors[(Math.random() * colorsLen) | 0];
    } else {
      it.currentColor = "";
    }
  }

  function applyScrambledState(it) {
    it.span.textContent = it.currentGlyph;
    it.span.style.color = it.currentColor;
  }

  function applyAuthoredState(it) {
    it.span.textContent = it.char;
    it.span.style.color = "";
    it.currentGlyph = it.char;
    it.currentColor = "";
  }

  /* ---------------------------------------------------------------------------
     THE LOOP
     ------------------------------------------------------------------------- */

  function ensureLoopRunning() {
    if (rafId || cancelled) return;
    lastTickTime = performance.now();
    // First glyph tick fires immediately on loop start, so a char that
    // becomes scrambled on the same frame the loop starts gets a fresh
    // glyph rather than waiting up to randomTickMs.
    nextRandomTick = lastTickTime;
    rafId = requestAnimationFrame(tick);
  }

  function tick(now) {
    if (cancelled) return;
    const dtMs = now - lastTickTime;
    lastTickTime = now;

    const decayMul = Math.pow(0.5, dtMs / opts.decayHalfLifeMs);
    const gaussianK = -1 / (2 * opts.waveRadius * opts.waveRadius);

    // Throttled glyph tick — fires roughly every randomTickMs (~18fps
    // at default 55ms). Scrambled chars re-roll their glyph + color on
    // these ticks. Between ticks, their cached state holds. Cross-
    // character cycles are synced (all scrambled chars re-roll on the
    // same tick) — matches textScramble's rhythm.
    const glyphTickFired = now >= nextRandomTick;
    if (glyphTickFired) nextRandomTick = now + opts.randomTickMs;

    let anyActive = false;

    for (const it of items) {
      // Decay
      it.excitement *= decayMul;

      // Cursor excitation
      const dx = it.cx - cursorX;
      const dy = it.cy - cursorY;
      const distSq = dx * dx + dy * dy;
      const fromCursor = opts.peakExcitement * Math.exp(distSq * gaussianK);

      // Max-combine
      if (fromCursor > it.excitement) it.excitement = fromCursor;

      const shouldBeScrambled = it.excitement >= opts.scrambleThreshold && isAnimatable(it.char);

      // State transitions and display updates. Four cases:
      //   1. Becoming scrambled: roll fresh glyph + color, apply.
      //   2. Becoming authored: clear cached state, apply authored.
      //   3. Staying scrambled, glyph tick fired: re-roll, apply.
      //   4. Staying scrambled, no glyph tick:
      //        - Layered mode: re-apply cached state to win against
      //          any other primitive that may have overwritten our
      //          writes since our last tick.
      //        - Standalone mode: do nothing; cached state persists
      //          in the DOM from our last write.
      if (shouldBeScrambled !== it.isScrambled) {
        it.isScrambled = shouldBeScrambled;
        if (shouldBeScrambled) {
          rollScrambledState(it);
          applyScrambledState(it);
        } else {
          applyAuthoredState(it);
        }
      } else if (it.isScrambled) {
        if (glyphTickFired) {
          rollScrambledState(it);
          applyScrambledState(it);
        } else if (isLayered) {
          applyScrambledState(it);
        }
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
      // Defensive cleanup. Restore any currently-scrambled chars to
      // their authored state. The owning primitive (if any) will clean
      // up its own writes via its own cancel; we don't touch text
      // nodes (we don't own them).
      for (const it of items) {
        if (it.isScrambled) {
          it.span.textContent = it.char;
          it.span.style.color = "";
        }
      }
    } else {
      // Standalone: restore text nodes.
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
  // Whitespace isn't scrambled — same convention as the other primitives.
  // Scrambling a space into a visible glyph would shift the visible word
  // boundaries, which reads as broken layout rather than as a hover
  // effect.
  return !/\s/.test(ch);
}

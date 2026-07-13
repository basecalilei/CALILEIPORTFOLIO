/* =============================================================================
   textSplitPrint.js — cursor-driven multi-color text-shadow split-print
   -----------------------------------------------------------------------------
   An interaction primitive — sibling to textHoverWave and textHoverScramble.
   Same wave dynamics (Gaussian falloff from cursor, exponential excitement
   decay, threshold-based snap states), different visual register: characters
   near the cursor wear multiple offset colored "plate" copies via CSS
   text-shadow, like a print misregistration or anaglyph 3D effect. Snap on
   when excitement crosses litThreshold, snap off when it decays.

   The base character stays in ink at all times. The "lit" treatment adds
   shadow copies in different brand colors offset slightly from the
   character's position. Multiple brand colors visible per character
   simultaneously — denser color expression than textHoverWave (one color
   per lit char) or textHoverScramble (one color per char per random tick).

   THE MENTAL MODEL
     Same excitement model as the other interaction primitives: each
     character has a value in [0, 1] that rises with cursor proximity
     (Gaussian falloff via waveRadius) and decays exponentially over
     time (decayHalfLifeMs). Above litThreshold the character is "lit";
     below it shows clean ink. State transitions are snap.

     When a character becomes lit, it picks a fresh shadow recipe:
       - shadowCount colors are picked from the `colors` pool via
         Fisher-Yates shuffle — random subset, no repeats within one
         character's recipe.
       - Each color gets an offset (dx, dy) evenly distributed around
         a circle of radius offsetMagnitude. For shadowCount=3, the
         three colors splay at 120° intervals; for shadowCount=2,
         pure horizontal left/right (anaglyph-style); for shadowCount=4,
         a diamond pattern.
       - The recipe is committed as a single inline style.textShadow
         string and held for as long as the character is lit. On
         falling edge, the inline text-shadow is cleared.

     Visual: print plate misregistration. Each lit character is the
     original ink glyph plus N slightly-offset colored ghosts.

   ON RHYTHM (LACK OF IT)
     Unlike textHoverScramble's randomTickMs glyph cycling, this primitive
     has no internal rhythm — once a character is lit, its shadow recipe
     is stable until it un-lits. The snappy on/off provides all the
     motion; the stability between events is part of the print-like
     character. If you want the shadows to cycle while lit (a kind of
     "color vibration"), that's a different primitive.

   PROPERTY ISOLATION (a feature worth understanding)
     This primitive writes ONLY to `style.textShadow`. It never touches
     `style.color` or `textContent`. Consequence: it composes cleanly
     with any entry primitive — textScramble's color flicker, typewriter's
     reveal flashes, etc. — without any property conflict. No tick-
     ordering needed to resolve color writes (none compete), no per-
     frame defensive writes needed in layered mode (nothing else in
     the project writes to text-shadow).

     This is different from textHoverWave/textHoverScramble, which BOTH
     write to style.color and need tick ordering + per-frame writes in
     layered mode to "win" the color fight against entry primitives.
     textSplitPrint sidesteps that entire mechanism by using an
     independent property.

   TWO MODES — STANDALONE AND LAYERED
     Same auto-detection as the other interaction primitives:
       - If every text node in rootEl is the sole child of a <span>
         parent (the DOM shape entry primitives produce), enter layered
         mode and borrow those spans. Cancel doesn't restore DOM; it
         only clears any inline text-shadow we set.
       - Otherwise standalone — create spans, restore text nodes on
         cancel.

     Because of property isolation (see above), layered mode here doesn't
     need per-frame writes. Pure transition-based behavior in both modes.

   IDLE BEHAVIOR
     Same as the other interaction primitives. The rAF loop runs only
     while there's something to animate (cursor inside element OR any
     character has lingering excitement); idles when both go false.

   STARTING WHEN CURSOR IS ALREADY INSIDE
     Same deferred-enter fallback as textHoverWave/textHoverScramble:
     the first mousemove inside rootEl serves as an implicit enter if
     mouseenter didn't fire (cursor was already inside at primitive
     start).

   POSITION HANDLING
     Same getBoundingClientRect strategy as the other interaction
     primitives. Centers computed at startup AND on every enter (real
     or deferred). See textHoverWave.js's file header for the layout-
     shift bug history that motivated the recompute-on-enter pattern.

   USAGE
     import { startSplitPrint } from "./textSplitPrint.js";

     // Common case (3 colors, 2px offset, full brand palette):
     const cancel = startSplitPrint(rootEl);

     // Pure anaglyph (red+cyan, horizontal split):
     const cancel = startSplitPrint(rootEl, {
       shadowCount: 2,
       offsetMagnitude: 1.5,
       colors: ["#ff0000", "#00ffff"],
     });

     // Tighter wake (smaller radius, faster decay):
     const cancel = startSplitPrint(rootEl, {
       waveRadius: 25,
       decayHalfLifeMs: 150,
     });

     // Maximum splay (all four colors, larger offset):
     const cancel = startSplitPrint(rootEl, {
       shadowCount: 4,
       offsetMagnitude: 3,
     });

     cancel();

   CONCURRENCY
     Each call is independent. Calling twice on the same element corrupts
     both. Use cancels.js for exclusivity. Composes safely with any
     entry primitive (different property write surface — see PROPERTY
     ISOLATION above).

   PERFORMANCE
     style.textShadow writes are cheap. text-shadow is composited by
     the GPU layer, no layout impact, no reflow. The recipe string is
     built once per rising-edge lit transition (Fisher-Yates shuffle +
     N precomputed offsets), written once on transition. No per-frame
     writes — orders of magnitude cheaper than the textContent-rewriting
     primitives like textHoverScramble.
   ========================================================================== */

/* -----------------------------------------------------------------------------
   DEFAULTS
   --------------------------------------------------------------------------- */

const DEFAULTS = {
  // Wave dynamics
  waveRadius: 35,
  litThreshold: 0.3,
  peakExcitement: 1.0,

  // Slightly shorter decay than textHoverWave/textHoverScramble (300ms).
  // The print misregistration metaphor reads cleaner with a snappier
  // wake — alignment either is or isn't, not gradually settling. Override
  // toward 300+ for a more wake-like feel.
  decayHalfLifeMs: 200,

  excitementThreshold: 0.02,

  // Split-print specifics
  shadowCount: 3,        // number of colored shadow copies per lit char
  offsetMagnitude: 2,    // radial distance of shadows from char center, in px
  blur: 0,               // shadow blur radius (0 = sharp print plates)

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

export function startSplitPrint(rootEl, options = {}) {
  const opts = { ...DEFAULTS, ...options };

  // Collect text nodes.
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) {
    if (n.textContent) textNodes.push(n);
  }
  if (textNodes.length === 0) return () => {};

  // Mode detection — same heuristic as textHoverWave/textHoverScramble.
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
      items.push({
        char:       t.textContent,
        span:       t.parentNode,
        cx:         0,
        cy:         0,
        excitement: 0,
        isLit:      false,
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
          char:       chars[i],
          span:       spans[i],
          cx:         0,
          cy:         0,
          excitement: 0,
          isLit:      false,
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
     SHADOW RECIPE
     -------------------------------------------------------------------------
     Offsets are evenly distributed around a circle, fixed for the primitive's
     lifetime (shadowCount doesn't change). Colors are shuffled per lit
     transition via Fisher-Yates, so each lit character gets a random
     subset+ordering of the pool. The final text-shadow string is built
     fresh for each lit transition.
     ------------------------------------------------------------------- */

  const shadowOffsets = computeShadowOffsets(opts.shadowCount, opts.offsetMagnitude);

  function pickShadowRecipe() {
    if (opts.colors.length === 0) return "";

    // Fisher-Yates shuffle of the colors array. Allocates a fresh copy
    // so we don't mutate the caller's options.colors.
    const shuffled = opts.colors.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Take the first shadowCount colors (or fewer if the pool is smaller
    // than shadowCount), pair each with its corresponding offset.
    const n = Math.min(opts.shadowCount, shuffled.length);
    const parts = new Array(n);
    for (let i = 0; i < n; i++) {
      const off = shadowOffsets[i];
      parts[i] = `${off.dx}px ${off.dy}px ${opts.blur}px ${shuffled[i]}`;
    }
    return parts.join(", ");
  }

  /* ---------------------------------------------------------------------------
     CURSOR TRACKING + LOOP CONTROL
     ------------------------------------------------------------------------- */

  let cursorX      = -10000;
  let cursorY      = -10000;
  let cursorInside = false;
  let rafId        = 0;
  let cancelled    = false;
  let lastTickTime = 0;

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
      // Decay
      it.excitement *= decayMul;

      // Cursor excitation
      const dx = it.cx - cursorX;
      const dy = it.cy - cursorY;
      const distSq = dx * dx + dy * dy;
      const fromCursor = opts.peakExcitement * Math.exp(distSq * gaussianK);
      if (fromCursor > it.excitement) it.excitement = fromCursor;

      // Lit state transitions. Pure transition-based writes — text-shadow
      // stays stable between transitions because nothing else in the
      // project writes to it. Fresh recipe picked on each rising edge.
      const shouldBeLit = it.excitement >= opts.litThreshold && isAnimatable(it.char);
      if (shouldBeLit !== it.isLit) {
        it.isLit = shouldBeLit;
        if (shouldBeLit) {
          it.span.style.textShadow = pickShadowRecipe();
        } else {
          it.span.style.textShadow = "";
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
      // Defensive cleanup. Clear any inline text-shadow we set; leave
      // spans alone (we don't own them in layered mode).
      for (const it of items) {
        if (it.isLit) it.span.style.textShadow = "";
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

function computeShadowOffsets(count, magnitude) {
  // Evenly distribute `count` points around a circle of radius `magnitude`,
  // starting at 0° (pure right) and going counterclockwise.
  //
  //   count=2: (m, 0), (-m, 0)              — horizontal anaglyph
  //   count=3: (m, 0), (-m/2, m√3/2), (-m/2, -m√3/2)  — Y-shape splay
  //   count=4: (m, 0), (0, m), (-m, 0), (0, -m)        — diamond
  //
  // Values rounded to 2 decimal places — sufficient precision for sub-
  // pixel shadow positioning, prevents floating-point string bloat in
  // the inline style.
  const offsets = new Array(count);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    offsets[i] = {
      dx: Math.round(Math.cos(angle) * magnitude * 100) / 100,
      dy: Math.round(Math.sin(angle) * magnitude * 100) / 100,
    };
  }
  return offsets;
}

function isAnimatable(ch) {
  // Whitespace doesn't get the shadow treatment. A text-shadow on a
  // space character is technically valid but produces ghost rectangles
  // floating in the gap between words — uniformly bad-looking.
  return !/\s/.test(ch);
}

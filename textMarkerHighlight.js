/* =============================================================================
   textMarkerHighlight.js — cursor-driven background-color highlight
   -----------------------------------------------------------------------------
   An interaction primitive — sibling to textHoverWave, textHoverScramble,
   and textSplitPrint. Same wave dynamics (Gaussian falloff from cursor,
   exponential excitement decay, threshold-based snap states), different
   visual register: characters near the cursor wear a solid brand-color
   background block, like a highlighter pen passing over the text. Snap on
   when excitement crosses litThreshold, snap off when it decays.

   Each lit character picks a random color from the pool on its rising-edge
   lit transition and holds that color until it snaps off. Adjacent lit
   characters form a continuous colored band (their inline backgrounds
   touch); non-adjacent lit characters are separate colored blocks. The
   cursor's wake is a "highlighted strip" of varied colors following its
   motion across the text.

   THE MENTAL MODEL
     Same excitement model as the other interaction primitives: each
     character has a value in [0, 1] that rises with cursor proximity
     (Gaussian falloff via waveRadius) and decays exponentially over
     time (decayHalfLifeMs). Above litThreshold the character is "lit";
     below it shows clean (no background). State transitions are snap.

     When a character becomes lit, it picks one color randomly from
     the `colors` pool and writes it as inline style.backgroundColor.
     The color is committed for as long as the character is lit; on
     falling edge, the inline background is cleared.

     Visual: highlighter pen drawn over the text by the cursor's motion.
     Characters in the cursor's wake show stable color blocks; characters
     outside the wake show no background.

   ON RHYTHM (LACK OF IT, INTENTIONALLY)
     Unlike textHoverScramble's randomTickMs glyph cycling, this primitive
     has no internal rhythm — once a character is lit, its background
     color is stable until it un-lits. The snappy on/off provides the
     motion; the stability between events matches the marker metaphor
     (a highlighter doesn't change ink mid-stroke). If you want the
     colors to shift while lit, that's a different primitive — or, more
     cheaply, the cycling behavior could be added here later as an
     opt-in `cycleColors` option without changing the default feel.

   PROPERTY ISOLATION
     This primitive writes ONLY to `style.backgroundColor`. It never
     touches `style.color`, `style.textShadow`, or `textContent`.
     Consequence: it composes cleanly with any entry primitive (no
     property conflict) AND with the other interaction primitives that
     write disjoint properties:
       - textHoverWave writes style.color
       - textSplitPrint writes style.textShadow
       - textMarkerHighlight writes style.backgroundColor
       - (entry primitives write color, textContent, and visibility)
     So marker + hoverWave on the same element would coherently produce
     "chars near cursor get both a background and a text color" — both
     primitives write disjoint surfaces, no tick ordering needed.

   ON LINE-HEIGHT
     The visible height of each highlight block is determined by the
     parent's CSS line-height, not by this primitive. Tight line-height
     (1.05 or so, as in display headings) produces bands that hug the
     character cap height. Generous line-height (1.6 or so, as in body
     copy) produces taller bands with breathing room above and below.
     Both look fine but they're meaningfully different visual feels;
     if the bands feel too chunky, tighten the line-height on the host.

   TWO MODES — STANDALONE AND LAYERED
     Same auto-detection as the other interaction primitives:
       - If every text node in rootEl is the sole child of a <span>
         parent, enter layered mode and borrow those spans. Cancel
         doesn't restore DOM; it only clears any inline background-
         colors we set.
       - Otherwise standalone — create spans, restore text nodes on
         cancel.

     Because of property isolation (see above), layered mode here doesn't
     need per-frame defensive writes. Pure transition-based behavior in
     both modes.

   IDLE BEHAVIOR
     Same as the other interaction primitives. The rAF loop runs only
     while there's something to animate; idles when both the cursor is
     outside the element AND no character has lingering excitement.

   STARTING WHEN CURSOR IS ALREADY INSIDE
     Same deferred-enter fallback as the rest of the family.

   POSITION HANDLING
     Same getBoundingClientRect strategy as the other interaction
     primitives. See textHoverWave.js's file header for the layout-shift
     bug history that motivated the recompute-on-enter pattern.

   USAGE
     import { startMarkerHighlight } from "./textMarkerHighlight.js";

     // Common case:
     const cancel = startMarkerHighlight(rootEl);

     // Tighter wake (focal highlight, faster snap-off):
     const cancel = startMarkerHighlight(rootEl, {
       waveRadius: 25,
       decayHalfLifeMs: 150,
     });

     // Single-color highlighter (no random palette):
     const cancel = startMarkerHighlight(rootEl, {
       colors: ["var(--brand-yellow)"],
     });

     cancel();

   CONCURRENCY
     Each call is independent. Calling twice on the same element corrupts
     both. Use cancels.js for exclusivity. Composes safely with any entry
     primitive and with the other interaction primitives (different
     property write surfaces — see PROPERTY ISOLATION above).

   PERFORMANCE
     style.backgroundColor writes are cheap and don't trigger layout. The
     color is picked once per rising-edge lit transition (one Math.random
     + array lookup), written once on transition. No per-frame writes —
     cheapest of the four interaction primitives.
   ========================================================================== */

/* -----------------------------------------------------------------------------
   DEFAULTS
   --------------------------------------------------------------------------- */

const DEFAULTS = {
  // Wave dynamics
  waveRadius: 35,
  litThreshold: 0.3,
  peakExcitement: 1.0,

  // Snappier than textHoverWave/textHoverScramble's 300ms — matches
  // textSplitPrint and the general "snappy, no fading" feel. Highlighter
  // mark either is or isn't; gradual fade-off would weaken the metaphor.
  decayHalfLifeMs: 200,

  excitementThreshold: 0.02,

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

export function startMarkerHighlight(rootEl, options = {}) {
  const opts = { ...DEFAULTS, ...options };

  // Collect text nodes.
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) {
    if (n.textContent) textNodes.push(n);
  }
  if (textNodes.length === 0) return () => {};

  // Mode detection — same heuristic as the rest of the family.
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

  const colorsLen = opts.colors.length;
  const hasColors = colorsLen > 0;

  function pickColor() {
    if (!hasColors) return "";
    return opts.colors[(Math.random() * colorsLen) | 0];
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

      // Lit state transitions. Pure transition-based writes — background-
      // color stays stable between transitions because nothing else
      // writes this property.
      const shouldBeLit = it.excitement >= opts.litThreshold && isAnimatable(it.char);
      if (shouldBeLit !== it.isLit) {
        it.isLit = shouldBeLit;
        if (shouldBeLit) {
          it.span.style.backgroundColor = pickColor();
        } else {
          it.span.style.backgroundColor = "";
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
      // Defensive cleanup. Clear any inline backgrounds we set; leave
      // spans alone (we don't own them in layered mode).
      for (const it of items) {
        if (it.isLit) it.span.style.backgroundColor = "";
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
  // Whitespace doesn't get the highlight treatment. A background color
  // on a space character produces a colored gap between words — reads
  // as accidental rather than intentional, and breaks the continuous-
  // band behavior for adjacent lit non-space characters.
  return !/\s/.test(ch);
}

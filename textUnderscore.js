/* =============================================================================
   textUnderscore.js — cursor-driven brand-color underline
   -----------------------------------------------------------------------------
   An interaction primitive — sibling to textHoverWave, textHoverScramble,
   textSplitPrint, textMarkerHighlight, and textFlashTrail. Same wave
   dynamics (Gaussian falloff from cursor, exponential excitement decay,
   threshold-based snap states), different visual register: characters
   near the cursor get a brand-color underline beneath them, snapping
   on when excitement crosses litThreshold and snapping off when it
   decays below.

   The base character stays in ink. The "lit" treatment adds a colored
   horizontal line beneath the character's baseline via CSS
   `text-decoration: underline`. Reads as data-terminal text selection
   or as a cursor laying down a colored trace beneath the text.

   Designed specifically for dotsPanel's use case — restrained enough
   to coexist with dotsScene's particle field behind/under the panel
   without visually competing. The line under the text doesn't add
   visual mass the way background colors or shadow ghosts would.

   THE MENTAL MODEL
     Same excitement model as the other field-driven interaction
     primitives: each character has a value in [0, 1] that rises with
     cursor proximity (Gaussian falloff via waveRadius) and decays
     exponentially over time (decayHalfLifeMs). Above litThreshold the
     character shows its underline; below, it shows clean. State
     transitions are snap.

     When a character becomes lit, it picks one color randomly from
     the `colors` pool and writes the underline as a single
     text-decoration shorthand: `underline <color> <thickness>px`.
     The decoration is committed for as long as the character is lit;
     on the falling edge, the inline text-decoration is cleared.

     Visual: brand-color underline appearing under chars near the
     cursor, varied colors between adjacent lit chars (random palette
     pick per transition). Adjacent lit chars naturally form a
     continuous colored line; the per-char palette choice means a
     run of three or four lit chars can show two or three different
     underline colors abutting each other.

   ON CHOICE OF PROPERTY: TEXT-DECORATION VS BORDER-BOTTOM
     This primitive uses CSS `text-decoration: underline` with color
     and thickness via the shorthand. Two alternatives were considered:

       border-bottom — works on block and inline-block elements but
         renders inconsistently on `display: inline` spans. Making it
         work would require the same inline-block transformation that
         broke textInertia (whitespace collapse, no soft-wrap
         opportunities between inline-block boxes). Unworkable for
         any multi-line text.

       a pseudo-element line — would offer pixel-perfect control
         over the line's appearance and position, but requires a
         stylesheet (a CSS rule for the ::after content), violating
         the family's "primitives author no stylesheet" convention.

     text-decoration is the semantically-correct choice for "underline
     this text," works natively on inline elements with no display
     change, and lets us write a single property per transition (the
     shorthand bundles line, color, and thickness into one string).

   PROPERTY ISOLATION
     This primitive writes ONLY to `style.textDecoration`. No conflict
     with anything else in the family — color, textContent, textShadow,
     backgroundColor, transform, and position are all untouched.
     Composes cleanly with any other primitive (entry or interaction)
     without coordination needed.

   TWO MODES — STANDALONE AND LAYERED
     Same auto-detection as the rest of the family. Standalone creates
     spans and restores text nodes on cancel; layered borrows spans
     and does defensive cleanup (clear any inline text-decoration we
     set on lit chars).

     Because no other primitive in the family writes text-decoration,
     this primitive uses pure transition-based writes in both modes —
     no per-frame defensive re-writes needed in layered mode. This is
     the simplest primitive in the family for that reason.

   IDLE BEHAVIOR
     The rAF loop runs only while there's something to animate (cursor
     inside element OR any character has lingering excitement above
     excitementThreshold); idles when both go false. Stationary cursor
     with all chars settled → loop stops.

   STARTING WHEN CURSOR IS ALREADY INSIDE
     Same deferred-enter fallback as the rest of the family. The first
     mousemove inside rootEl after listeners attach activates the loop
     if mouseenter didn't fire (which it doesn't if the cursor was
     already inside the element when the primitive started).

   POSITION HANDLING
     Same getBoundingClientRect strategy. Centers are recomputed on
     each cursor enter, capturing any layout changes that happened
     while the loop was idle.

   USAGE
     import { startUnderscore } from "./textUnderscore.js";

     // Common case:
     const cancel = startUnderscore(rootEl);

     // Thicker underline (for larger text):
     const cancel = startUnderscore(rootEl, {
       thickness: 4,
     });

     // Single-color underline (no random palette):
     const cancel = startUnderscore(rootEl, {
       colors: ["var(--brand-red)"],
     });

     // Tighter wake:
     const cancel = startUnderscore(rootEl, {
       waveRadius: 30,
       decayHalfLifeMs: 150,
     });

     cancel();

   CONCURRENCY
     Each call is independent. Calling twice on the same element
     corrupts both. Use cancels.js for exclusivity.

   PERFORMANCE
     text-decoration writes are cheap. The decoration shorthand is
     built once per rising-edge lit transition, written once. No
     per-frame writes — among the cheapest of the interaction
     primitives. Per character per frame the cost is: one Math.exp
     (Gaussian proximity), the decay multiplication, a comparison,
     and a DOM write only on state transitions (which for a moving
     cursor happens maybe once per few hundred frames per char).
   ========================================================================== */

/* -----------------------------------------------------------------------------
   DEFAULTS
   --------------------------------------------------------------------------- */

const DEFAULTS = {
  // Spatial dynamics
  waveRadius: 35,

  // State threshold — above this excitement value, the char is "lit"
  // and shows its underline. Below, the underline is cleared.
  litThreshold: 0.3,

  // Peak excitement at zero distance. Always 1.0 in current tuning;
  // could be raised to extend the lit zone further from cursor center
  // (since litThreshold becomes a smaller fraction of peak).
  peakExcitement: 1.0,

  // Time for excitement to halve (in ms). 200ms = snappy decay; lit
  // chars clear quickly behind cursor sweep. Lower for snappier,
  // higher for longer trailing wake.
  decayHalfLifeMs: 200,

  // Excitement value below which we consider the char "at rest" for
  // loop termination purposes. With peak=1 and halfLife=200ms,
  // excitement of 0.02 means the char would need ~1.13 seconds
  // without re-excitation to fall this low. So loop continues for
  // ~1 second after cursor leaves before idling.
  excitementThreshold: 0.02,

  // Underline thickness in pixels. 2px is visible on body copy
  // without dominating; raise for larger text.
  thickness: 2,

  // Color pool. Each lit transition picks one at random.
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

export function startUnderscore(rootEl, options = {}) {
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

  /* ---------------------------------------------------------------------------
     COLOR PICKING
     ------------------------------------------------------------------------- */

  const colorsLen = opts.colors.length;
  const hasColors = colorsLen > 0;

  function pickDecoration() {
    // Build the text-decoration shorthand: line, color, thickness.
    // Random color from the pool per lit transition. If colors is
    // empty, fall back to plain underline (browser default color,
    // which inherits from text color).
    if (!hasColors) return `underline ${opts.thickness}px`;
    const color = opts.colors[(Math.random() * colorsLen) | 0];
    return `underline ${color} ${opts.thickness}px`;
  }

  /* ---------------------------------------------------------------------------
     CURSOR TRACKING
     ------------------------------------------------------------------------- */

  let cursorX        = -10000;
  let cursorY        = -10000;
  let cursorInside   = false;
  let rafId          = 0;
  let cancelled      = false;
  let lastTickTime   = 0;

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
      // Decay existing excitement.
      it.excitement *= decayMul;

      // Add proximity contribution (cursor's pull).
      const dx = it.cx - cursorX;
      const dy = it.cy - cursorY;
      const distSq = dx * dx + dy * dy;
      const fromCursor = opts.peakExcitement * Math.exp(distSq * gaussianK);
      if (fromCursor > it.excitement) it.excitement = fromCursor;

      // State transition — snap lit/unlit on threshold crossing.
      // isAnimatable gate prevents whitespace from showing an
      // underline (which would render visibly under spaces and
      // look like a stray dash).
      const shouldBeLit = it.excitement >= opts.litThreshold && isAnimatable(it.char);
      if (shouldBeLit !== it.isLit) {
        it.isLit = shouldBeLit;
        if (shouldBeLit) {
          it.span.style.textDecoration = pickDecoration();
        } else {
          it.span.style.textDecoration = "";
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
      // Defensive cleanup: clear any inline text-decoration we set.
      // Only currently-lit chars have a non-empty inline value, but
      // clearing all is cheap and avoids tracking which chars we
      // touched.
      for (const it of items) {
        it.span.style.textDecoration = "";
      }
    } else {
      // Standalone: restore text nodes (which also drops all the
      // inline styles we set, since the spans are removed entirely).
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
  // Whitespace excluded — an underline beneath a space would render
  // as a stray colored dash floating between words. Visually noisy
  // and not what the primitive is trying to communicate.
  return !/\s/.test(ch);
}

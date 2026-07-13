/* =============================================================================
   textTypewriter.js — per-character sequential reveal with organic timing
   -----------------------------------------------------------------------------
   Sibling to textScramble and textFocus. Reveals characters one at a time
   in document order — but the timing between reveals is not constant. The
   per-character delay combines a smooth drift (sum of two sines), word-
   boundary and punctuation effects, and occasional micro-hesitations to
   produce a rhythm that reads as "human typing" rather than "constant
   stream from a printf loop."

   Color is expressed through two complementary mechanisms that activate
   at different moments in the typing cycle:

     - REVEAL FLASH (during typing): a fraction of characters land in a
       brand color at the moment of reveal, HOLD that color for
       flashDurationMs, then snap to ink. No fade — each flash is a
       discrete event rather than a decaying glow.

     - PAUSE CURSOR (between typing): when the delay to the next character
       exceeds pauseCursorThresholdMs (commas, sentence breaks), a small
       vertical bar appears after the last-revealed character and cycles
       through the brand palette until the next character reveals.

   The two mechanisms are temporally complementary — one is active during
   typing, the other during pauses — so they never compete for the same
   visual surface. Color is continuously expressed somewhere on the active
   region of the text, but its form changes based on whether the typist
   is mid-burst or mid-thought.

   USAGE
     import { startTypewriter } from "./textTypewriter.js";

     // Common case — defaults tuned for sidebar-view-sized content:
     const cancel = startTypewriter(rootEl);

     // Customised — any subset of options overrides the defaults:
     const cancel = startTypewriter(rootEl, {
       baseDelayMax:       80,
       flashChance:        0.20,
       pauseCursorCycleMs: 250,
     });

     // Sequenced — onComplete fires once at natural completion (all
     // characters revealed AND the last flash cleared). Never called on
     // cancel. If the root has no typeable text, completion is immediate
     // and fires on the next animation frame:
     const cancel = startTypewriter(rootEl, {
       onComplete: () => revealNextPiece(),
     });

     // Always-callable cancel — stops the animation and restores DOM:
     cancel();

   DOM EFFECT
     Identical contract to the other primitives in this category: rootEl's
     text nodes are detached and replaced with per-character <span>s while
     the animation runs; the cancel function (or natural completion +
     cancel) restores the original text nodes synchronously. DOM is never
     left in a partial state.

     Each span starts with `visibility: hidden`; on its reveal time, the
     inline visibility is cleared so the span inherits `visible` from the
     cascade. Layout is preserved from t=0 — the line takes its final
     shape immediately, characters reveal into pre-allocated positions.
     No reflow on reveal, no layout shift as text appears.

     ONE SIDE EFFECT ON THE INPUT ELEMENT: when pause cursor is enabled,
     the primitive needs rootEl to be a positioned ancestor for the
     absolutely-positioned cursor to anchor against. If rootEl's computed
     position is `static`, the primitive sets it to `relative` and
     restores the original inline value on cancel. If you don't want
     this side effect (e.g., the caller already manages rootEl's
     positioning), set `pauseCursorEnabled: false` and the cursor isn't
     created.

     Returns a cancel function regardless of whether the root had any
     typeable text. Calling it when there's nothing to clean up is a safe
     no-op.

   CONCURRENCY
     Each startTypewriter call is independent — no shared registry.
     Calling startTypewriter while a previous one is in flight on the
     same element corrupts both (the second call walks spans expecting
     text nodes). Callers needing exclusivity track their own cancel
     handles — see cancels.js / createCancelGroup.

   THE TIMING MODEL — what makes this feel "organic"
     For each character at index i, the delay before it appears combines
     four sources:

     1. A base delay derived from text length and clamped between
        baseDelayMin and baseDelayMax. Short text gets the slow-end
        clamp (a comfortable ~110ms/char, reads as a competent human
        typist); long text gets the fast-end clamp (~25ms/char burst
        speed, because at human rates a 200-char body would run for
        20+ seconds).

     2. A smooth drift from a sum of two sines at incommensurate
        frequencies (0.7 and 1.3 per index, plus random phases per
        call). The sum creates both a slow burst-and-lull oscillation
        and a fast per-character drift. Random phases per call mean
        every entry feels rhythmically distinct.

     3. Punctuation effects. After a space: delay multiplied by
        spaceFactor (word-boundary micro-pause). After a comma /
        semicolon / colon: additive commaPauseMs beat. After a period
        / exclamation / question: longer additive sentencePauseMs
        breath.

     4. Occasional "stumbles" — with probability stumbleChance, the
        delay is multiplied by stumbleFactor. Rare enough to register
        as life, not as broken pacing.

   THE COLOR MODEL — what makes the typing feel alive
     The two mechanisms divide the animation's temporal surface:

     During typing (between reveals), color appears as REVEAL FLASHES.
     On each char's reveal time, roll flashChance. On hit, set the span's
     inline color to a randomly picked brand color and hold it. The tick
     loop watches active flashes; when a flash's elapsed time exceeds
     flashDurationMs, the inline color is cleared (span inherits ink
     from cascade) — the color SNAPS to ink rather than fading. Each
     flash is a discrete event, perceived as "that character lit up,"
     not "color is decaying behind the head."

     During pauses (gap to next reveal > pauseCursorThresholdMs), color
     appears as the PAUSE CURSOR. A single absolutely-positioned <span>
     child of rootEl is positioned at the right edge of the last-revealed
     character. It cycles sequentially through the brand palette (red →
     yellow → green → blue → red…) at pauseCursorCycleMs intervals until
     the next character reveals, at which moment it hides.

     The cursor is positioned via getBoundingClientRect rather than DOM
     insertion — keeps the typing's "no reflow on reveal" property intact.
     If rootEl has no padding/border and is the immediate container of
     the typed text, positioning is exact; if rootEl has padding, the
     cursor is offset by that amount and you'd want to either remove the
     padding or position the cursor relative to a tighter wrapper.

   SCALING
     Unlike textScramble or textFocus (which decode/focus in parallel and
     therefore have a roughly content-independent total duration), this
     primitive is intrinsically sequential — total duration scales
     linearly with character count. The baseDelay clamp keeps very long
     content from being unbearable, but a ~200-char body at the
     baseDelayMin floor still takes ~5-7 seconds end-to-end. That's the
     cost of "organic typing." If you need a fast reveal for long
     content, either: lower baseDelayMin further (loses the human feel),
     or use a different primitive.
   ========================================================================== */

/* -----------------------------------------------------------------------------
   DEFAULTS
   --------------------------------------------------------------------------- */

const DEFAULTS = {
  // --- Timing ---

  baseDelayMin: 25,
  baseDelayMax: 110,
  targetTotal:  2000,

  driftAmount: 0.35,
  spaceFactor: 1.3,

  commaPauseMs:    180,
  sentencePauseMs: 350,

  stumbleChance: 0.04,
  stumbleFactor: 1.6,

  // --- Reveal flash (color during typing) ---

  // Probability that any character flashes a brand color at the moment
  // of reveal. The flash then snaps to ink after flashDurationMs.
  // Set to 0 to disable flashing entirely.
  flashChance:     0.30,

  // How long a reveal flash holds its brand color before snapping to
  // ink. The color does NOT interpolate — it's set on reveal, held at
  // full intensity, then cleared. Snapping rather than fading makes
  // each flash read as a discrete event rather than a trailing glow.
  //
  // 130ms is roughly the duration of a perceptible flash — long enough
  // to register the color, short enough to feel like a sharp event.
  // Shorter (~80ms) feels like a sparkle; longer (~250ms+) starts to
  // feel like sustained color rather than a flash.
  flashDurationMs: 130,

  // --- Pause cursor (color during pauses) ---

  // Whether to create the cursor at all. When false, the cursor element
  // isn't appended to rootEl and rootEl's position isn't modified —
  // useful if the caller manages rootEl's positioning and doesn't want
  // the side effect.
  pauseCursorEnabled: true,

  // Minimum gap (in ms) to the next reveal that triggers the cursor.
  // Tuned so structural punctuation pauses (comma additive 180ms,
  // sentence additive 350ms) clear the threshold but rhythm variance
  // (stumbles, space factors) doesn't. Drop this lower if you want the
  // cursor to appear during stumbles too; raise it to limit cursor
  // appearances to sentence ends only.
  pauseCursorThresholdMs: 200,

  // How long each cursor color holds before advancing to the next in
  // the palette. The cursor cycles sequentially through `colors`. Short
  // pauses (commas, ~200-290ms total) see one or two colors; longer
  // pauses (sentence ends, ~375-460ms) see two or three.
  pauseCursorCycleMs: 200,

  // Visible width of the cursor bar in px. The cursor's height matches
  // the line-box of the character it sits after, so it scales with the
  // text's font-size automatically.
  pauseCursorWidth: 2,

  // --- Shared color pool ---

  // Used by both the flash (random pick on each flash) and the cursor
  // (sequential cycling during pauses). Same pool as textScramble and
  // textFocus — keeps the project's brand-color language unified
  // across primitives. Set to [] to disable color entirely (no flashes,
  // no cursor, just plain typing).
  colors: [
    "var(--brand-red)",
    "var(--brand-yellow)",
    "var(--brand-green)",
    "var(--brand-blue)",
  ],

  // --- Completion ---

  // Called once when the animation completes naturally: all characters
  // revealed and the final reveal flash cleared ("visually settled").
  // NOT called on cancel — cancellation means the caller is tearing
  // down, not finishing. Exists to make sequenced reveals possible
  // (start the next piece when this one lands) without the caller
  // trying to predict a schedule that is deliberately random.
  onComplete: null,
};

/* -----------------------------------------------------------------------------
   PUBLIC API
   --------------------------------------------------------------------------- */

export function startTypewriter(rootEl, options = {}) {
  const opts = { ...DEFAULTS, ...options };

  // First pass: collect text nodes. Walking and mutating simultaneously
  // would invalidate the TreeWalker; we gather refs first, then mutate.
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) {
    if (n.textContent) textNodes.push(n);
  }
  if (textNodes.length === 0) {
    // Nothing to type — completion is immediate. Fire onComplete
    // asynchronously (a start function should never call back
    // synchronously; the caller may still be wiring up) and let the
    // returned cancel revoke it, preserving "never called on cancel."
    let raf = 0;
    if (typeof opts.onComplete === "function") {
      raf = requestAnimationFrame(() => { raf = 0; opts.onComplete(); });
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
  }

  // Second pass: replace each text node with a per-character span
  // sequence at the same DOM position. Track enough to restore on cancel.
  const groups = []; // [{ originalNode, spans }, ...]
  const items = [];  // flat list, one entry per character across all groups

  for (const node of textNodes) {
    const chars = Array.from(node.textContent);
    const spans = new Array(chars.length);
    const frag  = document.createDocumentFragment();
    for (let i = 0; i < chars.length; i++) {
      const span = document.createElement("span");
      span.textContent = chars[i];
      // Hide before insertion so the first paint after replaceChild
      // doesn't flash the resolved text. Cleared in the tick loop on
      // each character's reveal time.
      span.style.visibility = "hidden";
      spans[i] = span;
      frag.appendChild(span);
    }
    node.parentNode.replaceChild(frag, node);
    groups.push({ originalNode: node, spans });
    for (let i = 0; i < chars.length; i++) {
      items.push({ char: chars[i], span: spans[i] });
    }
  }

  // Derive the base per-character delay. Same clamp shape as
  // textScramble's stagger formula, just applied to a different quantity
  // (per-char delay vs. per-char stagger-from-start).
  const baseDelay = Math.max(
    opts.baseDelayMin,
    Math.min(opts.baseDelayMax, opts.targetTotal / items.length)
  );

  // Compute reveal times. See the file header's "THE TIMING MODEL"
  // section for the four delay sources combined here.
  const phase1 = Math.random() * Math.PI * 2;
  const phase2 = Math.random() * Math.PI * 2;
  {
    let t = 0;
    for (let i = 0; i < items.length; i++) {
      let delay = baseDelay;

      const noise = 0.6 * Math.sin(i * 0.7 + phase1)
                  + 0.4 * Math.sin(i * 1.3 + phase2);
      delay *= 1 + noise * opts.driftAmount;

      if (i > 0) {
        const prev = items[i - 1].char;
        if (/\s/.test(prev))    delay *= opts.spaceFactor;
        if (/[,;:]/.test(prev)) delay += opts.commaPauseMs;
        if (/[.!?]/.test(prev)) delay += opts.sentencePauseMs;
      }

      if (Math.random() < opts.stumbleChance) {
        delay *= opts.stumbleFactor;
      }

      t += delay;
      items[i].revealAt = t;
    }
  }

  /* ---------------------------------------------------------------------------
     CURSOR SETUP (only if pause cursor enabled and there are colors)
     ------------------------------------------------------------------------- */

  const cursorEnabled = opts.pauseCursorEnabled && opts.colors.length > 0;
  let cursor = null;
  let originalRootPosition = null;
  let rootPositionWasChanged = false;

  if (cursorEnabled) {
    if (getComputedStyle(rootEl).position === "static") {
      originalRootPosition = rootEl.style.position;  // inline, may be ""
      rootEl.style.position = "relative";
      rootPositionWasChanged = true;
    }

    cursor = document.createElement("span");
    cursor.style.position      = "absolute";
    cursor.style.width         = opts.pauseCursorWidth + "px";
    cursor.style.pointerEvents = "none";
    cursor.style.opacity       = "0";
    rootEl.appendChild(cursor);
  }

  // ---------------------------------------------------------------------------
  // ANIMATION STATE
  // ---------------------------------------------------------------------------

  const startTime = performance.now();
  let nextIdx        = 0;     // index of the next character waiting to reveal
  let pauseAfterIdx  = -1;    // index of the last-revealed character
  let pauseActive    = false; // true while the cursor is visible
  let pauseStartTime = 0;     // when the current pause began (for color cycle)
  let lastCursorIdx  = -1;    // last cursor color index written (cheap diff)
  const activeFlashes = [];   // [{ span, startTime }, ...] currently held flashes

  let rafId     = 0;
  let cancelled = false;

  /* ---------------------------------------------------------------------------
     CURSOR POSITIONING
     ------------------------------------------------------------------------- */

  function showCursorAfter(span) {
    if (!cursor) return;
    const charRect = span.getBoundingClientRect();
    const rootRect = rootEl.getBoundingClientRect();
    cursor.style.left   = (charRect.right - rootRect.left) + "px";
    cursor.style.top    = (charRect.top   - rootRect.top)  + "px";
    cursor.style.height = charRect.height + "px";
    cursor.style.opacity = "1";
  }

  function hideCursor() {
    if (!cursor) return;
    cursor.style.opacity = "0";
    lastCursorIdx = -1;  // reset so next show() rewrites the color
  }

  /* ---------------------------------------------------------------------------
     THE TICK LOOP — three jobs per frame
     1. Reveal characters whose time has come (with optional flash)
     2. Clear flashes whose hold-duration has elapsed (snap to ink)
     3. Manage the cursor (show/hide/cycle colors)
     ------------------------------------------------------------------------- */

  const colorsLen     = opts.colors.length;
  const flashEnabled  = colorsLen > 0 && opts.flashChance > 0;

  function tick(now) {
    if (cancelled) return;
    const t = now - startTime;

    // --- (1) Reveal characters ---
    // Advance the "next to reveal" pointer through any characters whose
    // time has come. Each newly-revealed character potentially picks up
    // a flash. If the cursor was visible (a pause was in progress), it
    // hides — the next character has begun, the pause is over.
    while (nextIdx < items.length && items[nextIdx].revealAt <= t) {
      const it = items[nextIdx];
      it.span.style.visibility = "";

      // Reveal flash — rolled per character. Whitespace chars don't
      // flash (they have no visible glyph to carry the color).
      if (flashEnabled && isAnimatable(it.char) && Math.random() < opts.flashChance) {
        const color = opts.colors[(Math.random() * colorsLen) | 0];
        it.span.style.color = color;
        activeFlashes.push({ span: it.span, startTime: t });
      }

      // A reveal happened — if the cursor was active, the pause is over.
      if (pauseActive) {
        hideCursor();
        pauseActive = false;
      }

      pauseAfterIdx = nextIdx;
      nextIdx++;
    }

    // --- (2) Flash snap-to-ink ---
    // Each active flash holds its brand color (we don't touch the
    // inline style — it stays at the color we set on reveal) until
    // its hold-duration elapses, at which point we clear the inline
    // color and the span inherits ink from the cascade. Snap, not
    // fade. Iterating backwards so splices don't disrupt the index.
    for (let i = activeFlashes.length - 1; i >= 0; i--) {
      const f = activeFlashes[i];
      if (t - f.startTime >= opts.flashDurationMs) {
        f.span.style.color = "";
        activeFlashes.splice(i, 1);
      }
    }

    // --- (3) Cursor: show on long gap, cycle colors during pause ---
    if (cursor && nextIdx < items.length && pauseAfterIdx >= 0) {
      const gapToNext = items[nextIdx].revealAt - t;

      if (!pauseActive && gapToNext > opts.pauseCursorThresholdMs) {
        // Transition from typing → pause.
        pauseActive    = true;
        pauseStartTime = t;
        showCursorAfter(items[pauseAfterIdx].span);
      }

      if (pauseActive) {
        // Sequential cycle through the palette while the pause holds.
        const cycleIdx = Math.floor((t - pauseStartTime) / opts.pauseCursorCycleMs) % colorsLen;
        if (cycleIdx !== lastCursorIdx) {
          cursor.style.background = opts.colors[cycleIdx];
          lastCursorIdx = cycleIdx;
        }
      }
    }

    // --- Continue or stop ---
    // Keep ticking while either more chars need to reveal or flashes
    // are still holding their color. Once both are empty, done.
    if (nextIdx < items.length || activeFlashes.length > 0) {
      rafId = requestAnimationFrame(tick);
    } else {
      // Final tidy: hide cursor if it somehow ended up visible past the
      // last reveal (shouldn't happen — last reveal hides it — but
      // defensive against off-by-one bugs).
      if (pauseActive) hideCursor();
      rafId = 0;
      // Natural completion. Spans stay in place (a layered hover may be
      // about to borrow them) — restoring the DOM remains the cancel
      // function's job. Fired only here: reaching this branch requires
      // every character revealed and every flash cleared.
      if (typeof opts.onComplete === "function") opts.onComplete();
    }
  }

  rafId = requestAnimationFrame(tick);

  return () => {
    if (cancelled) return;
    cancelled = true;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }

    // Remove cursor and restore rootEl's position.
    if (cursor && cursor.parentNode) {
      cursor.parentNode.removeChild(cursor);
    }
    if (rootPositionWasChanged) {
      // originalRootPosition was the inline style value before our change.
      // Empty string means there was no inline position set — restore by
      // removing the property entirely rather than leaving an empty value.
      if (originalRootPosition) {
        rootEl.style.position = originalRootPosition;
      } else {
        rootEl.style.removeProperty("position");
      }
    }

    // Swap spans back out for original text nodes. Same anchor pattern
    // as the other primitives: replaceChild on the FIRST span puts the
    // original text node exactly where the spans sat; remove the rest.
    for (const g of groups) {
      const firstSpan = g.spans[0];
      if (firstSpan && firstSpan.parentNode) {
        firstSpan.parentNode.replaceChild(g.originalNode, firstSpan);
      }
      for (let i = 1; i < g.spans.length; i++) g.spans[i].remove();
    }
  };
}

/* -----------------------------------------------------------------------------
   INTERNAL HELPERS
   --------------------------------------------------------------------------- */

function isAnimatable(ch) {
  // Whitespace doesn't get visual treatment — color on an invisible
  // character is wasted work, and a flashing space looks like nothing.
  // Mirrors textScramble's isScrambleable / textFocus's isAnimatable.
  return !/\s/.test(ch);
}
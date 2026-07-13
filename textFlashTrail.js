/* =============================================================================
   textFlashTrail.js — cursor-driven event-triggered color flashes
   -----------------------------------------------------------------------------
   An interaction primitive — sibling to textHoverWave, textHoverScramble,
   textSplitPrint, and textMarkerHighlight. Same family in terms of cursor
   input and span ownership; mechanistically different in how characters
   respond.

   The others are FIELD-DRIVEN: each character maintains a persistent
   excitement value that rises and falls continuously with cursor
   proximity. The visible state (lit / scrambled / split / highlighted)
   tracks the field continuously.

   textFlashTrail is EVENT-DRIVEN: characters don't maintain a field,
   they maintain an independent timer triggered by a discrete event.
   When the cursor's Gaussian excitement for a character crosses
   triggerThreshold from below (the rising edge of cursor proximity),
   the character starts flashing a randomly-picked brand color for a
   random duration in [flashDurationMin, flashDurationMax]. The flash
   runs to completion regardless of subsequent cursor motion; the
   character can't re-trigger until the cursor leaves and returns
   (the rising edge condition).

   The visible result is a TRAIL of sparks following cursor motion.
   Recent chars are mid-flash; older chars are completing their flashes;
   chars not recently passed are ink. The trail is purely temporal —
   the wake is composed of chars at different stages of their own
   independent timelines.

   STATIONARY CURSOR PRODUCES NO ACTIVITY
     This is the most important property of the primitive to understand.
     Once a character has been triggered and its flash has completed, it
     cannot re-trigger as long as the cursor remains nearby — the
     rising-edge condition requires the cursor's excitement contribution
     to first drop BELOW triggerThreshold, then rise above it again.

     Cursor MOTION is the source of all activity. A cursor sitting still
     produces nothing past its initial triggers. Sweeping cursor back
     and forth across the same line of text triggers different chars on
     each sweep but not the same char twice in a row unless the cursor
     leaves its range and returns.

     This is intentional for the spark/trail metaphor — sparks are
     discrete events, not persistent states. If you want a primitive
     where a stationary cursor produces persistent activity, you have
     textHoverWave / textHoverScramble / textSplitPrint / textMarker-
     Highlight already. This one is specifically about transient sparks
     keyed to cursor motion.

   THE FLASH ITSELF
     Snap to a random color from the pool, hold for a random duration in
     [flashDurationMin, flashDurationMax], snap back to ink. Same on/off
     semantics as the other interaction primitives — no fade in, no fade
     out, pure discrete states. The random duration per flash gives the
     wake organic variety: at any moment during cursor motion, the trail
     consists of chars at various flash stages, some near completion,
     some just triggered.

   NO PERSISTENT STATE — SIMPLER OPTION SURFACE
     Because there's no excitement field to maintain, this primitive's
     option surface is smaller than the others'. No litThreshold (the
     visible state is whether the flash timer is active, not whether
     excitement crosses a threshold). No decayHalfLifeMs (flash duration
     is set per-flash, not decayed). No excitementThreshold (no field
     to compare against).

     What's left: waveRadius (defines the trigger zone via Gaussian
     falloff), triggerThreshold (the excitement level above which a
     trigger fires), flashDurationMin/Max (timing), and colors.

   PROPERTY SURFACE
     Writes to `style.color`. Conflicts with textHoverWave (also writes
     color) — don't layer those two on the same element, the semantic is
     redundant anyway. Composes cleanly with textSplitPrint (text-shadow),
     textMarkerHighlight (background-color), and textHoverScramble (if
     its colorChance is 0, otherwise color writes will conflict).

     With entry primitives that also write style.color (textScramble,
     textTypewriter) in layered mode: tick ordering + per-frame writes
     while flashing. Flash trail registered after entry → ticks after,
     writes color last for chars currently flashing, lets entry's writes
     show through for chars not flashing. Same coordination pattern as
     textHoverWave's layered mode.

   TWO MODES — STANDALONE AND LAYERED
     Same auto-detection as the rest of the family. Standalone creates
     spans and restores text nodes on cancel; layered borrows spans and
     does defensive cleanup (clear color for any in-progress flashes,
     leave spans alone for the owning primitive's cancel to restore).

   LOOP CONTINUATION
     Different from the field-driven primitives. The loop runs while:
       - the cursor is inside rootEl (so new triggers can fire), OR
       - any character is currently mid-flash (so its timer can complete).
     Both go false → loop idles. A stationary cursor inside the element
     doesn't keep the loop spinning indefinitely — only until any
     in-flight flashes finish, then the loop sleeps until the cursor
     moves or leaves and returns.

   STARTING WHEN CURSOR IS ALREADY INSIDE
     Same deferred-enter fallback as the rest of the family. The first
     mousemove inside rootEl after listeners attach activates the loop
     if mouseenter didn't fire.

   POSITION HANDLING
     Same getBoundingClientRect strategy. Centers computed at startup
     AND on every enter (real or deferred).

   USAGE
     import { startFlashTrail } from "./textFlashTrail.js";

     // Common case:
     const cancel = startFlashTrail(rootEl);

     // Tighter trigger zone (cursor must pass closer to trigger):
     const cancel = startFlashTrail(rootEl, {
       waveRadius: 35,
       triggerThreshold: 0.6,
     });

     // Longer-lived sparks (a slower decay through the trail):
     const cancel = startFlashTrail(rootEl, {
       flashDurationMin: 200,
       flashDurationMax: 400,
     });

     // Single-color sparks:
     const cancel = startFlashTrail(rootEl, {
       colors: ["var(--brand-red)"],
     });

     cancel();

   CONCURRENCY
     Each call is independent. Calling twice on the same element corrupts
     both. Use cancels.js for exclusivity.

   PERFORMANCE
     Per character per frame: one Math.exp (Gaussian), one comparison,
     potentially one DOM write (only on trigger or flash completion).
     Most frames most characters do zero DOM work — flashes only happen
     on triggers, which are rare per character. In layered mode,
     currently-flashing chars get per-frame color writes (typically <10
     chars at any moment, negligible cost).
   ========================================================================== */

/* -----------------------------------------------------------------------------
   DEFAULTS
   --------------------------------------------------------------------------- */

const DEFAULTS = {
  // Wave dynamics
  waveRadius: 35,
  peakExcitement: 1.0,

  // The excitement level above which a flash triggers. Higher = tighter
  // trigger zone (cursor must pass closer to a character). With default
  // waveRadius=50 and peakExcitement=1.0:
  //   triggerThreshold=0.5 → triggers within ~42px of the character
  //   triggerThreshold=0.7 → triggers within ~30px
  //   triggerThreshold=0.3 → triggers within ~55px
  triggerThreshold: 0.5,

  // Random flash duration range. Each flash picks a value in this range
  // independently — gives the wake organic variety (chars triggered
  // around the same time finish at slightly different times).
  flashDurationMin: 100,
  flashDurationMax: 200,

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

export function startFlashTrail(rootEl, options = {}) {
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
        char:           t.textContent,
        span:           t.parentNode,
        cx:             0,
        cy:             0,
        prevFromCursor: 0,
        isFlashing:     false,
        flashEndTime:   0,
        flashColor:     "",
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
          char:           chars[i],
          span:           spans[i],
          cx:             0,
          cy:             0,
          prevFromCursor: 0,
          isFlashing:     false,
          flashEndTime:   0,
          flashColor:     "",
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
  const flashDurationRange = opts.flashDurationMax - opts.flashDurationMin;

  function pickFlashColor() {
    if (!hasColors) return "";
    return opts.colors[(Math.random() * colorsLen) | 0];
  }

  function pickFlashDuration() {
    return opts.flashDurationMin + Math.random() * flashDurationRange;
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
    lastTickTime = now;

    const gaussianK = -1 / (2 * opts.waveRadius * opts.waveRadius);

    let anyFlashing = false;

    for (const it of items) {
      // Compute current cursor influence on this char.
      const dx = it.cx - cursorX;
      const dy = it.cy - cursorY;
      const distSq = dx * dx + dy * dy;
      const fromCursor = opts.peakExcitement * Math.exp(distSq * gaussianK);

      // Rising-edge trigger detection. The character must:
      //   (a) not already be flashing — flashes are independent and don't
      //       restart in-flight
      //   (b) have its cursor influence currently above triggerThreshold
      //   (c) have its cursor influence PREVIOUSLY below triggerThreshold
      //       — this is the "cursor just arrived" condition that
      //       distinguishes new entries from "cursor still nearby"
      // If all three: trigger a fresh flash with random color and duration.
      if (!it.isFlashing
          && fromCursor >= opts.triggerThreshold
          && it.prevFromCursor < opts.triggerThreshold
          && isAnimatable(it.char)) {
        it.isFlashing   = true;
        it.flashColor   = pickFlashColor();
        it.flashEndTime = now + pickFlashDuration();
        it.span.style.color = it.flashColor;
      }

      // Flash completion check. Once the timer expires, snap back to ink
      // and mark the char re-armable (it will fire again next time the
      // cursor enters its range, after first leaving).
      if (it.isFlashing && now >= it.flashEndTime) {
        it.isFlashing = false;
        it.span.style.color = "";
      }

      // Layered-mode defensive re-write. Another primitive (typically an
      // entry primitive writing style.color) may have overwritten our
      // flash color between our ticks. Re-apply for chars currently mid-
      // flash so we win the paint each frame. Skipped in standalone mode
      // where nothing else competes for style.color.
      if (it.isFlashing && isLayered) {
        it.span.style.color = it.flashColor;
      }

      // Record this frame's fromCursor for next frame's edge detection.
      it.prevFromCursor = fromCursor;

      if (it.isFlashing) anyFlashing = true;
    }

    // Loop continues while there's work to do or work could arrive.
    //   cursor inside → new triggers might fire on next mousemove
    //   anyFlashing → in-flight flashes need to time out
    // Both false → loop idles. mouseenter / first-mousemove-fallback
    // re-arms it.
    if (cursorInside || anyFlashing) {
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
      // Defensive cleanup: clear any in-flight flash colors. Leave spans
      // alone — they belong to the owning primitive.
      for (const it of items) {
        if (it.isFlashing) it.span.style.color = "";
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
  // Whitespace doesn't get flash treatment. A flash on a space character
  // is invisible anyway (no glyph to color), and triggering on whitespace
  // wastes the rising-edge event for a non-event.
  return !/\s/.test(ch);
}

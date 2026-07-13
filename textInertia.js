/* =============================================================================
   textInertia.js — cursor-velocity-driven character displacement
   -----------------------------------------------------------------------------
   An interaction primitive — sibling to textHoverWave, textHoverScramble,
   textSplitPrint, textMarkerHighlight, and textFlashTrail. Same family in
   terms of cursor input and span ownership, but introduces two new
   dimensions to the design space:

     1. INPUT: this primitive responds to cursor VELOCITY, not just cursor
        position. Slow cursor = small effect; fast cursor = bigger effect.
        Stationary cursor in range = nothing happens. The cursor's motion
        is the source of the response.

     2. OUTPUT: this primitive shifts characters' rendered positions via
        CSS `position: relative` and `left`/`top`. First primitive in the
        family to use position as the affordance rather than color or
        text content.

   ON DISPLACEMENT METHOD: POSITION VS TRANSFORM
     This primitive uses `position: relative` + `left`/`top` to shift
     characters' rendered positions, NOT `transform: translate()`. The
     why is worth understanding — earlier iterations tried transform
     and hit two compounding CSS quirks that made it unworkable for
     single-character displacement:

     The transform constraint:
       `transform` has no visible effect on `display: inline` elements
       (the default for spans). It applies only to transformable boxes:
       inline-block, inline-table, table, and block-level. So to make
       transform work on character spans, each span would need
       `display: inline-block`.

     The inline-block constraint #1 (whitespace collapsing):
       An inline-block span whose entire content is whitespace gets that
       content collapsed under default `white-space: normal` — visible
       spaces disappear. Workable around by leaving whitespace spans as
       `display: inline`, but...

     The inline-block constraint #2 (no soft-wrap opportunities):
       A sequence of inline-block boxes has no soft-wrap opportunities
       between them in CSS, even if there's an inline span containing
       whitespace nearby. Wrapping requires the whitespace to act as a
       break opportunity at the level the wrapping algorithm cares about,
       and once each character becomes an atomic inline-block box, the
       surrounding whitespace span loses its wrap-opportunity status
       in practice. Result: text wraps at element boundary instead of
       at word boundaries — single long unwrappable line. Unworkable
       for any multi-line content.

     The position: relative alternative:
       `position: relative` works natively on inline elements with no
       display change. Setting it on character spans plus `left`/`top`
       for displacement preserves all normal text-flow behavior:
       whitespace renders correctly, word-wrapping works at word
       boundaries, line-height and inline alignment are unaffected.
       The layout box stays in place; only the rendered position shifts.

     The trade-off:
       `transform` is more reliably GPU-accelerated. `position: relative`
       with changing `left`/`top` typically triggers paint (not just
       composite). For our scale — small number of displaced chars per
       frame at 60fps — the perf difference is negligible and well
       within budget. The text-flow correctness is worth the small
       perf cost.

     Whitespace exception:
       Whitespace spans don't get `position: relative` set. They're
       never displaced (isAnimatable filter excludes them from the
       tick loop anyway), and leaving them untouched preserves the
       default inline behavior most cleanly.

   THE MENTAL MODEL
     Characters near the cursor offset in the direction the cursor is
     currently moving, then ease back to rest. Like dragging your finger
     through pasta strings — they get pushed in the direction of your
     finger, and gradually return to rest when you stop or move away.

     Each character's target displacement is the cursor velocity vector
     scaled by proximity (Gaussian falloff) and a max-displacement clamp:

       proximity   = exp(-distSq / (2·waveRadius²))   // 0 to 1
       targetDisp  = smoothedVelocity × proximity × (maxDisp / velocityScale)
       targetDisp  = clamp(targetDisp, ±maxDisp)
       actualDisp += (targetDisp - actualDisp) × easeRate

     Two layers of smoothing produce the "inertia" feel:
       - Velocity smoothing — the smoothed cursor velocity vector eases
         toward instantaneous velocity each frame, so single-frame cursor
         jumps don't produce instant displacement spikes.
       - Per-character easing — each character's actual displacement eases
         toward its target each frame, so when the cursor stops or leaves
         (target → 0), characters don't snap back instantly. They settle.

   SYMMETRIC DISPLACEMENT
     Proximity is centered on the cursor, so characters on BOTH sides of
     the cursor get displaced in the cursor's direction of motion — not
     only the trailing chars. As the cursor sweeps right, both the chars
     immediately ahead of it (about to be passed) and the chars behind
     it (just passed) get pushed right.

     The wake naturally falls out of this: as the cursor moves on, chars
     behind it remain in proximity for a while longer, continue to be
     pushed, and gradually settle as proximity drops and the cursor's
     velocity changes.

   PROPERTY ISOLATION
     This primitive writes ONLY to `style.position`, `style.left`, and
     `style.top` on non-whitespace spans. No conflict with anything else
     in the family — color, textContent, textShadow, backgroundColor,
     and transform are all untouched. Composes with any other primitive
     (entry or interaction) without coordination needed.

   NO LAYOUT IMPACT
     `position: relative` shifts the element's rendered position without
     moving its layout box. Word wrap, line breaks, selection boxes,
     and neighbor positions are all stable. The shift is purely visual.

   TWO MODES — STANDALONE AND LAYERED
     Same auto-detection as the rest of the family. Standalone creates
     spans and restores text nodes on cancel; layered borrows spans and
     does defensive cleanup (clear position, left, top on the borrowed
     non-whitespace spans).

   LOOP CONTINUATION
     Different from the field-driven primitives in detail. The loop runs
     while:
       - the cursor is inside rootEl (so new motion can be detected), OR
       - any character has displacement above restThreshold (so its
         easing back to rest can complete).
     Both go false → loop idles.

   STARTING WHEN CURSOR IS ALREADY INSIDE
     Same deferred-enter fallback as the rest of the family.

   POSITION HANDLING (rest-position tracking)
     Same getBoundingClientRect strategy. Note that character centers
     here serve as REST positions — the target the displaced character
     is easing back toward. The actual rendered position is the rest
     position plus the current displacement.

   USAGE
     import { startInertia } from "./textInertia.js";

     // Common case:
     const cancel = startInertia(rootEl);

     // More obvious inertia (slower settling):
     const cancel = startInertia(rootEl, {
       easeRate: 0.12,
     });

     // More dramatic displacement at typical cursor speeds:
     const cancel = startInertia(rootEl, {
       velocityScale: 500,
       maxDisplacement: 14,
     });

     cancel();

   CONCURRENCY
     Each call is independent. Calling twice on the same element corrupts
     both. Use cancels.js for exclusivity.

   PERFORMANCE
     `position: relative` displacement writes trigger paint (not just
     composite), but at the scale this primitive operates — typically
     <20 displaced chars per frame at 60fps — the paint cost is well
     within budget. Per character per frame: one Math.exp (Gaussian
     proximity), a few multiplications and adds, and (only when displaced)
     two DOM writes for left + top. Whitespace chars are skipped entirely
     in the tick loop. Chars at rest skip the DOM write via a near-zero
     displacement check.
   ========================================================================== */

/* -----------------------------------------------------------------------------
   DEFAULTS
   --------------------------------------------------------------------------- */

const DEFAULTS = {
  // Spatial dynamics
  waveRadius: 50,

  // Cursor velocity (px/sec) at which displacement reaches maxDisplacement
  // for a character at peak proximity. Below this, displacement is
  // proportional; above, it's clamped.
  //
  //   velocityScale=500  → typical cursor motion produces max displacement easily
  //   velocityScale=1000 → typical cursor motion produces moderate displacement
  //   velocityScale=2000 → only fast flicks produce noticeable displacement
  velocityScale: 1000,

  // Maximum displacement in pixels (clamp). Caps how far a character can
  // be pushed regardless of cursor velocity. Important for legibility —
  // chars displaced more than ~half their height start to read as broken.
  maxDisplacement: 8,

  // Per-frame easing factor toward the target displacement, in [0, 1].
  //   easeRate=0.4 → very snappy, almost no inertia (chars track cursor closely)
  //   easeRate=0.25 (default) → snappy with subtle lag
  //   easeRate=0.15 → noticeable inertia drag and settle
  //   easeRate=0.08 → heavy lag, very floaty/laggy feel
  easeRate: 0.25,

  // Rest threshold (pixels). Below this displacement, the character is
  // considered at rest. Used both for skipping DOM writes (cheaper) and
  // for loop termination.
  restThreshold: 0.5,
};

// Hardcoded constant: how aggressively the smoothed cursor velocity tracks
// the instantaneous velocity. Higher = more responsive but more twitchy;
// lower = smoother but laggier. 0.3 is a sweet spot — responsive enough
// that fast flicks register clearly, smooth enough that single-frame
// jumps don't produce spike artifacts. Not exposed because easeRate is
// the main "inertia" knob; this is internal calibration.
const VELOCITY_SMOOTHING = 0.3;

/* -----------------------------------------------------------------------------
   PUBLIC API
   --------------------------------------------------------------------------- */

export function startInertia(rootEl, options = {}) {
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
      const span = t.parentNode;
      const ch = t.textContent;
      // Set position: relative only on animatable (non-whitespace) chars —
      // see ON DISPLACEMENT METHOD in the file header. Whitespace stays
      // inline+static, which preserves natural text-flow behavior.
      if (isAnimatable(ch)) {
        span.style.position = "relative";
      }
      items.push({
        char:    ch,
        span,
        cx:      0,
        cy:      0,
        dispX:   0,
        dispY:   0,
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
        // Set position: relative only on animatable (non-whitespace) chars —
        // see ON DISPLACEMENT METHOD in the file header.
        if (isAnimatable(chars[i])) {
          span.style.position = "relative";
        }
        spans[i] = span;
        frag.appendChild(span);
      }
      node.parentNode.replaceChild(frag, node);
      groups.push({ originalNode: node, spans });
      for (let i = 0; i < chars.length; i++) {
        items.push({
          char:    chars[i],
          span:    spans[i],
          cx:      0,
          cy:      0,
          dispX:   0,
          dispY:   0,
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
     CURSOR TRACKING + VELOCITY
     ------------------------------------------------------------------------- */

  let cursorX        = -10000;
  let cursorY        = -10000;
  let cursorInside   = false;
  let rafId          = 0;
  let cancelled      = false;
  let lastTickTime   = 0;

  let prevCursorX    = -10000;
  let prevCursorY    = -10000;
  let smoothedVelX   = 0;
  let smoothedVelY   = 0;

  function activateAt(clientX, clientY) {
    cursorInside = true;
    cursorX = clientX;
    cursorY = clientY;
    prevCursorX = clientX;
    prevCursorY = clientY;
    smoothedVelX = 0;
    smoothedVelY = 0;
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
    const dtSec = Math.max(dtMs, 1) / 1000;

    if (cursorInside) {
      const rawVelX = (cursorX - prevCursorX) / dtSec;
      const rawVelY = (cursorY - prevCursorY) / dtSec;
      smoothedVelX = smoothedVelX * (1 - VELOCITY_SMOOTHING) + rawVelX * VELOCITY_SMOOTHING;
      smoothedVelY = smoothedVelY * (1 - VELOCITY_SMOOTHING) + rawVelY * VELOCITY_SMOOTHING;
      prevCursorX = cursorX;
      prevCursorY = cursorY;
    }

    const gaussianK = -1 / (2 * opts.waveRadius * opts.waveRadius);
    const dispRatio = opts.maxDisplacement / opts.velocityScale;
    const maxSq = opts.maxDisplacement * opts.maxDisplacement;

    let anyDisplaced = false;

    for (const it of items) {
      // Skip whitespace — they're never displaced (position: relative
      // wasn't set on them), and processing them would only add cost
      // without visible effect.
      if (!isAnimatable(it.char)) continue;

      const dx = it.cx - cursorX;
      const dy = it.cy - cursorY;
      const distSq = dx * dx + dy * dy;
      const proximity = Math.exp(distSq * gaussianK);

      let targetX = smoothedVelX * proximity * dispRatio;
      let targetY = smoothedVelY * proximity * dispRatio;
      const targetMagSq = targetX * targetX + targetY * targetY;
      if (targetMagSq > maxSq) {
        const scale = opts.maxDisplacement / Math.sqrt(targetMagSq);
        targetX *= scale;
        targetY *= scale;
      }

      it.dispX += (targetX - it.dispX) * opts.easeRate;
      it.dispY += (targetY - it.dispY) * opts.easeRate;

      // Write position offsets. Near-zero short-circuit clears inline
      // left/top to keep the style clean once a char is at rest.
      const ax = Math.abs(it.dispX);
      const ay = Math.abs(it.dispY);
      if (ax < 0.1 && ay < 0.1) {
        if (it.dispX !== 0 || it.dispY !== 0) {
          it.dispX = 0;
          it.dispY = 0;
          it.span.style.left = "";
          it.span.style.top = "";
        }
      } else {
        it.span.style.left = `${it.dispX.toFixed(2)}px`;
        it.span.style.top  = `${it.dispY.toFixed(2)}px`;
      }

      if (ax > opts.restThreshold || ay > opts.restThreshold) anyDisplaced = true;
    }

    if (cursorInside || anyDisplaced) {
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
      // Defensive cleanup: clear position, left, top on the borrowed
      // non-whitespace spans. Whitespace spans were never modified.
      for (const it of items) {
        if (isAnimatable(it.char)) {
          it.span.style.position = "";
          it.span.style.left = "";
          it.span.style.top = "";
        }
      }
    } else {
      // Standalone: restore text nodes (which also drops all the inline
      // styles we set, since the spans are removed entirely).
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
  // Whitespace isn't displaced (and isn't given position: relative — see
  // ON DISPLACEMENT METHOD in the file header). This check serves dual
  // duty: gating the position style at setup time, and gating the per-
  // frame displacement loop.
  return !/\s/.test(ch);
}
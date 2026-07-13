/* =============================================================================
   textDarkWave.js — textHoverWave + a dark backing highlight on the wave
   -----------------------------------------------------------------------------
   A variant of textHoverWave. The cursor-driven wave is identical — same
   excitement model, snap thresholds, brand-color tint, standalone/layered
   auto-detection, idle behavior, cancel contract. The ADDITION: each
   character the wave lights up also gets a dark-grey background painted
   behind it, cleared the moment that character falls back to ink. The dark
   patch therefore TRACKS THE CURSOR — it appears around the wave and moves
   with it, rather than sitting as a static plate behind the whole block.

   WHY THE BACKGROUND RIDES THE SPANS (not the root)
     An earlier draft of this file set rootEl.style.backgroundColor once on
     start — a single static plate behind the whole element. That was the
     wrong reading of "dark background behind the text": it darkened the
     entire block regardless of the cursor, and it rendered nothing at all
     on a display:contents host (e.g. wallPanel's event-routing zones,
     which generate no box).

     The fix is the same surface textMarkerHighlight uses: write
     style.backgroundColor on each per-character SPAN while it's lit, clear
     it on release. Spans are real inline boxes, so the dark patch paints
     wherever the wave reaches — and it works in layered/zone hosts because
     it never depends on the root having a box.

   PROPERTY SURFACES — TWO OF THEM NOW
     This primitive writes BOTH:
       - style.color           (the brand tint, inherited from hoverWave)
       - style.backgroundColor (the dark patch, this file's addition)
     Layering implications:
       - color is shared with textHoverWave and textFlashTrail — don't
         layer this with either (last writer per frame wins).
       - backgroundColor is shared with textMarkerHighlight — don't layer
         the two on the same span set; on a shared-span host where both can
         be momentarily active (e.g. adjacent wall quadrants during a
         crossing's decay window) expect the same brief, accepted flicker
         the family already tolerates for color-sharing pairs.
     Lit characters end up bright-tinted glyphs on a dark patch, which read
     well; unlit characters are untouched (inherited container color, no
     background).

   CONTRAST NOTE
     Unlike the static-plate draft, resting text is NOT backed by anything,
     so the caller's normal text color stays legible. Only the lit chars sit
     on dark — and those are tinted to bright brand colors, so they read on
     the patch without any caller-side color change.

   ----------------------------------------------------------------------------
   Mental model, modes, idle behavior, and cursor handling below are carried
   over from textHoverWave; see that file's header for the long-form
   rationale on the snap-state model and the layered-mode color fight. Only
   the background writes are new.
   ----------------------------------------------------------------------------

   THE MENTAL MODEL
     Each character has an "excitement" value in [0, 1] bumped up by cursor
     proximity (Gaussian falloff over waveRadius) and decaying exponentially
     (decayHalfLifeMs). A character is "lit" when excitement crosses
     litThreshold; lit chars take a brand tint (re-picked on each rising
     crossing of colorRepickThreshold) AND a dark background.

   TWO MODES — STANDALONE AND LAYERED
     Auto-detected from rootEl's DOM shape. STANDALONE: rootEl has plain
     text; this primitive owns the per-char spans and restores text nodes on
     cancel. LAYERED: rootEl already has per-char spans from an entry
     primitive; this primitive borrows them, re-writes color+background every
     frame while a char is lit (so a parallel writer doesn't overwrite it
     between ticks), and on cancel clears its inline color+background without
     restoring DOM.

   USAGE
     import { startDarkWave } from "./textDarkWave.js";

     // Standalone (rootEl has plain text), default dark grey:
     const cancel = startDarkWave(rootEl);

     // Custom patch color + wave tuning:
     const cancel = startDarkWave(rootEl, {
       background:   "#1e1e1e",
       waveRadius:   40,
       litThreshold: 0.4,
     });

     cancel(); // restores DOM (standalone) or clears inline styles (layered)

   CONCURRENCY
     Each startDarkWave call is independent. Calling it twice on the same
     element corrupts both. Use the cancels-group pattern from cancels.js.
   ========================================================================== */

/* -----------------------------------------------------------------------------
   DEFAULTS
   --------------------------------------------------------------------------- */

const DEFAULTS = {
  waveRadius: 5,
  litThreshold: 0.3,
  peakExcitement: 1.0,
  decayHalfLifeMs: 300,
  excitementThreshold: 0.02,
  colorRepickThreshold: 0.5,
  // The dark patch painted behind each LIT character (cleared on release).
  // A neutral dark grey by default; override per call. Any CSS color.
  background: "#2b2b2b",
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

export function startDarkWave(rootEl, options = {}) {
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

      // (5) Lit state, color tint, AND dark background.
      //
      // Standalone mode: write only on lit/ink transitions — inline styles
      // persist between ticks because nothing else touches them. Cheap.
      //
      // Layered mode: write every frame while lit, because a parallel
      // primitive may have overwritten our color/background since the last
      // tick. Frame-coalescing means the extra writes don't add paints;
      // they just make ours the last applied each frame.
      //
      // The dark background tracks the wave: it is set exactly on the chars
      // that are currently lit and cleared the instant they release, so the
      // dark patch follows the cursor instead of plating the whole block.
      const shouldBeLit = it.excitement >= opts.litThreshold && isAnimatable(it.char);
      if (shouldBeLit) {
        if (!it.isLit || isLayered) {
          if (it.tint) it.span.style.color = it.tint;
          if (opts.background) it.span.style.backgroundColor = opts.background;
          it.isLit = true;
        }
      } else if (it.isLit) {
        // Releasing. Clear both surfaces we own. For layered hosts where a
        // parallel primitive is still writing these chars, its next tick
        // restores its own value — at worst one ink/clear frame, subsumed
        // by the surrounding motion.
        it.span.style.color = "";
        it.span.style.backgroundColor = "";
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
      // Defensive: clear any inline color/background we set. We don't own
      // these spans (an entry primitive does), so we clean our own styles
      // and leave DOM restore to the owner's cancel.
      for (const it of items) {
        if (it.isLit) {
          it.span.style.color = "";
          it.span.style.backgroundColor = "";
        }
      }
    } else {
      // Standalone: we own the spans, restore text nodes (which drops any
      // backgrounds/colors we set along with the spans).
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
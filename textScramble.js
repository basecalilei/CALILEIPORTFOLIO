/* =============================================================================
   textScramble.js — per-character text-scramble animation primitive
   -----------------------------------------------------------------------------
   Runs a "decoded text" animation on the text inside a root element. Each
   text node is replaced with a sequence of <span>s (one per character);
   each character cycles through random glyphs before locking in its
   authored value. A configurable fraction of unresolved positions tint
   with a color from a pool on each redraw, giving the scramble visual
   life during the decoding phase.

   USAGE
     import { startScramble } from "./textScramble.js";

     // Common case — defaults match the project's brand palette + timing:
     const cancel = startScramble(rootEl);

     // Customised — any subset of options overrides the defaults:
     const cancel = startScramble(rootEl, {
       duration: 200,
       colorChance: 0.20,
       colors: ["var(--brand-red)", "#ffffff"],
     });

     // Always-callable cancel — stops the animation and restores DOM:
     cancel();

   DOM EFFECT
     The function mutates rootEl's text nodes IN PLACE. Each original text
     node is detached and replaced with a sequence of <span>s while the
     animation runs; the cancel function (and natural completion via
     subsequent cancel) restores the original text nodes synchronously.
     The DOM is never left in a partial state.

     Returns a cancel function regardless of whether the root had any
     scrambleable text. Calling it when there's nothing to clean up is a
     safe no-op.

   CONCURRENCY
     Each startScramble call is independent — there's no shared registry.
     Calling startScramble while a previous one is still in flight has no
     automatic interaction. Callers that need exclusivity (e.g. one
     scramble per view at a time) should track their own cancel functions
     and invoke them before kicking off new scrambles.

   WHY PER-CHARACTER SPANS
     Each character needs its own element to carry its own inline color.
     Per-char spans are the simplest expression of that — for typical body
     copy the DOM footprint is negligible, and inline-flow rendering treats
     consecutive spans as a single text run, so word-wrap, whitespace
     collapsing, and inherited styles (font, weight, base color,
     line-height) all behave exactly as if the original text node were
     still there.

   PERFORMANCE
     The random-glyph refresh is throttled (default ~18fps via
     randomTickMs). Repaints are limited to the scrambled text; no layout
     invalidation, because the character count never changes.
   ========================================================================== */

/* -----------------------------------------------------------------------------
   DEFAULTS
   -----------------------------------------------------------------------------
   Tuned for ~50-300-char body copy in the project's display font. Pass
   any of these as `options` keys to startScramble to override per call.
   --------------------------------------------------------------------------- */

const DEFAULTS = {
  // Glyph pool the unresolved positions cycle through. Caps, digits, and
  // a handful of symbols read as "decoded text" rather than alphabet noise.
  glyphs: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&<>-_=+?",

  // How long each position spends cycling random glyphs before locking in
  // its authored character.
  duration: 260,

  // Target overall duration. Used to derive the per-character stagger
  // from the actual text length, so the animation finishes in roughly
  // this much time regardless of whether the content is 50 chars or 300.
  targetTotal: 1100,

  // Stagger clamps. For very short text, the derived stagger would be
  // too large (slow-feeling); for very long text, too small (everything
  // resolves at once). These bounds keep the visual pacing recognisable
  // across content lengths.
  staggerMin: 4,
  staggerMax: 14,

  // Refresh rate of the random-glyph cycling. ~18fps. Faster than this
  // (e.g. every frame at 60fps) reads as strobing static; slower reads
  // as distinct frames rather than continuous scramble.
  randomTickMs: 55,

  // Fraction of unresolved positions that show a color tint at any given
  // redraw. Rolled per character per redraw, so colors twinkle as the
  // scramble cycles rather than staying fixed to specific positions.
  // Pass 0 (or pass `colors: []`) to disable tinting entirely.
  colorChance: 0.10,

  // Color pool. Passed through as `var(...)` references rather than
  // resolved hex values — the spans inherit through CSSOM at paint time,
  // so changing a brand color in infiniteStyles.css automatically
  // updates the scramble without touching this file.
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

export function startScramble(rootEl, options = {}) {
  const opts = { ...DEFAULTS, ...options };

  // First pass: collect text nodes. Walking and mutating simultaneously
  // would invalidate the TreeWalker; we gather refs first, then mutate.
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) {
    if (n.textContent) textNodes.push(n);
  }
  if (textNodes.length === 0) return () => {};

  // Second pass: replace each text node with a per-character span sequence
  // at the same DOM position. Track enough to restore on cancel.
  const groups = []; // [{ originalNode, spans }, ...]
  const items = [];  // flat list, one entry per character across all groups

  for (const node of textNodes) {
    // Array.from splits on code points (correct for surrogate pairs). For
    // full grapheme-cluster correctness (combining marks, ZWJ emoji),
    // Intl.Segmenter would be needed — overkill for typical body copy.
    const chars = Array.from(node.textContent);
    const spans = new Array(chars.length);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < chars.length; i++) {
      const span = document.createElement("span");
      span.textContent = chars[i];
      spans[i] = span;
      frag.appendChild(span);
    }
    node.parentNode.replaceChild(frag, node);
    groups.push({ originalNode: node, spans });
    for (let i = 0; i < chars.length; i++) {
      items.push({ char: chars[i], span: spans[i] });
    }
  }

  // Derive the per-character stagger from text length, clamped. Short
  // text gets the max stagger (still snappy); long text gets the min
  // (still finishes near the target duration).
  const stagger = Math.max(
    opts.staggerMin,
    Math.min(opts.staggerMax,
      (opts.targetTotal - opts.duration) / items.length)
  );
  for (let i = 0; i < items.length; i++) {
    items[i].resolveAt = i * stagger + opts.duration;
  }
  const totalDuration = items[items.length - 1].resolveAt;

  const startTime = performance.now();
  let lastDrawTime = -Infinity;
  let rafId = 0;
  let cancelled = false;

  // Cache lengths and the color-tinting predicate for the hot loop.
  const glyphsLen = opts.glyphs.length;
  const colorsLen = opts.colors.length;
  const tintEnabled = colorsLen > 0 && opts.colorChance > 0;

  function tick(now) {
    if (cancelled) return;
    const t = now - startTime;
    const allResolved = t >= totalDuration;
    // Throttle the random-glyph refresh to opts.randomTickMs, but always
    // do a final write on the last frame so locked-in chars commit cleanly.
    const shouldDraw = (now - lastDrawTime) >= opts.randomTickMs || allResolved;

    if (shouldDraw) {
      lastDrawTime = now;
      for (const it of items) {
        const span = it.span;
        if (t >= it.resolveAt || !isScrambleable(it.char)) {
          // Resolved, or never-scrambled whitespace. Lock in the authored
          // character and clear any tint so it inherits the parent color.
          span.textContent = it.char;
          if (span.style.color) span.style.color = "";
        } else {
          // Unresolved: write a random glyph, then roll for a color tint.
          span.textContent = opts.glyphs[(Math.random() * glyphsLen) | 0];
          if (tintEnabled && Math.random() < opts.colorChance) {
            span.style.color = opts.colors[(Math.random() * colorsLen) | 0];
          } else if (span.style.color) {
            span.style.color = "";
          }
        }
      }
    }

    if (allResolved) {
      rafId = 0;
    } else {
      rafId = requestAnimationFrame(tick);
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
    // Swap spans back out for original text nodes. The FIRST span of each
    // group is the position anchor — replaceChild puts the original text
    // node exactly where the first span sat in the parent's children list;
    // we then remove the remaining spans. Order across groups doesn't
    // matter — each group's first span stays in the DOM until we replace
    // it here.
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

function isScrambleable(ch) {
  // Whitespace stays as-is — keeps line breaks and word boundaries intact
  // during the scramble (reads as "decoding text" rather than solid noise).
  return !/\s/.test(ch);
}

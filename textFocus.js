/* =============================================================================
   textFocus.js — per-character "focus pull" text animation primitive
   -----------------------------------------------------------------------------
   Sibling to textScramble. Runs an "ideas crystallizing" animation on the
   text inside a root element: each character starts heavily blurred and
   (for a configurable fraction of positions) tinted in a brand color, then
   smoothly resolves to crisp ink over its own staggered window. The line
   "focuses in" non-uniformly — chars at the start of the text finish first,
   chars at the end finish last, and the colored accents fade through to
   ink as their carrier characters sharpen.

   USAGE
     import { startFocus } from "./textFocus.js";

     // Common case — defaults match the project's brand palette + timing:
     const cancel = startFocus(rootEl);

     // Customised — any subset of options overrides the defaults:
     const cancel = startFocus(rootEl, {
       duration: 320,
       maxBlur: 8,
       colorChance: 0.40,
     });

     // Always-callable cancel — stops the animation and restores DOM:
     cancel();

   DOM EFFECT
     Identical contract to textScramble: rootEl's text nodes are detached
     and replaced with per-character <span>s while the animation runs; the
     cancel function (or natural completion + cancel) restores the original
     text nodes synchronously. DOM is never left in a partial state.

     Returns a cancel function regardless of whether the root had any
     animatable text. Calling it when there's nothing to clean up is a
     safe no-op.

   CONCURRENCY
     Each startFocus call is independent — no shared registry. Calling
     startFocus while a previous one is in flight on the same element has
     no automatic interaction and will corrupt both (the second call walks
     spans expecting text nodes). Callers needing exclusivity track their
     own cancel handles — see cancels.js / createCancelGroup.

   WHY THE BLUR-NOT-SHADOW CHOICE
     An alternative implementation would leave characters at opacity 0 and
     animate a colored text-shadow from wide to zero (a colored haze that
     condenses into the ink character as it fades in). That reads as
     "writing materializing on paper" — also good, but a different feeling.
     We chose filter: blur for the literal "focus pull" feeling: characters
     are smeared from the start, recognizable but unreadable, sharpening
     into crispness. If you want the haze-condense variant instead, swap
     filter: blur for opacity + text-shadow in the tick loop — the rest of
     the structure (stagger, color-mix, cancel) is identical.

   WHY PICK-ONCE COLORS, NOT FLICKER
     textScramble's color twinkle works because each unresolved char is
     also randomizing its glyph — flicker stacks on flicker and reads as
     life. In focus, characters don't randomize; flickering their color
     would just look broken. So each colored character picks one brand
     color at start and holds it, smoothly mixing toward var(--ink) via
     color-mix(in oklch, ...) as the character sharpens. The colored
     positions are persistent — fewer of them are needed to deliver the
     same "splashed with brand" feeling. Default colorChance is therefore
     higher than scramble's (0.25 vs 0.10).

   PERFORMANCE
     Per-character filter: blur is GPU-cheap during the animation but does
     promote each animating span to a compositor layer for the duration of
     its window. For typical title + body copy (~5 chars + ~150 chars) the
     layer count is well within budget. If you scale this to multi-paragraph
     text, profile before assuming it scales — and consider the text-shadow
     variant above, which doesn't promote layers.

     color-mix(in oklch, ...) is written as a CSS string per-frame per
     colored char. The browser caches the parse; the string allocation is
     measurable but not significant at this scale.
   ========================================================================== */

/* -----------------------------------------------------------------------------
   DEFAULTS
   -----------------------------------------------------------------------------
   Tuned for ~50-300-char body copy in the project's display font. Pass
   any of these as `options` keys to startFocus to override per call.
   --------------------------------------------------------------------------- */

const DEFAULTS = {
  // How long each position spends animating from full blur + tint to
  // crisp ink. Same default as textScramble's `duration` — keeps the
  // sidebar's animation language consistent across primitives.
  duration: 260,

  // Target overall duration. The per-character stagger is derived from
  // text length so this lands roughly the same whether the content is
  // 50 chars or 300. Same shape (and same defaults) as textScramble.
  targetTotal: 1100,
  staggerMin: 4,
  staggerMax: 14,

  // Initial blur radius (px). At ~6px on body-copy-sized text, characters
  // are recognisably blurred — you can see something is there without
  // being able to read it. Higher gets fully illegible; lower stops
  // feeling like "out of focus" and just looks soft.
  maxBlur: 6,

  // Fraction of characters that receive a persistent brand-color tint at
  // start. Higher than textScramble's `colorChance` because focus's colors
  // don't flicker — each colored position holds its color through its
  // window, so fewer positions need to be coloured to feel "splashed"
  // rather than "twinkled".
  colorChance: 0.25,

  // Color pool. Same CSS variable references as textScramble — the
  // color-mix expression resolves both ends (brand + ink) at paint time
  // from the cascade, so updating brand colors in infiniteStyles.css
  // flows through automatically without touching this file.
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

export function startFocus(rootEl, options = {}) {
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

  // Derive the per-character stagger from text length, clamped. Identical
  // formula to textScramble — same content lengths produce the same
  // pacing curve across both primitives.
  const stagger = Math.max(
    opts.staggerMin,
    Math.min(opts.staggerMax,
      (opts.targetTotal - opts.duration) / items.length)
  );

  // Assign each character its start time and (probabilistically) a tint
  // color. The tint is picked ONCE here — see "WHY PICK-ONCE COLORS" in
  // the file header. Characters with no tint just blur and sharpen in
  // their inherited ink color.
  const colorsLen = opts.colors.length;
  const tintEnabled = colorsLen > 0 && opts.colorChance > 0;
  for (let i = 0; i < items.length; i++) {
    items[i].startTime = i * stagger;
    items[i].tint = (tintEnabled && Math.random() < opts.colorChance)
      ? opts.colors[(Math.random() * colorsLen) | 0]
      : null;
  }
  const totalDuration = (items.length - 1) * stagger + opts.duration;

  // Pre-paint: write the t=0 state inline before the rAF loop kicks off.
  // Without this, the first paint after span insertion shows un-animated
  // (crisp ink) characters for one frame, then the rAF tick replaces
  // them with the blurred initial state — a visible flicker. Writing
  // the initial state here means the first paint already shows the
  // animation's starting frame.
  for (const it of items) {
    if (!isAnimatable(it.char)) continue;
    it.span.style.filter = `blur(${opts.maxBlur}px)`;
    if (it.tint) it.span.style.color = it.tint;
  }

  const startTime = performance.now();
  let rafId = 0;
  let cancelled = false;

  function tick(now) {
    if (cancelled) return;
    const t = now - startTime;
    const allResolved = t >= totalDuration;

    for (const it of items) {
      if (!isAnimatable(it.char)) continue;
      const span = it.span;
      // Per-character progress: 0 before its window opens (start clamped),
      // 1 after it closes. Linear inside the window. If the visual ever
      // needs an ease (e.g. easeOut so chars decelerate into focus),
      // remap progress here — the rest of the loop doesn't care.
      const progress = Math.max(
        0,
        Math.min(1, (t - it.startTime) / opts.duration)
      );

      if (progress >= 1) {
        // Resolved. Clear inline styles so the span inherits ink color
        // and zero blur from the cascade — identical to a never-animated
        // span. The cancel path then has nothing visual to undo (only
        // the DOM swap remains).
        if (span.style.filter) span.style.filter = "";
        if (span.style.color)  span.style.color  = "";
        continue;
      }

      const blurPx = (opts.maxBlur * (1 - progress)).toFixed(2);
      span.style.filter = `blur(${blurPx}px)`;

      if (it.tint) {
        // Mix from full brand at progress=0 to full ink at progress=1.
        // OKLCH gives a perceptually smoother interpolation than sRGB —
        // the midpoint doesn't dip through a muddy intermediate.
        const brandPct = ((1 - progress) * 100).toFixed(1);
        const inkPct   = (progress * 100).toFixed(1);
        span.style.color = `color-mix(in oklch, ${it.tint} ${brandPct}%, var(--ink) ${inkPct}%)`;
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
    // Swap spans back out for original text nodes. Same anchor pattern
    // as textScramble: replaceChild on the FIRST span puts the original
    // text node exactly where the spans sat; remove the remaining spans.
    // Order across groups doesn't matter — each group's first span stays
    // in the DOM until we replace it here.
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
  // Whitespace doesn't get blur or color treatment — blurring an empty
  // space is invisible work, and the resolved state IS the starting
  // state. Skipping whitespace in the hot loop is a small win for long
  // text with many spaces. Mirrors textScramble's isScrambleable.
  return !/\s/.test(ch);
}

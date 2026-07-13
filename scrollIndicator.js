/* =============================================================================
   scrollIndicator.js — the SCROLL POSITION STRIP (site-wide enhancement module)
   -----------------------------------------------------------------------------
   A persistent right-edge instrument readout of where the user is in the
   panel loop: one registration cross per panel, a hairline corner-bracket
   reticle that rides activeFloat continuously, and a small Hornet index
   readout ("02 / 07"). The crosses are click-to-jump: clicking one tweens
   the scroll to that panel. The module registers no weight and never writes
   scroll STATE — a jump supplies scroll INPUT through scrollPageBy, the
   core's sanctioned channel, upstream of onScroll (the single writer).

   HOW IT READS THE SCROLL (and why it's a frame hook, not a panel type)
     The strip isn't tied to any one panel — it visualizes the whole loop.
     So it consumes the core through the system-level slot: one
     registerFrameHook plus the read-only getters (getActiveFloat,
     getPanelCount). The hook runs in step (5) of the core loop, after every
     panel type has settled its frame. No easing is layered on top:
     activeFloat is already the smoothed truth of the scroll, and an
     instrument that eases its own needle stops being trustworthy. The
     reticle is scroll-linked the same way the overlays' --shift is.

   THE WRAP SEAM (the one real problem, and the clone trick that solves it)
     The loop is infinite: activeFloat runs [0, N) and wraps. A single
     reticle sliding down a linear strip would have to fly back to the top
     when the wrap crosses N → 0. The fix mirrors the scroller's own runway
     clones: render TWO reticles, permanently offset by exactly one cycle
     length (N * STEP px), inside an overflow:hidden track. Crossing the
     seam, the primary slides off the bottom edge while its clone slides in
     from the top — continuous motion, no conditionals, no seam. The same
     idea the engine uses, one level up.

   CLICK-TO-JUMP
     Clicking mark i computes the wrap-aware shortest signed distance from
     the current activeFloat to i (the same double-mod idiom the core uses
     for dist[i]), converts it to pixels once (d * window.innerHeight — one
     panel is one viewport tall), and feeds that budget to scrollPageBy from
     the frame hook as an exponential ease against dt: each frame moves a
     fixed FRACTION of what remains, so the tween is frame-rate independent,
     starts immediately, and lands softly. Because the fed deltas sum to
     exactly d * vh, the scroll settles precisely on the target integer —
     no snap or correction pass needed. The handoff gate sequences the
     resulting panel transition for free; this module knows nothing about
     it. Any real user input (wheel, touchmove) or a resize cancels the
     in-flight jump immediately — the user always wins, and after a resize
     the remaining-px budget would be in stale viewport units anyway.

   GEOMETRY
     Track height is exactly N * STEP. Mark i centers at (i + 0.5) * STEP;
     the reticle centers at (activeFloat + 0.5) * STEP and the clone at that
     minus N * STEP. All glyphs are centered via negative margins (the
     cursor's trick), so the per-frame transform carries only the raw y —
     one compositor-path translate3d write per reticle per frame, no layout.

   PER-FRAME COST
     Two transform writes, always. One class swap + one textContent write
     only on the frame where the nearest panel index actually changes
     (change-detected via lastActive). One scrollPageBy call per frame while
     a jump is in flight, zero otherwise. Everything else is static after
     init.

   THE SIDEBAR DODGE (coupling, made explicit and one-directional)
     The strip lives on the right edge — the same edge the sidebar sheet
     slides in from. Rather than observing the sidebar's private DOM, this
     module keys off the sidebar's PUBLISHED broadcast: sidebar.js toggles
     `sidebar-is-open` on <body>, and sidebarStyles.css owns the sheet width
     as the `--sidebar-width` token. The dodge itself is pure CSS in
     scrollIndicatorStyles.css — body.sidebar-is-open shifts the strip left
     by var(--sidebar-width) on the same duration/ease as the sheet, so the
     two move as one. The sidebar never knows this module exists; delete the
     sidebar and var(--sidebar-width, 0px) falls back, making the dodge a
     no-op. If the broadcast ever breaks, the failure is benign: the sheet
     (z:9) simply slides over the strip (z:5).

   INPUT
     The container stays pointer-events:none so the strip never traps a
     scroll; only the marks opt back in, each with a ::after hit box sized
     to STEP so the targets tile the track edge-to-edge (see the CSS). The
     marks declare the --cursor: pointer protocol, so cursor.js renders the
     reticle-with-dot affordance over them. The root stays aria-hidden (like
     the cursor): the strip duplicates what scrolling already does, and its
     marks are non-focusable divs, so it adds no keyboard surface.

     Because the tiled hit boxes swallow wheel events, the strip would be a
     scroll dead zone without forwarding — the exact problem turnPanel's
     drag surface has, solved the same canonical way: catch the wheel,
     buffer deltaY, and drain it through scrollPageBy with the same
     exponential ease and rate (18 s^-1) as turnPanel's forwarding, so
     wheeling over the strip feels identical to wheeling anywhere else.
     turnPanel needs a self-running rAF for its drain; this module already
     owns a frame hook, so the drain rides there instead.

   NOT A PANEL TYPE
     Registers no panel type and no weight; participates in no handoff —
     its motion IS the transition, read straight off activeFloat. Like the
     sidebar it is eagerly mounted persistent UI; unlike the sidebar it
     reads scroll state. It is the first pure consumer of the step-(5) hook
     slot besides the scene system.

   COUPLED WITH
     - infiniteScroll.js: registerFrameHook, getActiveFloat, getPanelCount
       (read-only surface), plus scrollPageBy (scroll input for jumps —
       state still has one writer; see CLICK-TO-JUMP).
     - sidebar.js / sidebarStyles.css: the `sidebar-is-open` body class and
       the `--sidebar-width` / `--sidebar-trigger-width` tokens (published
       contract — the first drives the dodge, the second locks the strip's
       column width to the MENU button; see scrollIndicatorStyles.css).
     - scrollIndicatorStyles.css: all presentation.
     - index.html: <link> to scrollIndicatorStyles.css.
     - main.js: `initScrollIndicator()` after start(PANELS) — the module
       needs getPanelCount() populated, so it inits after start, exactly
       like the scene system does.
   ========================================================================== */

import {
  registerFrameHook,
  getActiveFloat,
  getPanelCount,
  scrollPageBy,
} from "./infiniteScroll.js";

/* Vertical rhythm of the strip: px between mark centers. The track height,
   the mark positions, and the clone offset all derive from this one number. */
const STEP = 36;

/* Jump ease time constant, in seconds (dt from the core is seconds). Each
   frame the tween covers (1 - e^(-dt/TAU)) of the remaining distance —
   remaining halves every TAU*ln2 ≈ 0.1s, perceptually arrived in ~0.35s,
   fully settled (sub-pixel, then snapped) under a second. */
const JUMP_TAU = 0.15;

/* Wheel-forwarding drain rate, s^-1 — matches turnPanel's
   WHEEL_SMOOTH_SPEED so a wheel over the strip feels identical to a wheel
   over the drag surface (95% of a tick drains in ~3/18 ≈ 165ms). */
const WHEEL_SMOOTH_SPEED = 18;

let mounted = false;

export function initScrollIndicator() {
  if (mounted) return;

  const N = getPanelCount();
  if (!N) {
    console.warn("[scrollIndicator] initScrollIndicator called before start() — no panels");
    return;
  }
  mounted = true;

  /* ---------------------------------------------------------------------------
     BUILD — all static DOM, sized once. N never changes at runtime and every
     dimension is in px, so there is nothing to rebuild and no resize handling.
     Built here rather than in index.html so the module is self-contained —
     remove the import and every trace is gone (same rule as cursor.js).
     --------------------------------------------------------------------------- */

  const root = document.createElement("div");
  root.className = "scroll-indicator";
  root.setAttribute("aria-hidden", "true");

  const track = document.createElement("div");
  track.className = "si-track";
  track.style.height = `${N * STEP}px`;

  /* One registration cross per panel — the visual language's mark for an
     anchor position. Inline SVG (like the cursor's glyph) so the stroke is a
     true hairline and the color rides currentColor from the CSS state. */
  const marks = [];
  for (let i = 0; i < N; i++) {
    const mark = document.createElement("div");
    mark.className = "si-mark";
    mark.dataset.index = i;
    mark.style.top = `${(i + 0.5) * STEP}px`;
    mark.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
        <line x1="6" y1="0" x2="6" y2="12" stroke="currentColor"/>
        <line x1="0" y1="6" x2="12" y2="6" stroke="currentColor"/>
      </svg>`;
    track.appendChild(mark);
    marks.push(mark);
  }

  /* The traveler and its clone — a corner-bracket reticle ("target
     acquired"), the same dialect as the site cursor's point variant. Two
     identical elements, permanently one cycle apart; the track's
     overflow:hidden clips whichever one is off-strip. */
  const reticle = document.createElement("div");
  reticle.className = "si-reticle";
  reticle.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none">
      <polyline points="0.5,7 0.5,0.5 7,0.5"       stroke="currentColor"/>
      <polyline points="17,0.5 23.5,0.5 23.5,7"    stroke="currentColor"/>
      <polyline points="23.5,17 23.5,23.5 17,23.5" stroke="currentColor"/>
      <polyline points="7,23.5 0.5,23.5 0.5,17"    stroke="currentColor"/>
    </svg>`;
  const reticleClone = reticle.cloneNode(true);
  track.appendChild(reticle);
  track.appendChild(reticleClone);

  /* The readout — index / total in the kicker's slash syntax. The total is
     static; only the index span is ever rewritten. */
  const readout = document.createElement("div");
  readout.className = "si-readout";
  const idxEl = document.createElement("span");
  idxEl.className = "si-readout-index";
  idxEl.textContent = "01";
  const totalEl = document.createElement("span");
  totalEl.className = "si-readout-total";
  totalEl.textContent = ` / ${String(N).padStart(2, "0")}`;
  readout.append(idxEl, totalEl);

  root.append(track, readout);
  document.body.appendChild(root);

  /* ---------------------------------------------------------------------------
     CLICK-TO-JUMP — see header. One delegated listener on the track; the
     per-frame feed lives in the frame hook below.
     --------------------------------------------------------------------------- */

  let jumpRemaining = 0;   // px of scroll input still to feed; 0 = idle
  let pendingWheel = 0;    // buffered wheel deltaY awaiting the smoothed drain

  /* Wheel forwarding — deltaY only (the scroll is vertical-only), passive
     because there's no default scroll action on this non-scrolling element.
     Same conventions as turnPanel's forwarding. */
  track.addEventListener("wheel", (e) => {
    pendingWheel += e.deltaY;
  }, { passive: true });

  track.addEventListener("click", (e) => {
    const mark = e.target.closest(".si-mark");
    if (!mark) return;
    const i = Number(mark.dataset.index);

    // Shortest signed distance to the target, in panel units — the same
    // wrap idiom the core uses for dist[i]. Computed fresh from the live
    // activeFloat, so re-clicking mid-jump just retargets cleanly.
    const af = getActiveFloat();
    let d = i - af;
    d = ((d % N) + N) % N;
    if (d > N / 2) d -= N;

    jumpRemaining = d * window.innerHeight;   // one panel = one viewport
  });

  // The user always wins: any real scroll input, or a resize (which would
  // leave jumpRemaining in stale viewport units), cancels the tween.
  const cancelJump = () => { jumpRemaining = 0; };
  window.addEventListener("wheel", cancelJump, { passive: true });
  window.addEventListener("touchmove", cancelJump, { passive: true });
  window.addEventListener("resize", cancelJump);

  /* ---------------------------------------------------------------------------
     PER FRAME — runs in the core loop's step (5), after panels settle.
     --------------------------------------------------------------------------- */

  const cycle = N * STEP;   // one full loop, in strip pixels
  let lastActive = -1;      // change-detector for the discrete-state writes

  registerFrameHook((dt) => {
    const af = getActiveFloat();   // wrapped [0, N)

    // Continuous position — direct map, no easing (see header). toFixed
    // keeps the style string stable-length; sub-hundredth-px is invisible.
    const y = (af + 0.5) * STEP;
    reticle.style.transform      = `translate3d(0, ${y.toFixed(2)}px, 0)`;
    reticleClone.style.transform = `translate3d(0, ${(y - cycle).toFixed(2)}px, 0)`;

    // Discrete state — the nearest panel. Math.round(af) can yield N right
    // at the top of the wrap; the double-mod folds it back to 0 (the same
    // idiom the core uses for activeIndex).
    const active = ((Math.round(af) % N) + N) % N;
    if (active !== lastActive) {
      if (lastActive >= 0) marks[lastActive].classList.remove("is-active");
      marks[active].classList.add("is-active");
      idxEl.textContent = String(active + 1).padStart(2, "0");
      // Update afterglow — the discrete write flashes the write color and
      // decays back to the index's resting accent (CSS owns the decay; see
      // scrollIndicatorStyles.css). Remove → reflow → re-add restarts the
      // animation when panel changes arrive faster than the decay (fast
      // scrolling), so consecutive writes each read as a fresh write —
      // same retrigger idiom as the shop gate's shake.
      idxEl.classList.remove("is-fresh");
      void idxEl.offsetWidth;
      idxEl.classList.add("is-fresh");
      lastActive = active;
    }

    // Wheel drain — forwarded wheel input, eased at turnPanel's rate so the
    // feel matches native. Sub-half-pixel tails flush and zero the buffer.
    if (pendingWheel !== 0) {
      let step = pendingWheel * (1 - Math.exp(-WHEEL_SMOOTH_SPEED * dt));
      if (Math.abs(pendingWheel) < 0.5) step = pendingWheel;
      scrollPageBy(step);
      pendingWheel -= step;
    }

    // Jump feed — exponential ease against dt (see JUMP_TAU). Below half a
    // pixel, flush the exact remainder in one step so the deltas sum to
    // precisely d * vh and the scroll lands dead on the target integer.
    if (jumpRemaining !== 0) {
      let step = jumpRemaining * (1 - Math.exp(-dt / JUMP_TAU));
      if (Math.abs(jumpRemaining) < 0.5) step = jumpRemaining;
      scrollPageBy(step);
      jumpRemaining -= step;
    }
  });
}

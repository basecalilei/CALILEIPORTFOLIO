/* =============================================================================
   smoothFollow.js — velocity-clamped auto-scroll toward a retargetable goal
   -----------------------------------------------------------------------------
   A shared utility (the cancels/overlayHover family: no stylesheet, imports
   nothing from core). Given a scroll container, createSmoothFollow eases
   its scrollTop toward a target the caller re-issues over time — built for
   "the sheet follows the story" duties like sidebarAbout's gated reveal,
   where the goal hops forward step by step and the motion must feel the
   same across wildly different hop sizes (one text line vs a full-bleed
   figure).

   THE MOTION MODEL — WHY NOT THE USUAL EXPONENTIAL
     The codebase easing idiom (x += (goal - x) * (1 - exp(-k*dt))) has
     velocity proportional to remaining distance: a short hop crawls, a
     tall-figure hop LURCHES out of the gate. Same curve, wildly different
     perceived speed — exactly the jumpiness this utility exists to avoid.
     Here velocity is a first-class quantity with two shaping stages:

       vDesired  = clamp(remaining * easeK, 0, maxVelocity)   // where to be
       v        += (vDesired - v) * (1 - exp(-accelK * dt))   // ramp toward it
       scrollTop += v * dt

     Far from the goal the clamp binds → a constant-rate crawl, identical
     for every hop; a tall figure takes LONGER instead of moving faster.
     Near the goal the proportional term takes over → the familiar soft
     landing. And because v itself is EASED toward vDesired, retargeting
     mid-flight or starting from rest ramps velocity smoothly instead of
     stepping it — no jerk at step boundaries.

   FORWARD-ONLY
     vDesired is floored at 0: the follower never scrolls up. A goal above
     the current position (the reader is already past it) counts as
     satisfied — the same "revealed steps catch up off-screen" spirit as
     sidebarAbout's seen-gate.

   THE READER ALWAYS WINS
     Any reader input (wheel / touchstart / keydown — real input events,
     deliberately NOT `scroll`, which our own scrollTop writes fire)
     disengages the follower instantly and zeroes v: the machine never
     fights a human hand. Re-engagement happens only through setTarget(),
     and only if the reader has been silent for resumeIdleMs — so callers
     that retarget at their natural boundaries (sidebarAbout: step start /
     step done) get resumption that lands on content beats, never
     mid-gesture. A caller whose boundaries have stopped firing simply
     never resumes — the page belongs to the reader.

   REDUCED MOTION
     Sustained ambient scrolling is squarely what the preference exists
     for. Under prefers-reduced-motion the factory returns an inert twin
     with the same API — callers need no branch, and consumers degrade to
     their pre-follower behavior (reader-driven scroll).

   LIFECYCLE
     The rAF loop runs only while there is work: it parks when the goal is
     reached (or is behind us) and when the reader disengages it — idle
     costs zero, per the off-screen-work-is-zero ethos. Every setTarget
     restarts it if engaged. cancel() parks the loop and removes the
     listeners; it is idempotent, permanent, and shaped for a cancels
     group: `cancels.add(() => follow.cancel())`.

   MEASUREMENT IS THE CALLER'S PROBLEM
     setTarget takes a scrollTop value in pixels, measured however the
     caller likes, as often as it likes. The utility's only concession to
     live layout is re-clamping the goal against scrollHeight every frame,
     so content that grows mid-flight (lazy images decoding below the
     fold) can't strand the goal past the scrollable range.
   ========================================================================== */

export function createSmoothFollow(el, {
  maxVelocity  = 420,    // px/s — crawl ceiling; the one perceived-speed knob
  easeK        = 3.5,    // 1/s — landing gain; braking starts ~(maxVelocity/easeK) px out
  accelK       = 8,      // 1/s — velocity ramp rate; higher = snappier starts/stops
  resumeIdleMs = 2500,   // reader silence required before setTarget may re-engage
} = {}) {

  // Inert twin under reduced motion — same surface, zero writes, nothing
  // to remove on cancel because nothing was attached.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return { setTarget() {}, cancel() {} };
  }

  let target    = 0;           // px goal (only read after a setTarget)
  let v         = 0;           // current velocity, px/s
  let engaged   = true;        // false from reader input until an idle re-engage
  let lastInput = -Infinity;   // performance.now() of the last reader input
  let cancelled = false;       // permanent off switch
  let raf       = 0;           // 0 = loop parked
  let lastT     = 0;

  const onInput = () => {
    engaged   = false;
    lastInput = performance.now();
    v = 0;          // stop dead — never fight the reader's gesture
    stopLoop();
  };
  el.addEventListener("wheel",      onInput, { passive: true });
  el.addEventListener("touchstart", onInput, { passive: true });
  el.addEventListener("keydown",    onInput);

  function stopLoop() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  function ensureLoop() {
    if (raf) return;
    lastT = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function tick(now) {
    raf = 0;
    // dt clamped both ways: a background-tab return delivers one huge
    // frame (unclamped, that frame teleports); and a rAF timestamp can
    // land marginally before the performance.now() taken at schedule
    // time, which unguarded would push v the wrong way for a frame.
    const dt = Math.min(Math.max((now - lastT) / 1000, 0), 0.1);
    lastT = now;

    // Re-clamp every frame: scrollHeight is alive (see header).
    const goal      = Math.min(target, el.scrollHeight - el.clientHeight);
    const remaining = goal - el.scrollTop;

    if (remaining <= 2) {
      // Arrived — or the goal is behind us (forward-only: never scroll
      // up). The 2px arrival band exists because the landing tail's
      // per-frame writes drop below a device pixel, where a browser
      // that rounds scrollTop would strand the loop microns short,
      // easing forever toward a write that never sticks. The closing
      // snap is under 2px — invisible.
      if (remaining > 0) el.scrollTop = goal;
      v = 0;
      return;                       // park; the next setTarget resumes
    }

    const vDesired = Math.min(remaining * easeK, maxVelocity);
    v += (vDesired - v) * (1 - Math.exp(-accelK * dt));
    el.scrollTop += v * dt;

    raf = requestAnimationFrame(tick);
  }

  return {
    /**
     * Set the goal scrollTop, in px. Restarts the parked loop if engaged;
     * while disengaged, re-engages if — and only if — the reader has been
     * idle for resumeIdleMs. Callers should call this at their content
     * boundaries and simply not think about engagement state.
     */
    setTarget(px) {
      if (cancelled) return;
      target = px;
      if (!engaged && performance.now() - lastInput >= resumeIdleMs) {
        engaged = true;             // the reader has gone quiet — resume
      }
      if (engaged) ensureLoop();
    },

    /** Park the loop and detach the listeners. Idempotent, permanent. */
    cancel() {
      cancelled = true;
      stopLoop();
      el.removeEventListener("wheel",      onInput);
      el.removeEventListener("touchstart", onInput);
      el.removeEventListener("keydown",    onInput);
    },
  };
}

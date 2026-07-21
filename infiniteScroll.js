/* =============================================================================
   infiniteScroll.js — the CORE
   -----------------------------------------------------------------------------
   This module owns ONLY the load-bearing infrastructure that every panel type
   and every scene type builds on top of. It knows nothing about any
   particular panel type — types register themselves into it.

   WHAT LIVES HERE
     1. The scroll engine (clones, silent recenter, activeFloat).
     2. The single per-frame loop and the single presence definition.
     3. The PANEL-TYPE REGISTRY — types call registerPanelType() to plug in.
     4. The WEIGHT REGISTRY + HANDOFF GATE — the universal "have all OTHER
        animators finished exiting yet?" primitive. Any panel type or scene
        type registers a weight() callback under its panel index; any
        animator asks isClearToEnter(index) to decide its target.

   WHAT DOES NOT LIVE HERE
     - PANELS (the content array). Authored in main.js; passed to start().
     - Any panel-type-specific DOM, CSS, or per-frame work.
     - Anything about three.js / scenes. (Lives in threeArray.js, which plugs
       in through the frame-hook registry and the read-only views below.)

   CONTRACT FOR EVERYTHING DOWNSTREAM (the rule that protects the core)
     Types only READ activeFloat / presence / dist / isActive / isClearToEnter.
     Types never write activeFloat or presence. The only writer of activeFloat
     is onScroll() below. Honor this and the scroll engine cannot be broken by
     adding a new type.

   COUPLED WITH
     - index.html: requires #infinite-scroller and #infinite-overlays to exist.
     - infiniteStyles.css: emits .infinite-panel + .infinite-overlay and reads
       --shift / opacity / .is-active on overlays. Rename a class here = rename
       it there.
   ========================================================================== */

/* -----------------------------------------------------------------------------
   TUNING CONSTANTS — global, each a single knob.
   --------------------------------------------------------------------------- */
const PAD = 8;            // clone spacers on EACH side of the real panels.
                          //   Bigger = silent recenter happens further from
                          //   what's visible (smoother) at the cost of a
                          //   taller document. A multiple of N keeps clone
                          //   joins aligned.
const FADE = 0.42;        // presence fade completes within this fraction of
                          //   one panel. < 0.5 means the outgoing panel is
                          //   fully gone before the incoming one starts to
                          //   appear. Drives presence[] — the single fade
                          //   definition every type reads.
const HANDOFF_GONE = 0.02;// handoff gate threshold. An animator is "clear to
                          //   enter" only when every OTHER registered weight()
                          //   has fallen below this. Larger = cleaner exits
                          //   before entries (longer empty beat on fast
                          //   scrolls); smaller = quicker handoffs, more
                          //   overlap.

/* -----------------------------------------------------------------------------
   STATE (module-private; reset by start()).
   --------------------------------------------------------------------------- */
let PANELS = [];                  // the single source of truth, set by start()
let N = 0;                        // = PANELS.length
let vh = window.innerHeight;      // one panel = one viewport tall

let scroller = null;              // #infinite-scroller element
let overlaysEl = null;            // #infinite-overlays element
let overlays = [];                // index-aligned with PANELS; one .infinite-overlay each

let activeFloat = 0;              // wrapped scroll position in panels [0, N).
                                  //   THE single value the visual layer reads.
                                  //   onScroll is the ONLY writer.

/* -----------------------------------------------------------------------------
   PANEL-TYPE REGISTRY
   -----------------------------------------------------------------------------
   A type registers itself with:
     registerPanelType("name", { buildDOM, init, tick, selfDrivenOpacity })
   - buildDOM(panel, index) -> HTMLElement
       Returns the type's overlay node. The core appends it to #infinite-overlays
       and sets data-index. The core OWNS the node's --shift / .is-active, and
       its opacity too unless the type declares selfDrivenOpacity (below); all
       core writes are change-detected, so a settled scroll writes nothing. The
       type owns everything else INSIDE the node. Required.
   - init(index, overlay)
       Called once after all overlays are appended. The type wires up listeners,
       reads .clientWidth/Height, etc. Optional.
   - tick(index, overlay, presence_i, dist_i, dt, t)
       Called every frame, AFTER the core's presence-driven writes. A type that
       wants to drive its own opacity (self-driven fade) writes it here —
       last-write-wins. Optional.
   - selfDrivenOpacity: true
       Declares that tick() owns the overlay's opacity. The core then skips its
       presence-driven opacity default for this type's overlays entirely — the
       channel has exactly ONE writer, which is what lets the tick keep a
       settled-value guard (skip the write when its rounded value is unchanged)
       without the core's default leaking through on scroll frames. All five
       live types declare it. Optional; omitting it keeps the zero-per-frame-
       code default for presence-driven types.
   --------------------------------------------------------------------------- */
const panelTypes = new Map();
export function registerPanelType(name, def) {
  if (!def || typeof def.buildDOM !== "function") {
    throw new Error(`registerPanelType("${name}"): buildDOM is required`);
  }
  if (panelTypes.has(name)) {
    console.warn(`Panel type "${name}" already registered; overwriting.`);
  }
  panelTypes.set(name, def);
}

/* -----------------------------------------------------------------------------
   WEIGHT REGISTRY + HANDOFF GATE
   -----------------------------------------------------------------------------
   Any animator that has a visible enter/exit reports its current "visual
   weight" (0..1, 0 = fully exited) to this registry, keyed by its panel index.
   Multiple animators can register under the SAME index (e.g. an overlay's
   fade + its scene's fade — the turn panels do exactly this) — they're
   stored as a list.

   isClearToEnter(index) asks: am I the active panel AND has every OTHER
   registered weight (i.e. every animator NOT at this index) fallen below
   HANDOFF_GONE? If yes, this animator can start its enter. Otherwise it must
   stay at 0 (and so report weight 0, which means it doesn't block anyone
   either — no deadlock).

   This is the SINGLE primitive that sequences "previous exits, THEN next
   enters" across the whole app, at any scroll speed, for any kind of
   animator (HTML overlay, 3D scene, anything).
   --------------------------------------------------------------------------- */
const weightFns = []; // [{ index, fn }, ...]

export function registerWeight(index, fn) {
  if (typeof fn !== "function") throw new Error("registerWeight: fn must be a function");
  const entry = { index, fn };
  weightFns.push(entry);
  // Return an unregister function for symmetry / future dispose paths.
  return () => {
    const i = weightFns.indexOf(entry);
    if (i >= 0) weightFns.splice(i, 1);
  };
}

export function isClearToEnter(index) {
  if (index !== activeIndex()) return false;
  for (let k = 0; k < weightFns.length; k++) {
    const e = weightFns[k];
    if (e.index === index) continue;        // ignore my own animators
    let w = 0;
    try { w = e.fn(); } catch (err) { console.error("weight() threw", err); }
    if (w >= HANDOFF_GONE) return false;
  }
  return true;
}

export function isActive(index) { return index === activeIndex(); }

/* -----------------------------------------------------------------------------
   FRAME-HOOK REGISTRY
   -----------------------------------------------------------------------------
   Anything that needs to run once per frame, AFTER per-type panel ticks, can
   register a hook here. The scene system (threeArray.js) uses this. Future
   consumers — a debug overlay, an FPS counter, anything global — would use it
   too. Keeps the core agnostic: it knows it has hooks to call, but not what
   they do.
     hookFn(dt, t) — called every frame after step (4). Return value ignored.
   --------------------------------------------------------------------------- */
const frameHooks = [];
export function registerFrameHook(fn) {
  if (typeof fn !== "function") throw new Error("registerFrameHook: fn must be a function");
  frameHooks.push(fn);
  return () => {
    const i = frameHooks.indexOf(fn);
    if (i >= 0) frameHooks.splice(i, 1);
  };
}

/* -----------------------------------------------------------------------------
   READ-ONLY VIEWS INTO THE SINGLE SOURCE OF TRUTH
   -----------------------------------------------------------------------------
   The scene system (and future hook consumers) need to ask the core "what
   panel is active?", "what's panel i's presence right now?", and "how many
   panels are there?". These getters expose the live values WITHOUT giving the
   caller any way to write them — preserving Invariant 1 (only onScroll writes
   activeFloat).
   --------------------------------------------------------------------------- */
let lastPresence = [];           // the PUBLISHED presence buffer — the read
                                 //   side of the step-(2) double buffer (see
                                 //   the buffer block above tick()). Swapped,
                                 //   never assigned fresh, by tick() at the
                                 //   step-(4)→(5) boundary; reallocated only
                                 //   in start().
export function getPresence(index) {
  return lastPresence[index] || 0;
}
export function getActiveFloat() { return activeFloat; }
export function getPanelCount()  { return N; }

/* -----------------------------------------------------------------------------
   PROGRAMMATIC SCROLL — drive the scroll state from outside the scroller
   -----------------------------------------------------------------------------
   Some modules (e.g. a panel-type's wheel-forwarding handler over an
   interactive area, future keyboard navigation, deep linking) need to nudge
   the page scroll without the user having physically scrolled. Mutating
   `scroller.scrollTop` flows through the SAME native scroll event +
   onScroll() pipeline as a real wheel scroll — including the wraparound
   recenter and the activeFloat update — so the rest of the system can't
   tell the difference between this and a user wheel.

   Direction follows native wheel semantics: positive delta scrolls "down"
   in document terms, advancing through panels. Modules that want sign
   inversion or scaling do it at the call site.

   No-op if the scroller hasn't been bound yet (i.e., start() hasn't run).
   --------------------------------------------------------------------------- */
export function scrollPageBy(deltaPx) {
  if (!scroller) return;
  scroller.scrollTop += deltaPx;
}

/* -----------------------------------------------------------------------------
   INFINITE SCROLL ENGINE
   -----------------------------------------------------------------------------
   #infinite-scroller holds N real .infinite-panel spacers plus PAD clones on
   each side, as one continuous repeating sequence. We open near the runway
   centre, snapped to panel 0. When the user drifts a full cycle from centre,
   we silently shift scrollTop by one cycle — invisible because clones are
   identical and the reset happens deep in the runway, so momentum is never
   clamped.
   --------------------------------------------------------------------------- */
function cycleHeight() { return N * vh; }
function firstRealTop() { return PAD * vh; }
function centerTop() {
  const total = (PAD + N + PAD) * vh;
  const maxTop = total - vh;
  return Math.round((maxTop / 2) / vh) * vh; // snap to a panel boundary
}

function gotoStart(animated = false) {
  const center = centerTop();
  const centerPanel = ((Math.round((center - firstRealTop()) / vh) % N) + N) % N;
  let delta = 0 - centerPanel;
  delta = ((delta % N) + N) % N;
  if (delta > N / 2) delta -= N;
  scroller.scrollTo({ top: center + delta * vh, behavior: animated ? "smooth" : "auto" });
}

function onScroll() {
  let top = scroller.scrollTop;
  const cycle = cycleHeight();
  const center = centerTop();

  // Silent recenter, only after a full cycle of drift from centre. Clones make
  // it invisible; runway depth keeps it away from the scroll ends so momentum
  // is never clamped.
  if (top < center - cycle + 0.5) {
    top += cycle;
    scroller.scrollTop = top;
  } else if (top > center + cycle - 0.5) {
    top -= cycle;
    scroller.scrollTop = top;
  }

  const rel = (top - firstRealTop()) / vh;
  activeFloat = ((rel % N) + N) % N;
}

// The panel "most on screen" right now = nearest integer to activeFloat, wrapped.
function activeIndex() {
  return ((Math.round(activeFloat) % N) + N) % N;
}

/* -----------------------------------------------------------------------------
   PER-FRAME LOOP
   -----------------------------------------------------------------------------
   ORDER (load-bearing — types that drive their own opacity rely on this):
     (1) compute activeIndex
     (2) compute presence[i] and dist[i] from activeFloat (single definition)
     (3) write each overlay's presence-driven opacity, --shift, .is-active
     (4) for each registered panel type, call its tick() — AFTER step (3) so
         a type can override the opacity it just got (last-write-wins) to
         drive its own self-driven fade.
     (5) call every registered frame hook (dt, t) — AFTER step (4) so a hook
         (e.g. the scene system) sees the freshest panel state.
   --------------------------------------------------------------------------- */
let lastT = 0;

/* Step-(3) change detection — see the comment inside tick(). */
let lastWrittenFloat = NaN;       // activeFloat at the last written frame
let lastWrittenShift = 0;         // viewport height at the last written frame
const lastOpacityStr  = [];       // per-overlay last-written opacity string
const lastActiveState = [];       // per-overlay last-written .is-active bool
const coreOwnsOpacity = [];       // per-overlay: false when the type declared
                                  //   selfDrivenOpacity (filled in buildAll)
const panelDefs = [];             // per-panel RESOLVED type def (filled in
                                  //   buildAll; null when the type is missing).
                                  //   Types are immutable after start(), so the
                                  //   per-frame panelTypes.get(string) lookup in
                                  //   step (4) is resolved once here instead.
                                  //   Consequence to know about: re-registering
                                  //   a type name after start() does NOT
                                  //   retarget existing panels (registration
                                  //   happens at import time, before start —
                                  //   the overwrite path in registerPanelType
                                  //   exists for pre-start collisions only).

/* Step-(2) buffers — double-buffered presence + a dist scratch, allocated once
   in start(). Previously `new Array(N)` ×2 per frame: two allocations + GC
   churn 60×/sec on the hottest path, forever, scaling with panel count.
   WHY TWO presence buffers and not one: the publish contract. `lastPresence`
   (declared with the read-only views above) must keep pointing at the LAST
   COMPLETED frame's values all the way through steps (2)–(4) — a getter
   called from a panel tick reads the previous frame, exactly as it always
   has — and flip to this frame's values only at the step-(4)→(5) boundary.
   A single reused buffer would leak half-written values to mid-frame getter
   calls; the swap preserves the timing contract with zero allocation.
   `dist` is never published, so one scratch suffices. */
let presenceBuf = new Float64Array(0);  // write side; swapped with lastPresence
let distBuf = new Float64Array(0);      // per-frame scratch, never escapes tick()

function tick(rafNow) {
  // rAF's own timestamp: frame-start, vsync-aligned — same time origin as
  // performance.now() (so lastT's start() initialization stays valid), but
  // free of callback-start scheduling jitter. The exponential easings never
  // cared; any fixed-timestep consumer downstream (a locked-rate simulation
  // hosted in a panel or window) turns that jitter into tick-count beats.
  // Frame-start time is simply the more correct dt for every consumer.
  const now = rafNow / 1000;
  const dt = Math.min(now - lastT, 0.05);   // clamp big gaps (hidden tab)
  lastT = now;
  const t = now;

  const SHIFT = vh;                          // overlay travels a full viewport
                                             //   (vh is resize-cached; reading
                                             //   window.innerHeight here would
                                             //   be a per-frame forced-layout-
                                             //   class read for the same value)
  // (2) Fill the reused buffers in place (allocated once in start() — see
  //     the buffer block above for the double-buffer publish contract).
  //     Local aliases keep the rest of this function reading presence[i] /
  //     dist[i] exactly as before.
  const presence = presenceBuf;
  const dist = distBuf;
  for (let i = 0; i < N; i++) {
    let d = i - activeFloat;
    d = ((d % N) + N) % N;
    if (d > N / 2) d -= N;
    dist[i] = d;
    const f = Math.max(0, 1 - Math.abs(d) / FADE);
    presence[i] = f * f * (3 - 2 * f);       // smoothstep
  }

  // (3) Presence-driven writes. For types WITHOUT selfDrivenOpacity, the
  //     opacity default written here keeps them working with zero per-frame
  //     code. Types WITH the flag own their opacity channel in step (4), and
  //     the core doesn't touch it (see the PANEL-TYPE REGISTRY).
  //
  //     CHANGE DETECTION: everything written here derives from exactly two
  //     inputs — activeFloat and SHIFT. If neither moved since the last
  //     written frame (the settled steady state, i.e. most of any session),
  //     every write would re-write an identical value, so the whole block is
  //     skipped and a settled page dirties no style at all from the core.
  //     On dirty frames, --shift genuinely changes for every overlay (written
  //     unconditionally), while the per-overlay caches still skip opacity /
  //     .is-active writes for panels whose rounded values are stable.
  if (activeFloat !== lastWrittenFloat || SHIFT !== lastWrittenShift) {
    const active = activeIndex();
    for (let i = 0; i < N; i++) {
      const ov = overlays[i];
      if (!ov) continue;
      if (coreOwnsOpacity[i]) {
        const op = presence[i].toFixed(3);
        if (op !== lastOpacityStr[i]) {
          ov.style.opacity = op;
          lastOpacityStr[i] = op;
        }
      }
      ov.style.setProperty("--shift", `${(dist[i] * SHIFT).toFixed(1)}px`);
      // The active panel gets .is-active. The presence threshold is very
      // permissive (0.05) — we want the class set whenever the panel is
      // the nearest integer, regardless of whether scroll has settled
      // exactly on its centerpoint. The previous threshold (0.5) caused a
      // subtle interactivity bug: scrolling could rest at a position where
      // a panel was the active integer but presence was below 0.5, leaving
      // .is-active off and the panel's buttons unclickable. 0.05 keeps the
      // mid-transition exclusion (a panel barely fading in shouldn't be
      // interactive yet) while never failing during normal "settled" scroll.
      const isAct = i === active && presence[i] > 0.05;
      if (isAct !== lastActiveState[i]) {
        ov.classList.toggle("is-active", isAct);
        lastActiveState[i] = isAct;
      }
    }
    lastWrittenFloat = activeFloat;
    lastWrittenShift = SHIFT;
  }

  // (4) Per-type per-frame hook. Each registered type runs once per panel of
  //     that type. A type whose entry has no tick() (e.g. a future static
  //     type) simply contributes nothing here. panelDefs[i] is the type def
  //     resolved once in buildAll — same def the Map lookup used to return,
  //     without the per-panel-per-frame string-keyed get.
  for (let i = 0; i < N; i++) {
    const ov = overlays[i];
    if (!ov) continue;
    const def = panelDefs[i];
    if (def && def.tick) {
      try { def.tick(i, ov, presence[i], dist[i], dt, t); }
      catch (e) { console.error(`panel ${i} (${PANELS[i].type}) tick failed`, e); }
    }
  }

  // Publish the frame's presence by SWAPPING the buffers: lastPresence takes
  // this frame's filled buffer; the retired buffer becomes next frame's write
  // side. This is the ONLY write to lastPresence, and it keeps the getters'
  // timing contract bit-identical to the old fresh-allocation scheme —
  // through steps (2)–(4) getters saw the previous frame; from here (step 5,
  // the frame hooks) they see this frame.
  const retired = lastPresence;
  lastPresence = presenceBuf;
  presenceBuf = retired;

  // (5) Frame hooks. Run after panel ticks so consumers see the freshest state.
  //     Each hook is fully isolated — a throwing hook can't take down others.
  for (let k = 0; k < frameHooks.length; k++) {
    try { frameHooks[k](dt, t); }
    catch (e) { console.error("frame hook failed", e); }
  }

  requestAnimationFrame(tick);
}

/* -----------------------------------------------------------------------------
   DOM GENERATION
   -----------------------------------------------------------------------------
   Walks PANELS, dispatches each entry to its registered type's buildDOM(), and
   appends the result into #infinite-overlays. Also emits the .infinite-panel
   spacers into #infinite-scroller. The core owns the overlay node's index
   attribute and its base class; types own the rest.
   --------------------------------------------------------------------------- */
function buildAll() {
  PANELS.forEach((p, i) => {
    // Scroll spacer — one viewport tall, no visible content.
    const section = document.createElement("section");
    section.className = "infinite-panel";
    section.dataset.index = i;
    scroller.appendChild(section);

    // Overlay — built by the registered type.
    const def = panelTypes.get(p.type);
    if (!def) {
      console.warn(`No panel type registered for "${p.type}" at index ${i}; emitting empty overlay.`);
      const fallback = document.createElement("div");
      fallback.className = "infinite-overlay";
      fallback.dataset.index = i;
      overlaysEl.appendChild(fallback);
      overlays.push(fallback);
      coreOwnsOpacity.push(true);
      panelDefs.push(null);   // no def to resolve; step (4) skips this panel
      return;
    }
    const node = def.buildDOM(p, i);
    if (!(node instanceof HTMLElement)) {
      throw new Error(`Panel type "${p.type}" buildDOM did not return an HTMLElement`);
    }
    // The core stamps the data-index and ensures the base class is present.
    // (The type SHOULD include "infinite-overlay" in its classList; we add it
    // defensively so a forgotten class doesn't break overlay positioning.)
    node.dataset.index = i;
    if (!node.classList.contains("infinite-overlay")) node.classList.add("infinite-overlay");
    overlaysEl.appendChild(node);
    overlays.push(node);
    coreOwnsOpacity.push(!def.selfDrivenOpacity);
    panelDefs.push(def);   // resolved once; read by start()'s init pass and
                           //   tick() step (4) — see the panelDefs declaration
  });
}

function buildClones() {
  // Snapshot the real panels BEFORE injecting clones, so cloning sources are
  // exactly the N originals in order.
  const realPanels = Array.from(scroller.querySelectorAll(".infinite-panel"));
  function makeClone(srcIndex) {
    const c = realPanels[srcIndex].cloneNode(true);
    c.dataset.clone = "true";
    return c;
  }
  // Leading clones, inserted before panel 0, in sequence so content is
  // continuous across the join (the panel before "0" looks like "N-1").
  for (let k = PAD; k >= 1; k--) {
    scroller.insertBefore(makeClone((N - (k % N)) % N), realPanels[0]);
  }
  // Trailing clones, appended after the last real panel, also in sequence.
  for (let k = 0; k < PAD; k++) {
    scroller.appendChild(makeClone(k % N));
  }
}

/* -----------------------------------------------------------------------------
   START — the public entry point. Called once from main.js with PANELS.
   --------------------------------------------------------------------------- */
export function start(panels) {
  if (!Array.isArray(panels) || panels.length === 0) {
    throw new Error("start(panels): panels must be a non-empty array");
  }
  PANELS = panels;
  N = PANELS.length;

  // Allocate the step-(2) buffers now that N is known — BOTH presence
  // buffers, so the publish swap rotates two typed arrays (never the
  // module-initial []). Zero-filled: getPresence(i) before the first tick
  // completes returns 0, same as it always did.
  presenceBuf = new Float64Array(N);
  lastPresence = new Float64Array(N);
  distBuf = new Float64Array(N);

  scroller = document.getElementById("infinite-scroller");
  overlaysEl = document.getElementById("infinite-overlays");
  if (!scroller || !overlaysEl) {
    throw new Error("start(): #infinite-scroller and #infinite-overlays must exist");
  }

  buildAll();        // overlays + spacers (one per real panel)
  buildClones();     // clone spacers around the reals

  // Init each type ONCE per panel of that type, AFTER all overlays exist
  // (so a type that wants to query siblings can).
  for (let i = 0; i < N; i++) {
    const def = panelDefs[i];
    if (def && def.init) {
      try { def.init(i, overlays[i]); }
      catch (e) { console.error(`panel ${i} (${PANELS[i].type}) init failed`, e); }
    }
  }

  // Open the page near the runway centre, snapped to panel 0.
  gotoStart(false);

  scroller.addEventListener("scroll", onScroll, { passive: true });

  window.addEventListener("resize", () => {
    const beforeFloat = activeFloat;
    vh = window.innerHeight;
    const center = centerTop();
    const centerPanel = ((Math.round((center - firstRealTop()) / vh) % N) + N) % N;
    let delta = beforeFloat - centerPanel;
    delta = ((delta % N) + N) % N;
    if (delta > N / 2) delta -= N;
    scroller.scrollTop = center + delta * vh;
    onScroll();
  });

  // One initial scroll pass to set activeFloat from the starting position.
  onScroll();

  // Kick off the per-frame loop.
  lastT = performance.now() / 1000;
  requestAnimationFrame(tick);
}
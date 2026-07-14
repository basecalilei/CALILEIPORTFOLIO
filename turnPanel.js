/* =============================================================================
   turnPanel.js — the "turn" PANEL TYPE
   -----------------------------------------------------------------------------
   A free-HTML panel with the same self-driven fade as the "empty" type, plus
   button delegation for THREE named actions:
     data-action="turn"  → invoke "turn" on this panel's scene (a quarter
                           rotation if the scene is turnScene; a no-op if the
                           scene doesn't expose a "turn" action).
     data-action="info"  → open the shared info modal, populated with this
                           panel's `infoHtml` field.
     data-action="grid"  → open the grid modal, populated with this panel's
                           `gridImages` field (an array of { src, full, caption }
                           entries — see gridModal.js for the shape).

   The buttons themselves are authored by the panel's HTML in main.js — this
   type does NOT auto-emit them. That keeps composition flexible: any layout
   the author wants, with any combination of buttons + content, with the
   panel-type's plumbing automatically wired by `data-action` lookup.

   This type ALSO owns a centered DRAG SURFACE (see createDragSurface
   below — a 60vmin square over the model, not viewport-spanning) that
   captures pointermove and calls the scene's `dragRotateBy` action —
   letting the user click and drag the model to rotate it on the Y axis.
   Same self-guarding pattern as the buttons: if the scene doesn't expose
   dragRotateBy, the drag does nothing.

   OPTIONAL CURSOR HOVER ANIMATION (textMarkerHighlight)
     If a turn entry's authored HTML contains a .turn-static wrapper,
     every character inside it gets the marker-highlight hover treatment
     (brand-color background blocks trailing the cursor). Opt-in PER
     ENTRY: entries without the wrapper are untouched — the same silent-
     no-op rule as every other optional hook in this codebase.

     The event plumbing — synthetic MouseEvents, visibility gating,
     wind-down and self-heals — lives in overlayHover.js; read its file
     header for why real mouse events can never drive this (the overlay
     text is pointer-events transparent and must stay so). This panel
     only does the three things that are ITS concern: pick the primitive
     and its tuning (MARKER_OPTS), scope it (the wrapper), and feed grow
     to the driver each frame.

     Scope rule: the wrapper holds STATIC text only. The kicker and the
     .turn-controls buttons sit outside it by design choice; any future
     live readout (a clock, a counter — see dotsPanel's .dots-meta) MUST
     stay outside for correctness, because the primitive takes ownership
     of every text node under its root (textAnimation.md, "when not to
     use"). The buttons keep receiving REAL mouse events (.is-clear
     re-enables their pointer-events) — the real and synthetic streams
     coexist because the primitive listens only on the wrapper, which is
     not an ancestor of the buttons.

   DECOUPLED FROM ANY SCENE TYPE
     The Turn button invokes `invokeSceneAction(i, "turn")` — a self-guarding
     call. If no scene is attached or the scene doesn't define a "turn"
     action, the click is a silent no-op. This means:
       - turnPanel works with no scene at all (other buttons still function,
         Turn button just does nothing — which is fine).
       - turnPanel works with any scene type that exposes a "turn" action,
         not just turnScene.
       - turnScene works with any panel type that invokes its "turn" action,
         not just turnPanel.
     The two are independently swappable.

   MODALS OWNED BY THIS PANEL TYPE
     - The info modal: defined directly in this file. One DOM element
       appended to <body>, shared across all instances of this type.
     - The grid modal: defined in gridModal.js. Imported here and opened
       via openGridModal(images) from the click delegator. The grid modal
       is its own module because it's a substantial UI piece (~600 lines
       of grid logic + the per-image detail sub-modal) that other panel
       types could reasonably want to share if they ever needed an image
       grid affordance.

     Why the info modal stays inline while the grid modal is extracted:
     size and complexity. The info modal is ~50 lines of straightforward
     scaffolding tightly coupled to the turn panel's specific use case.
     The grid modal is a self-contained interactive widget with its own
     run loop and physics.

   COUPLED WITH
     - infiniteScroll.js: registerPanelType, registerWeight, isClearToEnter.
     - threeArray.js: invokeSceneAction (the one coupling point with scenes).
     - gridModal.js: openGridModal (called from the grid button delegator).
     - textMarkerHighlight.js: startMarkerHighlight (published entry point;
       optional — only invoked when an entry authors a .turn-static wrapper).
     - overlayHover.js: attachOverlayHover (the synthetic hover driver).
     - turnStyles.css: emits .turn-overlay, .turn-card, .turn-static,
       .turn-btn, .turn-drag-surface, .turn-info-scrim, .turn-info-sheet,
       .turn-info-close, .turn-info-body.
     - gridStyles.css: emits the grid modal's classes (referenced by
       gridModal.js, not this file).
   ========================================================================== */

import { registerPanelType, registerWeight, isClearToEnter, scrollPageBy } from "./infiniteScroll.js";
import { invokeSceneAction } from "./threeArray.js";
import { openGridModal } from "./gridModal.js";
import { startMarkerHighlight } from "./textMarkerHighlight.js";
import { attachOverlayHover } from "./overlayHover.js";

/* -----------------------------------------------------------------------------
   PANEL-TYPE TUNABLES
   --------------------------------------------------------------------------- */
const FADE_SPEED = 12.0;   // self-driven fade easing rate (s⁻¹). Same as
                           //   emptyPanel.js; consistent feel between types.

// Grow level above which buttons become clickable. The core toggles
// .is-active only on the SINGLE most-centered panel — too strict for
// button interaction, because the panel is visible (and the user expects
// to be able to click) before it's the most-centered one. Gating on grow
// instead means the buttons enable as soon as the panel is sufficiently
// visible, regardless of whether another panel happens to be marginally
// more centered. 0.7 is "clearly present and stable."
const INTERACT_THRESHOLD = 0.7;

// Drag-to-rotate sensitivity: radians of Y-axis rotation per full
// viewport-width of horizontal drag. π = a half turn across the
// viewport — responsive without being twitchy on short drags.
const DRAG_RADIANS_PER_VIEWPORT_WIDTH = Math.PI;

// Release-velocity sampling window. On pointerup we compute angular
// velocity from the pointer's recent motion within this many milliseconds.
// 100ms matches gridModal.js. We also trim the window using `now` at
// release time, so a pause-and-release reports zero velocity (held still
// = no inertia, the iPhone-scroll feel).
const VEL_WINDOW_MS = 100;

// Wheel smoothing — when the user wheels over the drag surface, the
// surface catches the event and we forward to scrollPageBy. A naïve
// instant write feels noticeably snappier than the browser's native wheel
// (which interpolates each tick across several frames). To match the
// surrounding feel, we buffer the deltas and drain them with the same
// exponential ease the rest of the project uses for motion.
//
// At rate r, 95% of one wheel tick's deltaY drains in ~3/r seconds.
// 18 s⁻¹ → ~165ms total — Chrome's ballpark. Higher = closer to instant;
// lower = laggier. Trackpad input (high-frequency small deltas) shows the
// difference most; clicky-wheel input is closer to instant either way.
const WHEEL_SMOOTH_SPEED = 18;

// MARKER_OPTS — tuning for startMarkerHighlight on .turn-static text. One
// radius has to serve two very different type sizes under the same root:
// the title (clamp 2.6–5.4rem — individual glyphs bigger than the radius)
// and the body (clamp 0.82–0.95rem — many glyphs per radius). 30 is the
// compromise: a tight one-to-two-glyph mark on the title, a moderate band
// on the body. dotsPanel uses 22 because its type is uniformly small; the
// density warning in textAnimation.md (textMarkerHighlight section) is the
// tuning reference if either half feels off.
const MARKER_OPTS = {
  waveRadius: 10,
};

/* -----------------------------------------------------------------------------
   PER-INSTANCE STATE
   --------------------------------------------------------------------------- */
const instances = new Map(); // index -> { grow, clear, dragSurface, surfaceBound,
                             //            hover, cancelMarker }

/* -----------------------------------------------------------------------------
   THE SHARED INFO MODAL
   -----------------------------------------------------------------------------
   One modal element shared across all turn-panel instances. Built lazily on
   first use (so this module pays no DOM cost if no panel ever opens it),
   appended to <body> directly (so it isn't constrained by the overlay
   layer's pointer-events:none).

   API (module-private):
     openInfo(html) — fill, show
     closeInfo()    — hide
   --------------------------------------------------------------------------- */
let modalScrim = null;
let modalSheet = null;
let modalBody = null;
let modalCloseBtn = null;
let modalScroll = null;
let modalOpen = false;

function ensureModal() {
  if (modalScrim) return;

  modalScrim = document.createElement("div");
  modalScrim.className = "turn-info-scrim";
  modalScrim.setAttribute("aria-hidden", "true");

  modalSheet = document.createElement("div");
  modalSheet.className = "turn-info-sheet";
  modalSheet.setAttribute("role", "dialog");
  modalSheet.setAttribute("aria-modal", "true");

  modalCloseBtn = document.createElement("button");
  modalCloseBtn.className = "turn-info-close";
  modalCloseBtn.setAttribute("aria-label", "Close info");
  modalCloseBtn.innerHTML = "&times;";

  // The scroll region sits INSIDE the sheet but BELOW the close button in
  // z-order — so the close stays pinned while content scrolls underneath.
  // Module-scoped (not a local const) because openInfo() must reset its
  // scrollTop on every open — see the note there.
  modalScroll = document.createElement("div");
  modalScroll.className = "turn-info-scroll";

  modalBody = document.createElement("div");
  modalBody.className = "turn-info-body";

  modalScroll.appendChild(modalBody);
  modalSheet.appendChild(modalCloseBtn);
  modalSheet.appendChild(modalScroll);
  modalScrim.appendChild(modalSheet);
  document.body.appendChild(modalScrim);

  // Close interactions: × button, scrim click (outside sheet), Esc key.
  modalCloseBtn.addEventListener("click", closeInfo);
  modalScrim.addEventListener("click", (e) => {
    if (e.target === modalScrim) closeInfo();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalOpen) closeInfo();
  });
}

function openInfo(html) {
  const justCreated = !modalScrim;
  ensureModal();
  modalBody.innerHTML = html || "";

  // SCROLL RESET. The modal DOM is built ONCE in ensureModal() and reused by
  // every panel — only modalBody's contents are swapped. Replacing innerHTML
  // does not touch the parent scroller's scrollTop, so a reader who reached
  // the bottom of entry 01 would open entry 02 already scrolled to the bottom.
  //
  // Reset on OPEN, not on close. Two reasons:
  //   1. A closed sheet is still on screen for the length of its slide-out
  //      transition, so resetting in closeInfo() would show the content
  //      visibly snapping to the top as the sheet leaves.
  //   2. Reset-on-open is an invariant ("the sheet always opens at the top")
  //      rather than a cleanup step, so it survives any future code path that
  //      opens the sheet without a close having run first.
  //
  // Safe to write while hidden: the closed scrim is position: fixed with the
  // sheet merely translated off-screen (never display: none), so the scroller
  // still has a layout box and scrollTop is settable here.
  //
  // The media rails inside the body need no reset — innerHTML rebuilds them
  // as fresh nodes on every open, so they always start at 0.
  modalScroll.scrollTop = 0;

  if (justCreated) {
    // FIRST-OPEN FIX: the modal DOM was created in this same synchronous
    // call. If we add .is-open immediately, the browser hasn't yet painted
    // the initial "closed" state (transform: translateY(110%)), so adding
    // .is-open in the same tick collapses the change into a single paint —
    // the transition has no "from" frame to animate from, and the sheet
    // appears to blink in.
    //
    // Force a style flush by reading a layout-triggering property
    // (offsetHeight), then defer the class change one animation frame.
    // After this, the browser has a real "closed" paint to transition from.
    // eslint-disable-next-line no-unused-expressions
    modalScrim.offsetHeight;                  // force layout/style flush
    requestAnimationFrame(() => {
      modalScrim.classList.add("is-open");
      modalOpen = true;
    });
  } else {
    modalScrim.classList.add("is-open");
    modalOpen = true;
  }
}

function closeInfo() {
  if (!modalScrim || !modalOpen) return;
  modalScrim.classList.remove("is-open");
  modalOpen = false;
  // Body contents are not cleared — they're replaced on next open. The CSS
  // transition handles the visual fade-out.
}

/* -----------------------------------------------------------------------------
   BUTTON DELEGATION
   -----------------------------------------------------------------------------
   Buttons within a turn overlay carry `data-action="turn" | "info" | "grid"`.
   One click listener per overlay (attached in init) dispatches by data-action.
   Self-guarding: an unrecognized action is a silent no-op.

   Buttons are click-through (pointer-events:none in CSS) UNLESS their
   overlay has .is-active (the class the core toggles on the centered
   overlay). This is what keeps off-screen buttons from trapping the wheel.
   --------------------------------------------------------------------------- */
function handleClick(panelIndex, panel, e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === "turn") {
    invokeSceneAction(panelIndex, "turn");
  } else if (action === "info") {
    openInfo(panel.infoHtml || "");
  } else if (action === "grid") {
    openGridModal(panel.gridImages || []);
  }
  // Future actions: add an `else if` branch here.
}

/* -----------------------------------------------------------------------------
   DRAG SURFACE — centered input region for rotating the scene's model
   -----------------------------------------------------------------------------
   Appended as a SIBLING of the overlay inside #infinite-overlays — not as
   a child, because .turn-overlay is width:max-content (left-pinned text
   block) and a child wouldn't cover the model area in the center of the
   viewport. Gating mirrors the buttons: pointer-events:auto only when this
   panel's overlay has .is-clear (toggled in lockstep by tick()).

   SIZE AND POSITION ARE CSS, NOT JS — the surface is a centered 60vmin
   square (see .turn-drag-surface in turnStyles.css). Sized to the model's
   on-screen footprint with margin for the idle bob; the rest of the
   viewport stays free so wheel and touch scroll keep working, and the
   buttons on the left aren't covered. (An earlier rev filled the
   viewport; that broke both.)

   Drag math: dx (px) / window.innerWidth × DRAG_RADIANS_PER_VIEWPORT_WIDTH.
   Calls the scene's drag-action trio via the action channel — each is
   self-guarding (a no-op if no scene is attached, or if the scene doesn't
   define the named action):
     pointerdown → dragRotateBegin()             stops any in-flight inertia
     pointermove → dragRotateBy(deltaRadians)    1:1 rotation, no ease
     pointerup   → dragRotateEnd(angularVelocity) hands off release momentum
     pointerenter/leave → probeBegin()/probeEnd()  hover-to-measure: the
              scene extends its plotted-point readout callouts while the
              pointer is over the model (mouse/pen only — touch gets the
              callouts via the scene's dragActive; see turnScene's PROBE
              ANNOTATIONS).

   Release velocity is sampled over the last VEL_WINDOW_MS of pointer
   motion (a rolling window, also trimmed at release time so a held-still
   release reports zero velocity — the iPhone-scroll feel). Pixel velocity
   converts to angular velocity using the same DRAG_RADIANS_PER_VIEWPORT_WIDTH
   constant as the per-move delta, so the inertia feel matches the drag feel.

   setPointerCapture makes the drag sticky: once the pointer is captured,
   subsequent move/up events fire on this element even when the pointer
   leaves it, so dragging out of the surface (or off the viewport)
   doesn't drop the drag.
   --------------------------------------------------------------------------- */
function createDragSurface(panelIndex, overlay) {
  const el = document.createElement("div");
  el.className = "turn-drag-surface";

  let activePointer = null;
  let lastX = 0;
  // Rolling pointer-position history for release-velocity sampling.
  // Each entry is { x, t } — x in clientX px, t in performance.now() ms.
  // Trimmed to VEL_WINDOW_MS on every move (and again at release time, so
  // a held-still release reports zero velocity).
  const velHistory = [];

  el.addEventListener("pointerdown", (e) => {
    // Primary button only for mouse; any touch / pen press is fine.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    activePointer = e.pointerId;
    lastX = e.clientX;
    velHistory.length = 0;
    velHistory.push({ x: e.clientX, t: performance.now() });
    el.setPointerCapture(activePointer);
    el.classList.add("is-dragging");
    // Signal the scene to kill any in-flight release inertia; active drag
    // takes over. Self-guarding via invokeSceneAction.
    invokeSceneAction(panelIndex, "dragRotateBegin");
  });

  el.addEventListener("pointermove", (e) => {
    if (e.pointerId !== activePointer) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    const delta = (dx / window.innerWidth) * DRAG_RADIANS_PER_VIEWPORT_WIDTH;
    invokeSceneAction(panelIndex, "dragRotateBy", delta);

    const now = performance.now();
    velHistory.push({ x: e.clientX, t: now });
    while (velHistory.length > 0 && velHistory[0].t < now - VEL_WINDOW_MS) {
      velHistory.shift();
    }
  });

  function endDrag(e) {
    if (e.pointerId !== activePointer) return;
    el.releasePointerCapture(activePointer);
    activePointer = null;
    el.classList.remove("is-dragging");

    // Re-trim at release time so a held-still release reports zero velocity
    // (the iPhone-scroll behavior). Without this, a long pause between the
    // last move and the release would still impart the stale window's
    // velocity as momentum — which is what gridModal does today and what
    // an iOS scroll explicitly does NOT do.
    const now = performance.now();
    while (velHistory.length > 0 && velHistory[0].t < now - VEL_WINDOW_MS) {
      velHistory.shift();
    }

    // Release angular velocity from the recent motion window. Pixel
    // velocity (px/sec) → angular velocity (rad/sec) uses the same
    // conversion as the per-move delta, so the inertia feel matches the
    // drag feel exactly. dt > 10ms guards against div-by-zero on
    // synthetic events with no real elapsed time.
    let omega = 0;
    if (velHistory.length >= 2) {
      const first = velHistory[0];
      const last = velHistory[velHistory.length - 1];
      const dt_ms = last.t - first.t;
      if (dt_ms > 10) {
        const dx_per_sec = (last.x - first.x) * 1000 / dt_ms;
        omega = (dx_per_sec / window.innerWidth) * DRAG_RADIANS_PER_VIEWPORT_WIDTH;
      }
    }
    invokeSceneAction(panelIndex, "dragRotateEnd", omega);

    // Capture release outside the surface: browsers dispatch the boundary
    // leave after releasing capture, but belt-and-braces — if the pointer
    // ended outside our rect, end the probe explicitly so the callouts
    // can't stick. A duplicate probeEnd is harmless (idempotent flag).
    const r = el.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right ||
        e.clientY < r.top  || e.clientY > r.bottom) {
      invokeSceneAction(panelIndex, "probeEnd");
    }
  }
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);

  // PROBE forwarding — hover-to-measure (see turnScene's PROBE
  // ANNOTATIONS). Mirrors the drag trio's shape exactly: DOM events live
  // here, scene truth lives there, connected through the self-guarding
  // action channel. Mouse and pen only: touch has no hover (enter/leave
  // fire as phantom pairs around taps), and touch users get the callouts
  // while dragging instead — the scene folds dragActive into its probing
  // state, so no touch-specific wiring is needed here.
  el.addEventListener("pointerenter", (e) => {
    if (e.pointerType !== "touch") invokeSceneAction(panelIndex, "probeBegin");
  });
  el.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "touch") invokeSceneAction(panelIndex, "probeEnd");
  });

  // Wheel forwarding with smoothing. Two attach points, ONE shared
  // closure-state buffer:
  //
  //   1. The drag surface itself — catches wheel over the drag area
  //      where the surface is the topmost hit-test target (text inside
  //      the overlay is pointer-events:none and falls through to here,
  //      and empty viewport outside the overlay's content box hits the
  //      surface directly).
  //
  //   2. The overlay — catches wheel that originates on the BUTTONS.
  //      Since the drag surface is inserted BEFORE the overlay in DOM
  //      (so the overlay's stacking context paints above and buttons
  //      remain clickable when the drag rectangle visually overlaps
  //      them — see the insertBefore call in init), wheel events over a
  //      button fire on the button (pointer-events:auto) and BUBBLE up
  //      through .turn-controls → .turn-card → .turn-overlay. Without a
  //      listener on the overlay, those wheels would dead-end on the
  //      button (which doesn't scroll) and the page would freeze. With
  //      it, button-region wheels enter the same smoothing pipeline as
  //      drag-surface-region wheels.
  //
  // Naïve instant write feels noticeably snappier than the browser's
  // native wheel (which interpolates each tick across several frames).
  // To match the surrounding feel we buffer deltas and drain them with
  // the same exponential ease the rest of the project uses for motion.
  //
  // At rate r, 95% of one wheel tick's deltaY drains in ~3/r seconds.
  // Self-running RAF: starts when a wheel arrives, stops when the buffer
  // is near zero, restarts on the next wheel. Frame-rate independent via
  // dt, with a 100ms dt clamp so a backgrounded tab doesn't dump the
  // buffer in a single huge step on return.
  //
  // deltaY only — the scroll is vertical-only, so horizontal wheel input
  // (trackpad two-finger sideways, shift-wheel) is ignored. passive:true
  // because we don't preventDefault — the wheel has no default scroll
  // action on either of these non-scrolling elements.
  let pendingDeltaY = 0;
  let wheelRafId = null;
  let lastFrameTime = 0;

  function drainWheel(now) {
    const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
    lastFrameTime = now;
    const step = pendingDeltaY * (1 - Math.exp(-WHEEL_SMOOTH_SPEED * dt));
    scrollPageBy(step);
    pendingDeltaY -= step;
    // Tail threshold of 0.5px — below this, further drain is sub-pixel
    // and visually identical to stopping. Reset to 0 so a new wheel
    // starts from a clean zero.
    if (Math.abs(pendingDeltaY) > 0.5) {
      wheelRafId = requestAnimationFrame(drainWheel);
    } else {
      pendingDeltaY = 0;
      wheelRafId = null;
    }
  }

  function onWheel(e) {
    pendingDeltaY += e.deltaY;
    if (wheelRafId === null) {
      lastFrameTime = performance.now();
      wheelRafId = requestAnimationFrame(drainWheel);
    }
  }
  el.addEventListener("wheel", onWheel, { passive: true });
  overlay.addEventListener("wheel", onWheel, { passive: true });

  return el;
}

/* -----------------------------------------------------------------------------
   REGISTER WITH THE CORE
   -----------------------------------------------------------------------------
   buildDOM stashes the PANELS entry on the overlay element (via a private
   property) so init can read it. The core doesn't pass `panel` into init —
   it only passes index + overlay — but the panel object IS available in
   buildDOM. Tucking it onto the overlay is the cleanest way to bridge the
   two calls without introducing a side-channel.
   --------------------------------------------------------------------------- */
const PANEL_REF = "__turnPanelRef__";   // private property name on the overlay

registerPanelType("turn", {

  buildDOM(panel /*, index */) {
    const overlay = document.createElement("div");
    overlay.className = "infinite-overlay turn-overlay";
    overlay.innerHTML = `<div class="turn-card">${panel.html || ""}</div>`;

    // WIDTH GHOST for the stacked controls: .turn-controls is sized
    // max-content, and this invisible clone of the kicker becomes its
    // widest child — so the buttons stretch to exactly the kicker's
    // rendered width (same font, same tracking, same text), and the match
    // reflows with font loading for free. Cloned here rather than authored
    // so main.js entries stay clean and the two texts can never drift.
    // Styled by .turn-controls-sizer in turnStyles.css.
    const kicker = overlay.querySelector(".turn-kicker");
    const controls = overlay.querySelector(".turn-controls");
    if (kicker && controls) {
      const sizer = kicker.cloneNode(true);
      sizer.classList.add("turn-controls-sizer");
      sizer.setAttribute("aria-hidden", "true");
      controls.appendChild(sizer);
    }
    // Stash the panel so init can read infoHtml, gridImages, and any other
    // authored fields.
    overlay[PANEL_REF] = panel;
    return overlay;
  },

  init(index, overlay) {
    const panel = overlay[PANEL_REF];
    // `grow` is the fade level (0..1). `clear` mirrors whether grow has
    // crossed INTERACT_THRESHOLD — tracked here so tick() only toggles
    // the .is-clear class on actual transitions, not every frame.
    // `dragSurface` holds the per-instance pointer-capture surface for
    // click-and-drag rotation (see createDragSurface above).
    // `surfaceBound` tracks whether the scene has accepted our drag-surface
    // ref via bindDragSurface — flipped true on the first tick that
    // succeeds, after which we stop trying.
    const state = {
      grow: 0,
      clear: false,
      dragSurface: null,
      surfaceBound: false,
      hover: null,          // overlayHover handle (or null — wrapper absent)
      cancelMarker: null,   // primitive teardown; held for hygiene, no destroy hook exists
    };
    instances.set(index, state);

    // The handoff gate sees this overlay's fade. (The scene attached to the
    // same panel registers its OWN weight separately — both weights at the
    // same index count as one combined exit. See handoffGate.md §3.)
    registerWeight(index, () => state.grow);

    // One click listener for the whole overlay, delegating by data-action.
    overlay.addEventListener("click", (e) => handleClick(index, panel, e));

    // Optional hover-animation hook — opt-in per entry via a .turn-static
    // wrapper in the authored HTML; a missing wrapper is a silent no-op.
    // The primitive starts once and lives for the page (standalone mode —
    // it owns the spans it creates; the core appends the overlay before
    // calling init, so its initial layout reads are real). The hit-test
    // targets .turn-card — a real box; the display:contents wrapper has
    // none. All event plumbing, gating and self-heals live in
    // overlayHover.js.
    const staticEl = overlay.querySelector(".turn-static");
    if (staticEl) {
      state.cancelMarker = startMarkerHighlight(staticEl, MARKER_OPTS);
      state.hover = attachOverlayHover({
        rootEl: staticEl,
        hitEl:  overlay.querySelector(".turn-card"),
      });
    }

    // Drag surface for click-and-drag rotation of this panel's scene model.
    // Sibling of the overlay (see note above createDragSurface). The core
    // guarantees init() runs after every overlay is appended, so
    // overlay.parentNode is reliably #infinite-overlays here.
    //
    // INSERTED BEFORE THE OVERLAY (not appended after). Sibling positioned
    // elements without explicit z-index stack by DOM order: later = higher.
    // By going BEFORE the overlay, the drag surface sits BELOW the
    // overlay's stacking context — so the buttons inside the overlay
    // remain hit-testable even when the drag rectangle visually overlaps
    // them (which happens on narrow viewports where the responsive model
    // and the left-pinned text/buttons share screen real estate).
    //
    // The drag surface still catches pointers + wheel for the empty-area
    // and text-fallthrough cases (text is pointer-events:none and falls
    // through to the surface below). createDragSurface also attaches a
    // wheel listener to this overlay to catch wheels bubbling up from the
    // buttons — see comments there.
    state.dragSurface = createDragSurface(index, overlay);
    overlay.parentNode.insertBefore(state.dragSurface, overlay);
  },

  tick(index, overlay, _presence, _dist, dt /*, t */) {
    const state = instances.get(index);
    if (!state) return;

    // ONE-TIME DRAG-SURFACE BIND. Scenes are built AFTER panel init() runs
    // (main.js calls start() then bootstrapScenes()), so we can't bind in
    // init — the scene doesn't exist yet. By the first tick, scenes have
    // been built synchronously and invokeSceneAction returns true. From
    // then on, the surface's --drag-w / --drag-h are written by the scene
    // on model load and on resize; we never need to touch them again.
    if (!state.surfaceBound) {
      if (invokeSceneAction(index, "bindDragSurface", state.dragSurface)) {
        state.surfaceBound = true;
      }
      // If the scene doesn't expose bindDragSurface (different scene type
      // on a future turn panel, or no scene at all), the CSS fallback of
      // 60vmin in turnStyles.css keeps the surface functional.
    }

    // Self-driven fade — same pattern as emptyPanel.js (see handoffGate.md §4).
    // Ease `grow` toward the gate's verdict; last-write the opacity.
    const target = isClearToEnter(index) ? 1 : 0;
    state.grow += (target - state.grow) * (1 - Math.exp(-FADE_SPEED * dt));
    overlay.style.opacity = state.grow.toFixed(3);

    // Feed the hover driver — it owns the visibility gate, the fade-out
    // wind-down, and the settle self-heal (see overlayHover.js).
    if (state.hover) state.hover.update(state.grow);

    // INTERACTION GATING — independent of .is-active.
    //   The core sets .is-active only on the single most-centered panel,
    //   which is too restrictive for buttons: there's a one-tick window
    //   right after the panel crosses the seam where it's fully visible
    //   (grow=1) but the previous panel is still marginally more centered
    //   and therefore holds .is-active. Result: buttons appear visible
    //   but pointer-events are off, so the first click is silently
    //   dropped.
    //
    //   .is-clear is set when grow crosses INTERACT_THRESHOLD, regardless
    //   of which panel is most centered. Tracked via state.clear so we
    //   only mutate the DOM on the rising/falling edges, not every frame.
    const wantClear = state.grow > INTERACT_THRESHOLD;
    if (wantClear !== state.clear) {
      state.clear = wantClear;
      overlay.classList.toggle("is-clear", wantClear);
      // The drag surface lives outside the overlay (sibling in
      // #infinite-overlays), so CSS combinators on .infinite-overlay.is-clear
      // don't reach it — mirror the class directly here.
      state.dragSurface.classList.toggle("is-clear", wantClear);
    }
  },
});
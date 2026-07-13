/* =============================================================================
   overlayHover.js — synthetic hover driver for pointer-transparent overlays
   -----------------------------------------------------------------------------
   Shared plumbing that lets the cursor-driven text-animation primitives
   (textMarkerHighlight, textHoverWave, textUnderscore, ...) run on text
   inside a panel's HTML overlay. A sibling utility in the same category as
   cancels.js and desktopDraggable.js: feature modules import its one
   published entry point; it imports nothing from the core.

   THE PROBLEM THIS SOLVES
     The interaction primitives listen for REAL mouseenter / mousemove /
     mouseleave on the root element they're given. Panel overlays never
     receive real mouse events: .infinite-overlay is pointer-events: none
     per the base contract, and it must stay that way — #infinite-overlays
     is a SIBLING of the scroller, so re-enabling pointer events on overlay
     content would swallow wheel input over it and kill scrolling exactly
     where the user is reading. (wallPanel.js hit this first and pioneered
     the answer; see its file header for the original design story.)

   THE ANSWER
     Keep the overlay hit-test transparent. Drive the primitives with
     SYNTHETIC MouseEvents instead: one module-level document mousemove
     listener hit-tests the cursor against each attached overlay's box and
     dispatches enter/move/leave straight at the animation root. Events
     dispatched directly at a target fire that target's listeners without
     the element needing to be hit-testable at all — the root can even be
     display: contents (boxless), which is exactly what the scoping
     wrappers are.

   WHAT ONE ATTACHMENT GIVES YOU
     - Hit-testing against hitEl's LIVE rect, read per move — NOT cached.
       This is a deliberate departure from wallPanel's cached-rect
       optimization: the wall's text layer is viewport-fixed with no
       transform, so its rect only changes on resize and caching is sound
       there. Panel overlays carry the --shift transform and slide with
       scroll, so their rects move mid-transition and a cached copy would
       go stale. One getBoundingClientRect on one small element per
       mousemove is cheap; correctness wins.
     - A visibility gate: no events are delivered while the panel's grow
       is at or below VISIBILITY_THRESHOLD. Invisible panels cost one
       comparison per document mousemove and nothing more.
     - Fade-out wind-down: when grow drops through the gate while the
       primitive still thinks the cursor is inside, update() delivers the
       closing mouseleave — the gated move handler can't (it skips
       invisible panels), and mousemove may never fire again anyway if
       the user has stopped moving. update() runs every frame from the
       panel's tick, so the wind-down fires reliably on the first frame
       grow crosses the threshold downward.
     - Settle self-heal: the primitives cache per-character centers,
       recomputed on each mouseenter. If the cursor lands inside while
       the overlay is still easing into place (grow between the gate and
       ~1, --shift still settling), those centers are a few px stale. On
       the rising edge of grow crossing SETTLE_THRESHOLD, update()
       re-dispatches mouseenter to force a recompute against the settled
       layout — the same idiom wallPanel uses after a re-fit. A cursor
       arriving AFTER settle (the common case) never needs it.
     - Resize self-heal: a resize moves clamp()-pinned overlays and can
       reflow their text; if the cursor is inside across the resize, a
       re-dispatched mouseenter refreshes the primitive's centers. (The
       hit-test itself needs no refresh — it reads the live rect.)

   WHAT IT DOES NOT DO
     - It does not start any primitive. The panel type picks which
       primitive(s) to run, with what options, on which root. Multiple
       primitives on the same root all hear the same synthetic events —
       start them all, attach once.
     - It does not scope the animation. Scoping is the wrapper element's
       job, authored in the panel's HTML (see textAnimation.md,
       "Interaction primitives on panel overlays"). The correctness rule
       lives there too: never include text that other code mutates at
       runtime (live clocks, counters) — a span-owning primitive and a
       textContent writer corrupt each other.
     - It does not serve wallPanel. The wall's needs — four-way quadrant
       routing, a cached rect justified by a transform-free fixed layout,
       idle-chunked init over ~4,500 characters — are beyond this module's
       scope on purpose. This is the simple-case distillation of the
       wall's design, for ordinary card-sized overlays. If a future panel
       needs zone routing, look at wallPanel, not here.

   SYNTHETIC EVENTS DON'T BUBBLE. mouseenter/mouseleave never do;
   mousemove is constructed without bubbles here, matching the family
   convention wallPanel established (a bubbling synthetic move can trip
   the deferred-enter fallback of primitives listening on ancestor
   roots). With single-root attachments nothing would break today, but
   the convention costs nothing and keeps dispatch semantics uniform
   across the codebase.

   MOUSE-ONLY, like the interaction-primitive family itself. On touch
   devices no mousemove stream exists and the text is simply static.

   USAGE (from a panel type)
     import { attachOverlayHover } from "./overlayHover.js";

     // init(), after starting the primitive(s) on rootEl:
     state.hover = attachOverlayHover({
       rootEl: staticEl,   // dispatch target — the animation root
       hitEl:  cardEl,     // real box to hit-test (rootEl may be boxless)
     });

     // tick(), every frame, after easing grow:
     if (state.hover) state.hover.update(state.grow);

     // teardown (no panel destroy hook exists today; held for hygiene):
     state.hover.detach();

   COUPLED WITH
     - Nothing. No core imports, no primitive imports. Consumers:
       dotsPanel.js, turnPanel.js (and any future overlay that wants
       hover-animated text).
   ========================================================================== */

/* -----------------------------------------------------------------------------
   TUNABLES
   --------------------------------------------------------------------------- */

// Grow value above which synthetic hover events are delivered. Below it,
// the panel is more faded than not, and hovering invisible text would
// animate nothing the user can see while still costing rAF work. Same
// value and rationale as wallPanel's HOVER_VISIBILITY_THRESHOLD.
const VISIBILITY_THRESHOLD = 0.5;

// Grow value treated as "the entry is finished" — the trigger for the
// settle self-heal described in the header. Rising-edge only; one extra
// center recompute per panel entry, and only when the cursor was already
// inside while the overlay was still moving.
const SETTLE_THRESHOLD = 0.98;

/* -----------------------------------------------------------------------------
   MODULE STATE — one listener set for ALL attachments across ALL panel types
   --------------------------------------------------------------------------- */

const hovers = new Set();      // active attachments: { rootEl, hitEl, grow, inside, wasSettled }
let lastCursorX = -10000;
let lastCursorY = -10000;
let listenersAttached = false;

/* -----------------------------------------------------------------------------
   DISPATCH HELPERS
   --------------------------------------------------------------------------- */

function dispatchTo(h, type) {
  h.rootEl.dispatchEvent(
    new MouseEvent(type, { clientX: lastCursorX, clientY: lastCursorY }),
  );
}

// Bring h.inside to `inside`, dispatching the matching boundary event on
// the transition. Covers enter-from-outside, leave-to-outside, and forced
// wind-downs from update() and the document mouseleave handler. The
// primitives recompute their per-character centers on every enter, so each
// transition into the box also refreshes their layout picture.
function setInside(h, inside) {
  if (h.inside === inside) return;
  h.inside = inside;
  dispatchTo(h, inside ? "mouseenter" : "mouseleave");
}

/* -----------------------------------------------------------------------------
   DOCUMENT-LEVEL LISTENERS
   --------------------------------------------------------------------------- */

function onDocMouseMove(e) {
  lastCursorX = e.clientX;
  lastCursorY = e.clientY;

  for (const h of hovers) {
    // Gate first — an invisible panel does no further work per move.
    // (h.inside can't survive grow dropping below the threshold: the
    // panel's per-frame update() winds it down.)
    if (h.grow <= VISIBILITY_THRESHOLD) continue;

    // LIVE rect read — see the file header for why this isn't cached.
    const r = h.hitEl.getBoundingClientRect();
    const inside =
      lastCursorX >= r.left && lastCursorX <= r.right &&
      lastCursorY >= r.top  && lastCursorY <= r.bottom;

    setInside(h, inside);

    // Mousemove on the root every move while inside, so the primitive's
    // proximity field tracks the cursor smoothly.
    if (inside) dispatchTo(h, "mousemove");
  }
}

// Cursor exits the document entirely. The cursor can leave while its last
// in-document position was inside a box; without the explicit reset the
// primitive would lock at "still here" and its loop would keep running
// until the cursor returned.
function onDocMouseLeave() {
  for (const h of hovers) setInside(h, false);
}

// Resize self-heal — see the file header.
function onWindowResize() {
  for (const h of hovers) {
    if (h.inside) dispatchTo(h, "mouseenter");
  }
}

function ensureListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  document.addEventListener("mousemove", onDocMouseMove, { passive: true });
  document.addEventListener("mouseleave", onDocMouseLeave);
  window.addEventListener("resize", onWindowResize);
}

/* -----------------------------------------------------------------------------
   PUBLIC API
   --------------------------------------------------------------------------- */

/**
 * Attach synthetic hover driving to an overlay region.
 *
 * @param {Object}      opts
 * @param {HTMLElement} opts.rootEl  dispatch target — the element the
 *                                   primitive(s) were started on. May be
 *                                   display: contents (boxless).
 * @param {HTMLElement} opts.hitEl   the real box to hit-test the cursor
 *                                   against (typically the panel's card).
 *                                   Slightly larger than the animated text
 *                                   is fine — the primitives' proximity
 *                                   falloff, not the hit-test, decides
 *                                   which characters light up.
 * @returns {{ update(grow: number): void, detach(): void }}
 */
export function attachOverlayHover({ rootEl, hitEl }) {
  const h = { rootEl, hitEl, grow: 0, inside: false, wasSettled: false };
  hovers.add(h);
  ensureListeners();

  return {
    // Call every frame from the panel's tick, after easing grow. Stores
    // grow for the move handler's gate and runs the two per-frame
    // behaviors: fade-out wind-down and the settle self-heal.
    update(grow) {
      h.grow = grow;
      if (grow <= VISIBILITY_THRESHOLD) {
        setInside(h, false);
        h.wasSettled = false;      // re-arm the settle heal for the next entry
      } else {
        const settled = grow >= SETTLE_THRESHOLD;
        if (settled && !h.wasSettled && h.inside) {
          dispatchTo(h, "mouseenter");
        }
        h.wasSettled = settled;
      }
    },

    // Stop driving this attachment. Delivers the closing mouseleave if the
    // primitive thinks the cursor is inside, so it can decay cleanly. Does
    // NOT cancel the primitive(s) — the caller owns those.
    detach() {
      setInside(h, false);
      hovers.delete(h);
    },
  };
}

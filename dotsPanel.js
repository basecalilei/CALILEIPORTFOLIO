/* =============================================================================
   dotsPanel.js — the "dots" PANEL TYPE
   -----------------------------------------------------------------------------
   A minimal overlay panel for the "dots" scene: authored HTML inside a top-
   left-pinned block, with the same self-driven fade that emptyPanel.js uses.
   No buttons, no actions — the only user interactivity is the cursor (the
   scene's wake, see dotsScene.js, and the hover highlight below). The panel
   and the scene are independently swappable: dotsPanel works with no scene
   at all, and dotsScene works with any panel type that happens to share its
   index.

   OPTIONAL LIVE READOUTS
     If the authored HTML contains a .dots-time element, it gets written
     with the local clock (HH:MM:SS) and refreshed once per second. If it
     contains a .dots-session element, it gets a 4-hex-digit session ID
     once at init. Both hooks are entirely optional — when absent the panel
     behaves exactly as before. See SESSION_ID and formatTime below.

   OPTIONAL CURSOR HOVER ANIMATION (textMarkerHighlight)
     If the authored HTML contains a .dots-static wrapper, every character
     inside it gets the marker-highlight hover treatment (brand-color
     background blocks trailing the cursor). Same optional-hook rule as the
     readouts: no wrapper, no animation, no error.

     The event plumbing — synthetic MouseEvents, visibility gating,
     wind-down and self-heals — lives in overlayHover.js; read its file
     header for why real mouse events can never drive this (the overlay
     is pointer-events transparent by base contract and must stay so).
     This panel only does the three things that are ITS concern: pick the
     primitive and its tuning (MARKER_OPTS), scope it (the wrapper), and
     feed grow to the driver each frame.

     The wrapper's scoping is load-bearing, not aesthetic: the primitive
     walks every text node under the root it's given and takes ownership
     of them (standalone mode — it replaces text nodes with per-character
     spans). The .dots-meta lines must therefore live OUTSIDE the wrapper
     — tick() rewrites .dots-time's textContent every second, and
     rewriting text a primitive has span-ified corrupts the primitive's
     span bookkeeping (textAnimation.md, "when not to use"). The kicker
     sits outside too, by design choice.

   DECOUPLED FROM ANY SCENE TYPE
     dotsPanel never imports dotsScene. The only thing tying them together
     in a PANELS entry is `scene: "dots"` (or fullscreen form). If the scene
     is absent or renamed, the overlay still fades in/out cleanly via the
     handoff gate — there's just no particle field behind it.

   COUPLED WITH
     - infiniteScroll.js: registerPanelType, registerWeight, isClearToEnter
     - textMarkerHighlight.js: startMarkerHighlight (published entry point;
       optional — only invoked when main.js authors a .dots-static wrapper)
     - overlayHover.js: attachOverlayHover (the synthetic hover driver)
     - dotsStyles.css: emits .dots-overlay, .dots-card, .dots-static (the
       display:contents animation root) and the dots-* typography classes
       used inside the panel's authored HTML (including .dots-meta for the
       live readout lines).
   ========================================================================== */

import { registerPanelType, registerWeight, isClearToEnter } from "./infiniteScroll.js";
import { startMarkerHighlight } from "./textMarkerHighlight.js";
import { attachOverlayHover } from "./overlayHover.js";

/* -----------------------------------------------------------------------------
   PANEL-TYPE TUNABLES
   --------------------------------------------------------------------------- */
const FADE_SPEED = 20.0;   // overlay fade-easing rate (s⁻¹). Same as
                           //   emptyPanel.js / turnPanel.js — consistent
                           //   feel across all overlay fades. NOTE: the
                           //   scene's grow eases slower (GROW_SPEED = 6.0
                           //   in dotsScene.js) on purpose — the particle
                           //   field "settles in" while the text snaps a
                           //   little quicker. Combined weights are reported
                           //   under the same panel index so the gate sees
                           //   both as one combined exit.

// MARKER_OPTS — tuning for startMarkerHighlight. The default waveRadius (35)
// is sized for larger type; textAnimation.md specifically flags marker as
// the densest-feeling primitive per lit char, and the dots block is small
// type in a narrow ~34ch column — at 35 the wake reads as a blob rather
// than a highlighter stroke. 22 keeps the band roughly one-word-wide at
// .dots-body's size. Colors stay the full default brand palette; nothing
// inside .dots-static uses a brand color for text (the green kicker sits
// outside the wrapper), so there's no same-on-same contrast trap.
const MARKER_OPTS = {
  waveRadius: 22,
};

/* -----------------------------------------------------------------------------
   SESSION ID — generated once per page load, as a random 16-bit number
   formatted as four uppercase hex digits. Module-scope on purpose: a
   "session" is per-tab, not per-instance, so every dots panel instance on
   the page reads the same ID. Refresh the page to roll a new one. If any
   other panel type ever wants the same ID, lift this into a shared
   session.js module — premature today.
   --------------------------------------------------------------------------- */
const SESSION_ID = Math.floor(Math.random() * 0x10000)
  .toString(16)
  .toUpperCase()
  .padStart(4, "0");

/* -----------------------------------------------------------------------------
   TIME FORMATTING — HH:MM:SS local time. Called every frame from tick(); the
   panel only writes to the DOM when the formatted string actually changes
   (cached in state.lastTimeString), so the cost is one Date allocation +
   string format per frame and a DOM write at most once per second.
   --------------------------------------------------------------------------- */
function formatTime(d = new Date()) {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/* -----------------------------------------------------------------------------
   PER-INSTANCE STATE
   --------------------------------------------------------------------------- */
const instances = new Map();   // index -> {
                               //   grow, timeEl, lastTimeString,   — fade + readouts
                               //   hover,                          — overlayHover handle (or null)
                               //   cancelMarker,                   — primitive teardown (held for hygiene;
                               // }                                     panels currently live for the page)

/* -----------------------------------------------------------------------------
   REGISTRATION
   --------------------------------------------------------------------------- */
registerPanelType("dots", {
  // tick() owns this overlay's opacity; the core skips its presence default.
  selfDrivenOpacity: true,


  buildDOM(panel /*, index */) {
    const overlay = document.createElement("div");
    overlay.className = "infinite-overlay dots-overlay";
    overlay.innerHTML = `<div class="dots-card">${panel.html || ""}</div>`;
    return overlay;
  },

  init(index, overlay) {
    const state = {
      grow: 0,
      timeEl: null,
      lastTimeString: "",
      hover: null,
      cancelMarker: null,
    };
    instances.set(index, state);

    // Find optional live-readout hooks in the authored HTML. Both queries
    // can return null and that's fine — the panel works either way; the
    // readouts only appear if main.js authored them. Same "decoupled by
    // default" rule the rest of the project follows: a missing thing is a
    // silent no-op.
    state.timeEl = overlay.querySelector(".dots-time");
    const sessionEl = overlay.querySelector(".dots-session");
    if (sessionEl) sessionEl.textContent = SESSION_ID;

    // Optional hover-animation hook — same silent-no-op rule. The primitive
    // starts once here and lives for the page (standalone mode; it owns the
    // spans it creates). No idle-deferral needed: the wall span-ifies ~4,500
    // characters, this block is ~80. Its init-time center computation runs
    // against the real layout (the core appends the overlay before calling
    // init) and is refreshed on every synthetic enter anyway, which also
    // absorbs late font swaps. The hit-test targets .dots-card — a real
    // box; the display:contents wrapper has none.
    const staticEl = overlay.querySelector(".dots-static");
    if (staticEl) {
      state.cancelMarker = startMarkerHighlight(staticEl, MARKER_OPTS);
      state.hover = attachOverlayHover({
        rootEl: staticEl,
        hitEl:  overlay.querySelector(".dots-card"),
      });
    }

    // Register our weight with the handoff gate. The dots scene (if present)
    // registers its OWN weight separately under the same index — see
    // handoffGate.md §3. Both must drop below HANDOFF_GONE before another
    // panel can enter, which is correct: this panel is "still here" as long
    // as either its text OR its particle field is visible.
    registerWeight(index, () => state.grow);
  },

  tick(index, overlay, _presence, _dist, dt /*, t */) {
    const state = instances.get(index);
    if (!state) return;

    // Self-driven fade — ease `grow` toward the gate's verdict, write opacity
    // only when the rounded value changed (settled panels write nothing).
    // Safe because this type declares selfDrivenOpacity: the core skips its
    // opacity default here, so this tick is the channel's ONLY writer and the
    // cache is the DOM truth. lastOpacity starts undefined -> first frame
    // always writes. Same pattern as emptyPanel.js (see handoffGate.md §4).
    const target = isClearToEnter(index) ? 1 : 0;
    state.grow += (target - state.grow) * (1 - Math.exp(-FADE_SPEED * dt));
    const op = state.grow.toFixed(3);
    if (op !== state.lastOpacity) {
      overlay.style.opacity = op;
      state.lastOpacity = op;
    }

    // Feed the hover driver — it owns the visibility gate, the fade-out
    // wind-down, and the settle self-heal (see overlayHover.js).
    if (state.hover) state.hover.update(state.grow);

    // Live clock. We format every frame but only write to the DOM when the
    // displayed string actually changes — cheap string comparison, DOM
    // write at most 1×/second. Running unconditionally (not gated on
    // presence) means the time is always correct the instant the user
    // scrolls back to the panel, not "correct as of one frame from now."
    // NOTE this write is exactly why .dots-meta lives outside .dots-static
    // — see the file header.
    if (state.timeEl) {
      const next = formatTime();
      if (next !== state.lastTimeString) {
        // Update afterglow on the MINUTE rollover only. The seconds tick
        // is effectively continuous — glowing every write would be a
        // permanent light, exactly the "skip continuously-varying values"
        // case in visualLanguage.md — but the minute field changing is a
        // discrete event worth announcing: the readout flashes the write
        // color and decays back to its ink (CSS owns the decay; see
        // dotsStyles.css). Remove → reflow → re-add restarts the
        // animation even though the class remains from the previous
        // rollover — same retrigger idiom as the shop gate's shake. The
        // very first paint also flashes ("" never matches on HH:MM),
        // which reads as the instrument coming alive; intentional.
        if (next.slice(0, 5) !== state.lastTimeString.slice(0, 5)) {
          state.timeEl.classList.remove("is-fresh");
          void state.timeEl.offsetWidth;
          state.timeEl.classList.add("is-fresh");
        }
        state.timeEl.textContent = next;
        state.lastTimeString = next;
      }
    }
  },
});

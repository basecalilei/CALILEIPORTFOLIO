/* =============================================================================
   sidebarEthos.js — the "ethos" view of the sidebar
   -----------------------------------------------------------------------------
   A simple content view holding the design ethos / design statement.
   Structurally mirrors sidebarAbout (title + body, content authored inline
   in this module), and runs the same layered animation lifecycle.

   LAYERED ANIMATION LIFECYCLE
     This view runs two animation primitives in parallel on each element:
       - textTypewriter: the entry animation, characters revealing
         sequentially with organic timing, reveal-flashes in brand colors
         that snap to ink.
       - textHoverWave: the interaction animation, a cursor-driven spatial
         wave that lights characters in brand colors as the cursor passes.

     Both start at t=0 in onEnter. The typewriter walks text nodes and
     creates per-character spans (it owns them, initially with
     `visibility: hidden`); the hover wave auto-detects the pre-existing
     spans and runs in "layered mode" — borrowing the spans.

     Hover's color writes can act on characters that haven't been
     revealed yet (visibility: hidden) — the colors are set on invisible
     spans, becoming visible when the typewriter reveals each char.
     This produces a subtle effect: as the user moves the cursor over
     text that's still about to be typed, those chars may appear in
     hover's color at the moment of reveal, as if hover "primed" them.
     Not a bug — it's a nice side effect of the layered architecture
     and disappears naturally once typing is complete.

     How color writes coexist (same mechanism as sidebarAbout):
       - Typewriter ticks first each frame (registered first in the
         cancels group). It writes flash colors on reveal, clears them
         after flashDurationMs.
       - Hover ticks second. For chars hover wants lit, it overrides
         the typewriter's flash color (or any cleared color) with its
         own tint, in per-frame writes while lit.
       - On hover release, hover clears the inline color. If the
         typewriter is still managing this char (mid-flash), its next
         tick decides. If post-flash, the clear leaves the char in ink,
         which is correct.

     The user can now hover during typewriter — characters near the
     cursor light up in hover's tints while the typewriter continues
     revealing characters elsewhere.

   COUPLED WITH
     - sidebarEthosStyles.css: emits .sidebar-view-ethos and inner classes.
     - sidebar.js: imports `ethosView` and includes it in initSidebar.
     - textTypewriter.js: provides startTypewriter (entry).
     - textHoverWave.js: provides startHoverWave (interaction, layered mode).
   ========================================================================== */

import { startTypewriter }   from "./textTypewriter.js";
import { startHoverWave }    from "./textHoverWave.js";
import { createCancelGroup } from "./cancels.js";

/* -----------------------------------------------------------------------------
   MODULE-LEVEL STATE
   --------------------------------------------------------------------------- */

const cancels = createCancelGroup();

const HOVER_WAVE_RADIUS = 5;

/* -----------------------------------------------------------------------------
   THE VIEW
   --------------------------------------------------------------------------- */

export const ethosView = {
  name: "ethos",

  buildDOM(nav) {
    const el = document.createElement("div");
    el.className = "sidebar-view-ethos";
    el.innerHTML = `
      <h2 class="sidebar-ethos-title">Ethos</h2>
      <div class="sidebar-ethos-body">
        <p>
          > CAL.CALILEI
          <br>
          > DESIGN.STATEMENT
          <br>
          -------------------------
          <br>
          <br>
          > <strong>I am driven by a deep curiosity for the intelligence woven into geometry, mathematics, and the laws of physics.</strong>
          <br>
          <br>
          > The genius systems that govern physical reality.
          <br>
          <br>
          > The substrate reveals elegance that feels both boundless and intentional.
          <br>
          <br>
          > I find endless inspiration in natural design; that which is functional, and intrinsically beautiful.
          <br>
          <br>
          > This beauty motivates me to learn, experiment, and seek mastery.
          <br>
          <br>
          > <strong>I design to honor the logic, order, artistry, and Creator, of these systems.</strong>
        </p>
        
      </div>
    `;
    return el;
  },

  onEnter(el) {
    cancels.cancelAll();
    const title = el.querySelector(".sidebar-ethos-title");
    const body  = el.querySelector(".sidebar-ethos-body");

    // Typewriters registered first → tick first each frame → produce the
    // baseline color (reveal flashes or ink) that hover then overrides
    // for chars near the cursor.
    if (title) cancels.add(startTypewriter(title));
    if (body)  cancels.add(startTypewriter(body));

    // Hovers registered second → tick after typewriters → write their
    // tints last each frame for lit chars. Layered mode auto-detected.
    if (title) cancels.add(startHoverWave(title, { waveRadius: HOVER_WAVE_RADIUS }));
    if (body)  cancels.add(startHoverWave(body,  { waveRadius: HOVER_WAVE_RADIUS }));
  },

  onExit() {
    cancels.cancelAll();
  },
};

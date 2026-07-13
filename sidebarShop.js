/* =============================================================================
   sidebarShop.js — the "shop" view of the sidebar
   -----------------------------------------------------------------------------
   A simple content view with a back button, heading, and body text.
   Authoring the content directly in this module is intentional: views own
   their own content (it's not reusable across contexts), and a fresh file
   with full HTML/CSS control is the easiest way to author a view that
   doesn't follow a generic template.

   LAYERED ANIMATION LIFECYCLE
     This view runs two animation primitives in parallel on each element:
       - textScramble: the entry animation, cycling glyphs and brand-color
         flicker that resolves to the authored text over ~1.1s.
       - textHoverWave: the interaction animation, a cursor-driven spatial
         wave that lights characters in brand colors as the cursor passes.

     Both start at t=0 in onEnter. The scramble primitive walks text
     nodes and creates per-character spans (it owns them); the hover
     primitive auto-detects the pre-existing spans and runs in "layered
     mode" — borrowing the spans, writing colors that override scramble's
     where the cursor is near, leaving scramble's writes visible
     elsewhere.

     How they coexist on the same `span.style.color`:
       - Both primitives have rAF callbacks. The browser fires them in
         registration order each frame, all before paint.
       - Scramble is added to the cancels group first → registers its
         rAF first → ticks first each frame.
       - Hover ticks second, writing its colors AFTER scramble's. The
         paint shows hover's last-applied state for characters hover
         touched, scramble's state for characters hover didn't touch.
       - On hover release (cursor moves away from a character), hover
         clears the inline color. If scramble is still cycling that
         character, its next tick restores its own color — the char
         briefly shows ink for one tick at most, visually subsumed by
         scramble's existing chaos. After scramble naturally completes,
         hover is the sole color authority.

     Visual result: where the cursor passes during the scramble, the
     cycling glyphs appear in hover's tints rather than scramble's
     flicker colors. As the cursor moves, the colored zone follows. The
     two effects feel like one combined animation responding to both
     time (scramble's reveal) and cursor (hover's wake).

     Re-entry and view-exit work via the cancels group as before. The
     order of cancellation matters: scramble cancels first (restoring
     text nodes), hover cancels second (detecting spans are gone, just
     removing listeners). The cancels group iterates in insertion
     order, and we insert in this order intentionally.

   COUPLED WITH
     - sidebarShopStyles.css: emits .sidebar-view-shop and inner classes.
     - sidebar.js: imports `shopView` and includes it in initSidebar.
     - textScramble.js: provides startScramble (entry).
     - textHoverWave.js: provides startHoverWave (interaction, layered mode).
   ========================================================================== */

import { startScramble }     from "./textScramble.js";
import { startHoverWave }    from "./textHoverWave.js";
import { createCancelGroup } from "./cancels.js";

/* -----------------------------------------------------------------------------
   MODULE-LEVEL STATE
   -----------------------------------------------------------------------------
   Single cancels group holds both the entry and hover cancels for both
   elements (title and body) — four entries total during a view session.
   Order of insertion is significant for cancel ordering: scrambles first,
   hovers second, so on cancelAll the scramble's DOM restore runs before
   hover's listener removal (which doesn't need the spans anymore at that
   point). See the file header for the full lifecycle rationale.
   --------------------------------------------------------------------------- */

const cancels = createCancelGroup();

// Wave radius for the hover layer. The primitive's default is 50;
// smaller reads as more focal/subtle, which suits permanent body copy
// and pairs cleanly with the brand-color flicker of scramble.
const HOVER_WAVE_RADIUS = 5;

/* -----------------------------------------------------------------------------
   THE VIEW
   --------------------------------------------------------------------------- */

export const shopView = {
  name: "shop",

  buildDOM(nav) {
    const el = document.createElement("div");
    el.className = "sidebar-view-shop";
    el.innerHTML = `
      <h2 class="sidebar-shop-title">Shop</h2>
      <div class="sidebar-shop-body">
        <p>
          Placeholder copy for the Shop view. Edit this directly in
          sidebarShop.js — the HTML is authored inline since the content
          is owned by this view module.
        </p>
        <p>
          Replace this paragraph with actual content, add elements freely,
          or restructure however you like. The view is just a DOM subtree;
          the shell doesn't care about its shape.
        </p>
      </div>
    `;

    return el;
  },

  onEnter(el) {
    cancels.cancelAll();
    const title = el.querySelector(".sidebar-shop-title");
    const body  = el.querySelector(".sidebar-shop-body");

    // Scrambles registered first → tick first each frame → produce the
    // baseline color that hover then overrides for chars near the cursor.
    if (title) cancels.add(startScramble(title));
    if (body)  cancels.add(startScramble(body));

    // Hovers registered second → tick after scrambles → write their
    // tints last each frame for lit chars. Layered mode is auto-
    // detected from the per-char span structure scramble produces.
    if (title) cancels.add(startHoverWave(title, { waveRadius: HOVER_WAVE_RADIUS }));
    if (body)  cancels.add(startHoverWave(body,  { waveRadius: HOVER_WAVE_RADIUS }));
  },

  onExit() {
    cancels.cancelAll();
  },
};

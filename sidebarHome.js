/* =============================================================================
   sidebarHome.js — the "home" view of the sidebar
   -----------------------------------------------------------------------------
   The menu landing view: a list of buttons that navigate to other registered
   views. Buttons here are hardcoded to specific sibling view names — this
   view IS the sibling-router of the sidebar, so it's the one place where
   knowledge of which other views exist is acceptable.

   If a referenced view name isn't registered (e.g. the About view module was
   deleted but the button here wasn't removed), nav() logs a warning and does
   nothing — silent failure rather than a crash, same as how the rest of the
   project handles missing things.

   Click delegation: a single listener on the view root catches every button
   click via data-target. Adding new entries means adding HTML with a
   data-target attribute; no new listener registration needed.

   THE SHOP GATE (exception to plain nav)
     The .SHOP item is NOT a data-target button — it carries data-shop-trigger
     instead, so the delegated nav handler ignores it. sidebarShopGate.js
     takes over its click and unfolds a soft password prompt beneath it;
     entering the key calls nav("shop"). The gate is a separate, deletable
     module — to remove it, delete sidebarShopGate.js + its stylesheet + its
     <link>, drop the import and createShopGate() call below, and restore the
     button to `data-target="shop"`. See that file's header.

   ENTER ANIMATION
     On every entry, each .sidebar-home-item runs an independent
     text-scramble (via textScramble.js's startScramble). Each item gets a
     longer duration than the previous so they lock in top-to-bottom — a wave
     of resolution down the menu. Re-entry replays from scratch — cancelAll
     in onExit stops any in-flight scrambles and restores the DOM.

   COUPLED WITH
     - sidebarHomeStyles.css: emits .sidebar-view-home and its inner classes.
     - sidebar.js: imports `homeView` and includes it in initSidebar's views.
     - textScramble.js: provides the startScramble primitive used in onEnter.
     - sidebarShopGate.js: provides createShopGate for the .SHOP soft gate.
   ========================================================================== */

import { startScramble }     from "./textScramble.js";
import { createCancelGroup } from "./cancels.js";
import { createShopGate }    from "./sidebarShopGate.js";

/* -----------------------------------------------------------------------------
   HOVER COLOR POOL
   -----------------------------------------------------------------------------
   A random brand color is picked on every mouseenter of a .sidebar-home-item
   and set as the --hover-color custom property on that button; the CSS
   :hover rule reads var(--hover-color, var(--brand-blue)). Values are
   var(...) references rather than resolved hex so the palette stays in
   sync with whatever's defined in infiniteStyles.css.

   Same palette as textScramble's color tint — unifies the feel across the
   menu's two interaction states (hover and scramble-in). Change here if
   the menu should diverge from the brand palette generally.
   --------------------------------------------------------------------------- */

const HOVER_COLOR_VARS = [
  "var(--brand-blue)",
  "var(--brand-red)",
  "var(--brand-green)",
  "var(--brand-yellow)",
];

/* -----------------------------------------------------------------------------
   MODULE-LEVEL STATE
   -----------------------------------------------------------------------------
   One scramble per .sidebar-home-item runs in parallel; all their cancel
   functions live in this group. The (cancels, cancelAll) pair was lifted
   into cancels.js once three views were using it — see that file's
   header for the rationale.

   shopGate is the controller returned by createShopGate() at buildDOM time.
   The view drives its reset() from the lifecycle hooks so the prompt is
   always folded and empty whenever home becomes visible.
   --------------------------------------------------------------------------- */

const cancels = createCancelGroup();
let   shopGate = null;

/* -----------------------------------------------------------------------------
   THE VIEW
   --------------------------------------------------------------------------- */

export const homeView = {
  name: "home",

  buildDOM(nav) {
    const el = document.createElement("div");
    el.className = "sidebar-view-home";
    el.innerHTML = `
      
      <nav class="sidebar-home-list">
        <button class="sidebar-home-item" data-target="about">.ABOUT</button>
        <button class="sidebar-home-item" data-target="projects">.PROJECT</button>
        <button class="sidebar-home-item" data-target="process">.PROCESS</button>
        <button class="sidebar-home-item" data-target="ethos">.ETHOS</button>
        <button class="sidebar-home-item" data-target="contact">.CONTACT</button>
        <button class="sidebar-home-item" data-shop-trigger>.SHOP</button>
        
      </nav>
    `;

    el.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-target]");
      if (!btn) return;                 // .SHOP has no data-target → ignored here
      nav(btn.dataset.target);
    });

    // Random brand color on each hover. mouseenter fires per cursor-entry,
    // so leaving and re-entering an item picks a fresh color. Per-item
    // listeners (not delegated) because mouseenter doesn't bubble — and
    // since the menu is built once and never restructured, attaching here
    // is fine. The listeners live for the page lifetime alongside the DOM.
    //
    // Dedup loop: rerolls until the pick differs from the current value,
    // so every hover visibly changes color. With pure random there's a
    // 25% chance of picking the same color twice in a row (1/4 colors),
    // which reads as "nothing happened." Cost is negligible — average ~1.3
    // rolls per hover.
    for (const item of el.querySelectorAll(".sidebar-home-item")) {
      item.addEventListener("mouseenter", () => {
        const current = item.style.getPropertyValue("--hover-color");
        let pick;
        do {
          pick = HOVER_COLOR_VARS[(Math.random() * HOVER_COLOR_VARS.length) | 0];
        } while (pick === current);
        item.style.setProperty("--hover-color", pick);
      });
    }

    // Mount the soft gate on the .SHOP item. It inserts its own prompt DOM
    // right after the button (shop is last, so it unfolds into empty space)
    // and calls nav("shop") once the correct key is entered. Guarded so a
    // missing/renamed trigger degrades to "no gate" rather than throwing.
    const shopBtn = el.querySelector("[data-shop-trigger]");
    if (shopBtn) {
      shopGate = createShopGate({
        trigger:  shopBtn,
        onUnlock: () => nav("shop"),
      });
    }

    return el;
  },

  onEnter(el) {
    cancels.cancelAll();
    shopGate?.reset();          // start folded + empty on every reveal

    // Per-button scrambles, all sharing t=0 so they start cycling glyphs
    // together — but each gets a longer `duration` than the previous so
    // they LOCK IN one after another, top to bottom. The user sees a
    // wave of resolution down the menu rather than a synchronised reveal.
    //
    // Tune RESOLVE_STAGGER_MS to taste: ~100 reads as a fast wave (items
    // barely distinguishable), ~200 gives a clear sequence with breathing
    // room, ~350 feels like a procession. 260 is textScramble.js's
    // default duration; we inline the number rather than importing
    // DEFAULTS so this view owns its base feel independently.
    const BASE_DURATION_MS    = 260;
    const RESOLVE_STAGGER_MS  = 120;
    el.querySelectorAll(".sidebar-home-item").forEach((item, i) => {
      cancels.add(startScramble(item, {
        duration: BASE_DURATION_MS + i * RESOLVE_STAGGER_MS,
      }));
    });
  },

  onExit() {
    cancels.cancelAll();
    shopGate?.reset();          // leave folded + empty; don't fade out mid-prompt
  },
};

/* =============================================================================
   sidebarTest.js — the "test" view of the sidebar
   -----------------------------------------------------------------------------
   Sandbox view for prototyping interaction primitives before they get
   wired into their actual target (dotsPanel, sidebar views, etc.).
   Currently testing: textUnderscore — cursor-driven brand-color
   underline, intended for dotsPanel.

   Hover the title or body. Characters near the cursor should snap on
   a colored underline (random color per lit transition), and snap
   off as the cursor moves away. Snappy decay (200ms half-life), no
   fade. Text wraps and spaces render correctly (no inline-block, no
   display changes).

   COUPLED WITH
     - sidebar.js: imports `testView` and includes it in initSidebar.
     - textUnderscore.js: provides the startUnderscore primitive.
   ========================================================================== */

import { startUnderscore }    from "./textUnderscore.js";
import { createCancelGroup }  from "./cancels.js";

const cancels = createCancelGroup();

export const testView = {
  name: "test",

  buildDOM(nav) {
    const el = document.createElement("div");
    el.className = "sidebar-view-test";
    el.innerHTML = `
      <h2 class="sidebar-test-title">Test</h2>
      <div class="sidebar-test-body">
        <p>
          Sandbox for prototyping interaction primitives. Currently
          testing textUnderscore — cursor-driven brand-color underline
          intended for dotsPanel.
        </p>
        <p>
          Hover the text. Characters near the cursor get an underline
          in one of the brand colors, snapping on and off as the
          cursor moves. The underline color is picked randomly per
          lit transition, so a run of lit chars may show different
          colors abutting each other.
        </p>
      </div>
    `;

    return el;
  },

  onEnter(el) {
    cancels.cancelAll();
    const title = el.querySelector(".sidebar-test-title");
    const body  = el.querySelector(".sidebar-test-body");
    if (title) cancels.add(startUnderscore(title));
    if (body)  cancels.add(startUnderscore(body));
  },

  onExit() {
    cancels.cancelAll();
  },
};

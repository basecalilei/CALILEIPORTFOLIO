/* =============================================================================
   sidebar.js — the SIDEBAR module (a persistent overlay, not a modal)
   -----------------------------------------------------------------------------
   A right-side overlay shell with a permanent trigger button. Click the
   trigger to open; close via the × button, an outside click, or Escape.

   The sheet's content is a set of registered VIEWS, each authored as its own
   module — at any moment exactly one view is visible. Switching between views
   happens via a `nav(name)` callback that the shell hands to each view at
   build time, so views can change their sibling view without importing
   anything from the shell.

   This module is a sibling category to modal modules (gridModal et al.) but
   differs in two structural ways:
     1. EAGERLY MOUNTED. The trigger button must exist at page load, so we
        build the DOM once at init() rather than lazily on first open.
     2. SELF-TRIGGERED. The open affordance lives inside this module (its own
        button), not in a panel. A modal module is opened FROM a panel button;
        the sidebar opens ITSELF.

   DOES NOT PARTICIPATE IN THE SCROLL SYSTEM. No registry calls, no
   activeIndex/activeFloat reads, no per-frame hook. The sidebar is
   independent of which panel is active — it stays at the same content
   regardless of where the user has scrolled to.

   USAGE
     import { initSidebar } from "./sidebar.js";
     import { homeView }    from "./sidebarHome.js";
     import { aboutView }   from "./sidebarAbout.js";

     initSidebar({
       initial: "home",
       views:  [homeView, aboutView],
     });

   VIEW CONTRACT
     A view is an object:
       {
         name:      "home",                      // unique id used by nav()
         buildDOM:  (nav) => HTMLElement,        // returns the view's root
         onEnter?:  (el) => void,                // optional, on becoming visible
         onExit?:   (el) => void,                // optional, on becoming hidden
       }
     The `nav` callback is passed to buildDOM exactly once at build time. A
     view calls `nav("other-view-name")` to request a switch; the shell does
     the cross-fade and runs the lifecycle hooks. A view never imports
     anything from this module — `nav` is its only outward channel.

   LIFECYCLE SEMANTICS
     onEnter fires when the view becomes visible to the user; onExit fires
     when it stops being visible. VISIBILITY (not "is this the active view")
     is the gate. Concretely:
       - sidebar opens onto this view               → onEnter
       - sidebar closes from this view              → onExit
       - user navigates here (sidebar already open) → onEnter
       - user navigates away (sidebar still open)   → onExit
     What does NOT fire onEnter/onExit:
       - initial mount of the shell (sheet is off-screen — user can't see it)
       - programmatic view changes while the sidebar is closed
     Both hooks can fire many times across a session — opening and closing
     the sidebar without navigating still re-fires onEnter/onExit on the
     active view. Hooks must therefore be cheap and idempotent: cancel any
     in-flight work in onExit, restart cleanly in onEnter.

   SHELL CHROME
     The shell renders two pieces of universal chrome on the sheet:
       - .sidebar-close — × in the top-right, dismisses the sidebar
       - .sidebar-back  — "← MENU" in the top-left, navigates to "home";
                          auto-hidden when the home view is active
     Both are positioned absolutely on the sheet so they stay pinned while
     the view content scrolls beneath. Views do not author their own back
     navigation — the shell owns it. If a future view needs to navigate
     somewhere other than home, it does so from within its own DOM via the
     `nav` callback; the shell's back button is specifically a back-to-home
     affordance, not a general "previous view" stack.

   COUPLED WITH
     - sidebarStyles.css: emits .sidebar-trigger, .sidebar-sheet,
       .sidebar-back, .sidebar-close, .sidebar-view-container, .sidebar-view.
     - Each view module emits its own per-view class (.sidebar-view-home etc.)
       and links its own stylesheet for view-internal styling.
   ========================================================================== */

/* -----------------------------------------------------------------------------
   TUNABLES
   --------------------------------------------------------------------------- */

// Duration of the sheet's slide-in/out animation. MUST match the CSS
// transition on .sidebar-sheet — kept here only as a named reference for
// callers that need to schedule work around the animation.
// eslint-disable-next-line no-unused-vars
const SHEET_ANIM_MS = 450;

/* -----------------------------------------------------------------------------
   MODULE-LEVEL STATE
   -----------------------------------------------------------------------------
   Single instance — only one sidebar exists. State is module-private; the
   only outward channels are the exported initSidebar / openSidebar /
   closeSidebar functions, the `sidebar-is-open` body-class broadcast, and
   the `nav` callback handed to view modules.
   --------------------------------------------------------------------------- */

let mounted = false;
let isOpen = false;

let trigger = null;        // the always-visible open-affordance button
let sheet = null;          // the sliding panel (slides in from the right)
let closeBtn = null;       // × inside the sheet (top-right)
let backBtn = null;        // "← MENU" inside the sheet (top-left); hidden on home
let viewContainer = null;  // holds all view DOM, only one visible at a time

const viewEntries = [];    // [{ name, el, def }, ...]
let activeEntry = null;    // currently visible view entry, or null

// Outside-click and Escape listeners — attached on open, removed on close.
// Kept as module-level references so we can both add and remove the SAME
// function (the addEventListener / removeEventListener pair only matches by
// reference identity, not by signature).
let outsideClickHandler = null;
let escapeHandler = null;

/* -----------------------------------------------------------------------------
   PUBLIC API
   --------------------------------------------------------------------------- */

export function initSidebar({ views, initial }) {
  if (mounted) return;
  if (!Array.isArray(views) || views.length === 0) {
    console.warn("[sidebar] initSidebar called with no views");
    return;
  }
  mounted = true;

  buildShell();
  buildViews(views);

  // Pick the initial view. Fall back to the first registered view if the
  // caller's `initial` doesn't match anything — better than starting blank.
  const initialName = initial && viewEntries.some(v => v.name === initial)
    ? initial
    : viewEntries[0].name;
  switchTo(initialName, /* skipFade */ true);
}

export function openSidebar() {
  if (!mounted || isOpen) return;
  isOpen = true;
  sheet.classList.add("is-open");
  trigger.setAttribute("aria-expanded", "true");

  // Published broadcast: page-level "the sheet is open" state. Modules that
  // must clear the sheet (e.g. scrollIndicator's dodge) key off this class;
  // the sidebar doesn't know or care who listens.
  document.body.classList.add("sidebar-is-open");

  // Defer attaching the outside-click handler. The click that JUST OPENED
  // the sidebar is still bubbling toward document; attaching synchronously
  // would catch that same event and immediately close us back down.
  // setTimeout(fn, 0) queues the attachment to a fresh task, after the
  // current event finishes propagating.
  outsideClickHandler = (e) => {
    // Use composedPath (captured at event dispatch) rather than DOM
    // containment against e.target. By the time this document-level
    // handler runs in bubble phase, the bubble-phase listeners along
    // the path have already executed — and any of them may have mutated
    // the DOM in ways that detach e.target from its ancestor chain.
    //
    // Concrete case: clicking a scrambled menu button triggers nav →
    // switchTo → outgoing view's onExit → textScramble cancel → span
    // DOM replaced by original text nodes. The click target (a span
    // inside the button) is now orphaned, so sheet.contains(e.target)
    // returns false even though the click ORIGINATED inside the sheet,
    // and we'd incorrectly close the sidebar.
    //
    // composedPath captures the ancestor chain at dispatch time and
    // survives any mutations during propagation. This is the right
    // tool for outside-click detection generally, not just for the
    // scramble case — any future view whose onExit mutates DOM along
    // the click's ancestor chain is covered.
    const path = e.composedPath();
    if (path.includes(sheet))   return;     // click originated inside the sheet
    if (path.includes(trigger)) return;     // click on the trigger or its inner spans
    closeSidebar();
  };
  setTimeout(() => {
    document.addEventListener("click", outsideClickHandler);
  }, 0);

  escapeHandler = (e) => {
    if (e.key === "Escape") closeSidebar();
  };
  document.addEventListener("keydown", escapeHandler);

  // Lifecycle: the active view just became visible. Fire its onEnter so
  // any enter animation plays NOW, not just when the user happens to
  // navigate to a different view. This is the half of the contract that
  // makes onEnter mean "you're visible to the user" rather than "your
  // active-state flipped to true."
  if (activeEntry) activeEntry.def.onEnter?.(activeEntry.el);
}

export function closeSidebar() {
  if (!mounted || !isOpen) return;
  isOpen = false;
  sheet.classList.remove("is-open");
  trigger.setAttribute("aria-expanded", "false");
  document.body.classList.remove("sidebar-is-open");

  if (outsideClickHandler) {
    document.removeEventListener("click", outsideClickHandler);
    outsideClickHandler = null;
  }
  if (escapeHandler) {
    document.removeEventListener("keydown", escapeHandler);
    escapeHandler = null;
  }

  // Lifecycle: mirror of openSidebar. The active view is no longer
  // visible — fire its onExit so any in-flight enter animation cancels
  // and restores its DOM before the sheet finishes sliding out. (Without
  // this, the user would briefly see scrambled or partial state sliding
  // away.) Fires synchronously; the close animation continues for the
  // sheet's CSS transition duration but the view is "logically" gone now.
  if (activeEntry) activeEntry.def.onExit?.(activeEntry.el);
}

/* -----------------------------------------------------------------------------
   DOM CONSTRUCTION (eager — runs once at init)
   --------------------------------------------------------------------------- */

function buildShell() {
  // The trigger — always visible, fixed in the top-right corner. When the
  // sheet is open it slides in from the right and visually covers the
  // trigger; no explicit hide needed (the sheet is on top in DOM order).
  trigger = document.createElement("button");
  trigger.className = "sidebar-trigger";
  trigger.setAttribute("aria-label", "Open menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = `
    <span class="sidebar-trigger-icon" aria-hidden="true">
      <span></span><span></span><span></span><span></span>
    </span>
    <span class="sidebar-trigger-label">MENU</span>
  `;
  trigger.addEventListener("click", openSidebar);

  // The sheet — permanently in the DOM, transformed off-screen when closed.
  sheet = document.createElement("aside");
  sheet.className = "sidebar-sheet";
  sheet.setAttribute("role", "complementary");
  sheet.setAttribute("aria-label", "Site navigation");

  closeBtn = document.createElement("button");
  closeBtn.className = "sidebar-close";
  closeBtn.setAttribute("aria-label", "Close menu");
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", closeSidebar);

  // The back button — always present in the DOM at the sheet level so it
  // stays pinned while view content scrolls. CSS hides it when the sheet
  // carries the `is-on-home` class (set by switchTo); the toggle is purely
  // visual — the listener stays attached either way (it's idle when hidden
  // since pointer-events: none on the same rule). Click navigates to home
  // unconditionally; if someone navigates to home programmatically before
  // clicking, the button is already hidden so the click can't fire.
  backBtn = document.createElement("button");
  backBtn.className = "sidebar-back";
  backBtn.setAttribute("aria-label", "Back to menu");
  backBtn.textContent = "← MENU";
  backBtn.addEventListener("click", () => switchTo("home"));

  viewContainer = document.createElement("div");
  viewContainer.className = "sidebar-view-container";

  sheet.appendChild(closeBtn);
  sheet.appendChild(backBtn);
  sheet.appendChild(viewContainer);

  document.body.appendChild(trigger);
  document.body.appendChild(sheet);
}

function buildViews(views) {
  for (const def of views) {
    if (!def || typeof def.buildDOM !== "function" || !def.name) {
      console.warn("[sidebar] skipping malformed view", def);
      continue;
    }
    // Hand each view the navigation callback at build time. Views never
    // import from sidebar.js — `nav` is their only outward channel.
    const el = def.buildDOM((targetName) => switchTo(targetName));
    if (!(el instanceof HTMLElement)) {
      console.warn(`[sidebar] view "${def.name}" buildDOM did not return an element`);
      continue;
    }
    el.classList.add("sidebar-view");
    // Inactive views start invisible and non-interactive. switchTo() flips
    // these on the entry side and off on the exit side. Both views remain
    // mounted simultaneously inside .sidebar-view-container (stacked via
    // absolute positioning in CSS); only opacity + pointer-events change.
    el.style.opacity = "0";
    el.style.pointerEvents = "none";
    viewContainer.appendChild(el);
    viewEntries.push({ name: def.name, el, def });
  }
}

/* -----------------------------------------------------------------------------
   VIEW SWITCHING (the sidebar's mini state machine)
   -----------------------------------------------------------------------------
   Cross-fade transition between views: the outgoing view eases opacity 1→0
   while the incoming view eases 0→1. They overlap in the viewContainer (both
   positioned absolutely at the same rectangle), so the cross-fade is just
   two CSS opacity transitions running in parallel — no JS animation loop
   required.

   If we ever want SEQUENCED transitions at the sidebar level (old view fully
   gone before new view begins, like the page-level handoff gate), the
   pattern is the same as the page: each view eases a `grow` value, the next
   waits for the previous to drop below a threshold. For now, the ~220ms
   cross-fade feels right for the small content changes views typically have
   — brief enough that the visual overlap is imperceptible.

   Lifecycle hooks (onEnter/onExit) only fire when the sidebar is open —
   see VIEW CONTRACT in the file header. switchTo still flips opacity and
   pointer-events regardless of isOpen, so the view-stack DOM state stays
   consistent; only the user-facing animation hooks are gated. If a view
   transition happens while the sidebar is closed (initial mount or any
   future programmatic nav), the new view will be visibly active by the
   time the user next opens the sidebar — and openSidebar's onEnter call
   fires at that point.
   --------------------------------------------------------------------------- */

function switchTo(name, skipFade = false) {
  const next = viewEntries.find(v => v.name === name);
  if (!next) {
    console.warn(`[sidebar] no view registered for "${name}"`);
    return;
  }
  if (next === activeEntry) return;

  const prev = activeEntry;
  if (prev) {
    // Gate on isOpen: if the user can't see the transition, the leave
    // animation would be wasted work. openSidebar will fire onEnter on
    // whatever's active next time they look.
    if (isOpen) prev.def.onExit?.(prev.el);
    prev.el.style.opacity = "0";
    prev.el.style.pointerEvents = "none";
  }

  if (skipFade) {
    // Initial mount path. Disable the CSS transition for one frame so the
    // first view appears instantly rather than fading in from nothing while
    // the sheet is still off-screen. Force a layout flush via offsetHeight,
    // then restore the transition so subsequent switches animate normally.
    next.el.style.transition = "none";
    next.el.style.opacity = "1";
    next.el.style.pointerEvents = "auto";
    // eslint-disable-next-line no-unused-expressions
    next.el.offsetHeight;
    next.el.style.transition = "";
  } else {
    next.el.style.opacity = "1";
    next.el.style.pointerEvents = "auto";
  }

  // Same gating: only fire onEnter if the user can see this transition.
  if (isOpen) next.def.onEnter?.(next.el);
  activeEntry = next;

  // Shell chrome update: the back button is hidden while home is active
  // (nothing to go back to). CSS owns the visibility transition; we just
  // flip the class. Lives at the bottom of switchTo so any future
  // view-dependent chrome can read activeEntry.name without re-deriving it.
  sheet.classList.toggle("is-on-home", next.name === "home");
}
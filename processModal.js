/* =============================================================================
   processModal.js — the per-process detail MODAL (not a panel, not a sidebar view)
   -----------------------------------------------------------------------------
   A centered 80vw × 80vh sheet that opens when a process icon tile in the
   sidebar's Process view is clicked. Displays the process's HERO block
   (PROCESS / NN kicker, display title, slash taglines — structural,
   identical shape across processes) followed by the process's media stack
   (raw HTML authored per-process — callouts, body copy, dark bands,
   section breaks, images, anything in any order).

   Closes via ×, scrim click, or Escape. Prev/next buttons pinned to the
   sheet's left and right edges (and the ArrowLeft/ArrowRight keys) cycle
   through the process list in place, wrapping at the ends.

   NAVIGATION (cycling)
     The caller passes the WHOLE process list plus the index to open at —
     not a single process — so the modal can cycle without importing
     anything from its caller (modals never import from the modules that
     open them). Cycling repopulates the sheet in place via populate():
     accent, kicker number, title, taglines, media, scroll position — no
     FLIP, the sheet doesn't move. The title re-scrambles on every cycle;
     the scramble IS the announcement that the sheet changed. Close always
     FLIPs back to the tile the user ENTERED from, even after cycling —
     the modal never learns the other processes' tiles, and "the modal
     goes away toward where I came in" reads correctly.

   SCROLL RESET — ordering is load-bearing
     The scroll reset lives in populate(), which runs AFTER the scrim is
     made visible. While the scrim is display:none the content element
     has no scroll box: scrollTop writes are silently ignored, and the
     browser restores the previous offset when the box comes back — which
     is exactly the "re-opens at the bottom" bug. Resetting on close
     instead would be insufficient: a rapid close→reopen cancels the
     close-completion timer before it fires, skipping a close-time reset.
     The open-time reset (post-visibility) covers every path.

   STRUCTURAL vs AUTHORED
     The hero is rendered by this module from the process object's fields
     (title, taglines, accent, and the current list index) because its
     shape is uniform across every process — it's the sheet's letterhead.
     Everything below it varies per process, so it's authored as raw HTML
     in the process's `media` field, with styled building blocks provided
     by processModalStyles.css (.process-callout, .process-dark,
     .process-bleed, .process-datawall, .process-break, .process-workflow,
     plus p/h3/ul/img defaults
     and .media-grid-2). Same contract as projectModal's media stack.

   PER-PROCESS ACCENT
     The process's `accent` (a CSS color expression, typically a brand
     token) is written onto the sheet as --process-accent per open. The
     stylesheet reads it for the hero's edge bar and kicker. Falls back
     to neutral tokens if a process omits it.

   WHY A MODAL (NOT A SIDEBAR VIEW)
     Same rationale as projectModal: sidebar views are short-form chrome;
     a process sheet is long-form and demands width. As a modal it commits
     the user to the discipline; closing returns them exactly where they
     were in the sidebar.

   USAGE
     import { openProcessModal } from "./processModal.js";

     // From inside sidebarProcess's click handler, with the clicked icon
     // tile passed so the FLIP animation knows where to grow from:
     openProcessModal(PROCESSES, index, tileElement);

   FLIP ANIMATION (open and close)
     Same pattern as projectModal.js / gridModal.js. On open:
       1. Make scrim visible (display:none → flex via .is-visible)
       2. Compute scale + translate that places the sheet visually AT
          the origin tile's bounding rect (the "Invert" step)
       3. Force layout flush
       4. requestAnimationFrame → clear the transform and add .is-open
          to the scrim; CSS transition on .process-modal-sheet handles
          the grow, CSS transition on .process-modal-scrim::before
          handles the backdrop dim/blur fade-in

     Close runs the same in reverse: re-measure the origin tile (its
     position may have changed if the sidebar reflowed), re-apply the
     FLIP transform, drop .is-open. After MODAL_ANIM_MS the scrim is
     hidden entirely and the transform cleared. The tile still exists
     in the DOM through close because the sidebar doesn't auto-close
     when modals open (separate state spaces, separate dismissals).

   TITLE SCRAMBLE
     The hero title scrambles in on every open, matching the sidebar's
     text-reveal language. Cancellable on close so a fast close-then-
     reopen doesn't leave the title mid-scramble; cancellable on re-open
     with a different process so the previous scramble doesn't carry over.

   COUPLED WITH
     - processModalStyles.css: emits .process-modal-scrim, .process-modal-sheet,
       .process-modal-close, .process-modal-nav (+ -prev / -next),
       .process-modal-content, .process-modal-hero, .process-modal-kicker,
       .process-modal-title, .process-modal-taglines, .process-modal-media,
       and the authored building-block classes.
     - cancels.js: provides createCancelGroup() for the title scramble.
     - processCards.js: sub-module providing the .process-card accordion
       behavior (attached to the content container at build, reset per
       populate). Cards are authored as plain HTML in a process's media.
     - textScramble.js: provides startScramble for the title.
     - sidebarProcess.js: the caller — imports openProcessModal and invokes
       it from its icon-tile click handler.
   ========================================================================== */

import { startScramble }      from "./textScramble.js";
import { createCancelGroup }  from "./cancels.js";
import { attachProcessCards } from "./processCards.js";

/* -----------------------------------------------------------------------------
   TUNABLES
   --------------------------------------------------------------------------- */

// FLIP animation duration. MUST match the CSS transition on
// .process-modal-sheet (transform) and .process-modal-scrim::before
// (the backdrop dim/blur). Named here only so the close timeout has
// a reference; the source of truth for the visible timing is CSS.
const MODAL_ANIM_MS = 450;

/* -----------------------------------------------------------------------------
   MODULE-LEVEL STATE
   -----------------------------------------------------------------------------
   Singleton — one modal exists, opened and closed by the exported function.
   All references private to this module; the only external surface is
   openProcessModal().
   --------------------------------------------------------------------------- */

let mounted = false;
let isOpen  = false;

let scrim      = null;   // full-viewport backdrop; click outside sheet closes
let sheet      = null;   // the 80vw × 80vh centered window
let closeBtn   = null;   // × in the sheet's top-right
let prevBtn    = null;   // ‹ pinned mid-height on the sheet's left edge
let nextBtn    = null;   // › pinned mid-height on the sheet's right edge
let content    = null;   // scrollable content container inside sheet
let kickerEl   = null;   // <span> PROCESS / NN, populated per populate()
let titleEl    = null;   // <h2> populated per populate()
let taglinesEl = null;   // <div> populated per populate() (slash lines as <p>s)
let mediaEl    = null;   // <div> populated per populate() with process.media

// The process list being cycled through and the index currently shown.
// Handed in per open; the prev/next buttons walk currentIndex over
// processList with wrap-around.
let processList  = [];
let currentIndex = 0;

// The icon tile the modal grew from. Kept across the open lifetime so
// close can shrink back to it — the ENTRY tile, deliberately not updated
// while cycling (see NAVIGATION in the file header). Cleared after the
// close transition.
let originEl = null;

// Keydown handler (Escape closes; ArrowLeft/ArrowRight cycle), attached
// on open / removed on close.
let keyHandler = null;

// Pending close-completion timeout. Cleared if the modal is re-opened
// mid-close (rapid open → close → open sequence).
let closeTimer = null;

// Cancellables for in-modal animations (currently just the title scramble).
const cancels = createCancelGroup();

// Accordion handle for authored .process-card blocks — attached to the
// content container once at build; reset per populate so an open card
// never survives a repopulate as a dangling reference.
let cards = null;

/* =============================================================================
   PUBLIC API
   ========================================================================== */

export function openProcessModal(processes, index, originElement) {
  if (!Array.isArray(processes) || processes.length === 0) return;
  if (!mounted) build();

  // If a close transition is mid-flight, cancel its cleanup timeout — we're
  // re-opening before close completed. The transform may still be partway
  // back to the origin; clear it so the new open's FLIP starts from the
  // resting position.
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
    sheet.style.transform = "";
  }

  // Stop any title scramble still running from a previous open. New open =
  // fresh scramble (populate() below starts it).
  cancels.cancelAll();

  processList = processes;
  isOpen      = true;
  originEl    = originElement || null;

  // Cycling to yourself is a no-op in a one-entry list; hide the arrows
  // rather than offer a button that does nothing.
  const showNav = processList.length > 1 ? "" : "none";
  prevBtn.style.display = showNav;
  nextBtn.style.display = showNav;

  // Show the scrim (display:none → flex) BEFORE populating. populate()
  // resets content.scrollTop, and that write only sticks once the content
  // has a scroll box — see SCROLL RESET in the file header. The forced
  // layout also makes the upcoming FLIP transform apply relative to the
  // now-laid-out sheet rect.
  scrim.classList.add("is-visible");
  // eslint-disable-next-line no-unused-expressions
  sheet.offsetHeight;

  // Populate the sheet (accent, kicker, title, taglines, media, scroll,
  // title scramble). The scramble's default duration (~260ms) is shorter
  // than the FLIP (MODAL_ANIM_MS = 450), so it resolves while the modal
  // is still arriving.
  populate(Number.isInteger(index) ? index : 0);

  // FLIP: compute the transform that places the sheet visually AT the
  // origin tile. If no origin was passed (e.g. opened programmatically),
  // skip the FLIP and let the modal scale-fade from rest. CSS handles the
  // fallback because the sheet's `.is-open` rule does the visible state;
  // without a transform set, there's just no growth animation.
  if (originEl) {
    // Disable the CSS transition so the snap-to-origin is instantaneous —
    // the next frame's clearing of transform IS the open animation.
    // (Close doesn't do this: it wants the transition active so setting
    // the transform animates from rest to origin.)
    sheet.style.transition = "none";
    applyFlipFromRect(originEl.getBoundingClientRect());
    // Force layout so the no-transition jump is committed before the next
    // frame re-enables the transition and clears the transform.
    // eslint-disable-next-line no-unused-expressions
    sheet.offsetHeight;
  }

  // Next frame: clear the transform and add .is-open. The CSS transitions
  // on transform (.process-modal-sheet) and opacity (.process-modal-scrim
  // ::before) run from the FLIP'd state back to the rest state.
  requestAnimationFrame(() => {
    sheet.style.transition = "";
    sheet.style.transform  = "";
    scrim.classList.add("is-open");
  });

  // Escape closes; Left/Right cycle. Attached here, removed in close.
  keyHandler = (e) => {
    if (e.key === "Escape")     closeProcessModal();
    if (e.key === "ArrowLeft")  goTo(currentIndex - 1);
    if (e.key === "ArrowRight") goTo(currentIndex + 1);
  };
  document.addEventListener("keydown", keyHandler);
}

/* =============================================================================
   PRIVATE — populate (shared by open and cycle)
   -----------------------------------------------------------------------------
   Writes one process into the sheet: accent, kicker number, title,
   taglines, media, scroll position, title scramble. The index wraps, so
   callers can pass currentIndex ± 1 without bounds checks.

   MUST run while the scrim is visible — the scrollTop reset is ignored on
   an element with no scroll box (see SCROLL RESET in the file header).
   Callers are responsible for cancelling a running scramble first
   (cancels.cancelAll()); populate only starts the new one.
   ========================================================================== */

function populate(index) {
  const n = processList.length;
  currentIndex = ((index % n) + n) % n;      // true modulo — wraps negatives
  const process = processList[currentIndex];

  // Reset the card accordion before the swap — deterministic closed state
  // for the incoming content, no dangling open-card reference.
  if (cards) cards.closeAll();

  // Per-process accent, consumed by the stylesheet (hero edge bar, kicker,
  // the section break's tick).
  sheet.style.setProperty("--process-accent", process.accent || "var(--ink-dim)");

  // Populate content fresh. Replacing innerHTML wipes previously injected
  // media (<img>/<video> elements + listeners).
  kickerEl.textContent = `PROCESS / ${String(currentIndex + 1).padStart(2, "0")}`;
  titleEl.textContent  = process.title || "";
  // Taglines are stored verbatim (leading slash and all) so the data is
  // WYSIWYG and a line can deviate from the /X grammar without fighting
  // a template. The last line renders strong via CSS :last-child.
  taglinesEl.innerHTML = (process.taglines || [])
    .map((t) => `<p>${t}</p>`)
    .join("");
  mediaEl.innerHTML    = process.media || "";

  // Reset the content scroll position — every process opens at its top,
  // whether arrived at by open or by cycling.
  content.scrollTop = 0;

  // The title scramble — on open it's the arrival reveal; on cycle it's
  // the announcement that the sheet changed.
  if (titleEl.textContent) {
    cancels.add(startScramble(titleEl));
  }
}

/* =============================================================================
   PRIVATE — cycle to a neighboring process
   ========================================================================== */

function goTo(index) {
  if (!isOpen) return;
  // Stop the outgoing title's scramble before the incoming one starts —
  // same reason as on open: no carry-over between processes.
  cancels.cancelAll();
  populate(index);
}

/* =============================================================================
   PRIVATE — close
   ========================================================================== */

function closeProcessModal() {
  if (!isOpen) return;
  isOpen = false;

  // Cancel the title scramble. onExit-equivalent: clean up before the
  // user sees the close motion, so the visible "shrinking" portion shows
  // resolved text, not partial scramble.
  cancels.cancelAll();

  if (keyHandler) {
    document.removeEventListener("keydown", keyHandler);
    keyHandler = null;
  }

  // FLIP back to origin. Re-measure the origin's rect at close time, not
  // at open time — the user may have scrolled the sidebar, resized the
  // viewport, or navigated the sidebar to a different view (in which case
  // the tile's rect is wherever it sits in the now-hidden Process view;
  // the modal vanishes to a point off-screen relative to what the user
  // sees, which reads as "modal goes away" — acceptable).
  if (originEl) {
    const r = originEl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      applyFlipFromRect(r);
    }
  }
  scrim.classList.remove("is-open");

  // After the transition completes, hide the scrim entirely (so it doesn't
  // block clicks underneath at its now-transparent state) and clear the
  // transform so the next open starts from a clean transform: "".
  // +20ms padding to be safely past the CSS transition's natural end.
  closeTimer = setTimeout(() => {
    scrim.classList.remove("is-visible");
    sheet.style.transform = "";
    originEl = null;
    closeTimer = null;
  }, MODAL_ANIM_MS + 20);
}

/* =============================================================================
   PRIVATE — FLIP transform from a target rect
   -----------------------------------------------------------------------------
   Given the rect we want the sheet to APPEAR AT, compute the transform that
   visually places the sheet there (the "Invert" step of FLIP) and set it.
   Pure math + one style mutation; transition handling lives at the call
   sites because the two callers want opposite behavior:

     OPEN  — caller disables the transition BEFORE this call so the jump
             to the origin rect is instantaneous; the next frame's clear of
             transform IS the animation (from origin back to rest).
     CLOSE — caller leaves the transition at its CSS default; setting the
             transform here triggers the CSS transition FROM rest TO the
             origin rect. That IS the close animation.
   ========================================================================== */
function applyFlipFromRect(originRect) {
  const targetRect = sheet.getBoundingClientRect();
  // Independent X and Y scales because the icon tile (roughly square) and
  // the modal sheet (much wider than tall) have different aspect ratios.
  // Independent scales make the rectangles match exactly at both endpoints.
  const scaleX = originRect.width  / targetRect.width;
  const scaleY = originRect.height / targetRect.height;
  const dx = (originRect.left + originRect.width  / 2) -
             (targetRect.left + targetRect.width  / 2);
  const dy = (originRect.top  + originRect.height / 2) -
             (targetRect.top  + targetRect.height / 2);

  sheet.style.transform = `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`;
}

/* =============================================================================
   PRIVATE — DOM construction (eager, once on first open)
   ========================================================================== */

function build() {
  mounted = true;

  scrim = document.createElement("div");
  scrim.className = "process-modal-scrim";
  scrim.setAttribute("aria-hidden", "true");

  sheet = document.createElement("aside");
  sheet.className = "process-modal-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");

  closeBtn = document.createElement("button");
  closeBtn.className = "process-modal-close";
  closeBtn.setAttribute("aria-label", "Close process sheet");
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", closeProcessModal);

  // Prev/next — pinned mid-height on the sheet's edges, cycling the
  // process list with wrap-around. The chevrons are drawn by CSS
  // (border-drawn, like the close button's X); the text content remains
  // for the accessible name alongside aria-label.
  prevBtn = document.createElement("button");
  prevBtn.className = "process-modal-nav process-modal-nav-prev";
  prevBtn.setAttribute("aria-label", "Previous process");
  prevBtn.addEventListener("click", () => goTo(currentIndex - 1));

  nextBtn = document.createElement("button");
  nextBtn.className = "process-modal-nav process-modal-nav-next";
  nextBtn.setAttribute("aria-label", "Next process");
  nextBtn.addEventListener("click", () => goTo(currentIndex + 1));

  // Content container: holds hero + media, scrolls internally when the
  // stack overflows the 80vh sheet. The sheet itself doesn't scroll —
  // the inner container does — so the close button stays pinned even as
  // the user scrolls through a long process sheet.
  content = document.createElement("div");
  content.className = "process-modal-content";

  // Accordion behavior for authored .process-card blocks — one delegated
  // listener for the modal's lifetime; the cards themselves are pure HTML.
  cards = attachProcessCards(content);

  // The hero — the process's letterhead: kicker, title, taglines. Built
  // once; text populated per open.
  const hero = document.createElement("header");
  hero.className = "process-modal-hero";

  kickerEl = document.createElement("span");
  kickerEl.className = "process-modal-kicker";

  titleEl = document.createElement("h2");
  titleEl.className = "process-modal-title";

  taglinesEl = document.createElement("div");
  taglinesEl.className = "process-modal-taglines";

  hero.appendChild(kickerEl);
  hero.appendChild(titleEl);
  hero.appendChild(taglinesEl);

  mediaEl = document.createElement("div");
  mediaEl.className = "process-modal-media";

  content.appendChild(hero);
  content.appendChild(mediaEl);

  sheet.appendChild(closeBtn);
  sheet.appendChild(prevBtn);
  sheet.appendChild(nextBtn);
  sheet.appendChild(content);
  scrim.appendChild(sheet);
  document.body.appendChild(scrim);

  // Scrim click closes — but only when the click target is the scrim
  // itself, not a descendant. Clicks inside the sheet bubble up to scrim
  // but originated inside the dialog and should not close.
  //
  // stopPropagation prevents the click from reaching document-level
  // listeners. The sidebar's outside-click handler is attached to
  // document and treats any click whose path doesn't include the
  // sidebar's sheet/trigger as a dismissal — without this guard,
  // clicking × or the scrim background closes the sidebar too. The
  // visible bug: as the sidebar slides away, the tile's rect moves
  // off-screen, so the close FLIP we just initiated ends up animating
  // toward a point where the tile no longer is.
  //
  // sidebar.md warns against stopPropagation in click handlers, but
  // that's specifically about sidebar VIEW handlers where the sidebar's
  // own machinery depends on events bubbling through its tree. This
  // modal is a sibling overlay layer (z:10 over the sidebar's z:9),
  // not a view; stopping the click here is the correct boundary —
  // same reasoning, verbatim, as projectModal.js.
  scrim.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target === scrim) closeProcessModal();
  });
}

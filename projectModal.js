/* =============================================================================
   projectModal.js — the per-project detail MODAL (not a panel, not a sidebar view)
   -----------------------------------------------------------------------------
   A centered 80vw × 80vh sheet that opens when a project thumbnail in the
   sidebar's Projects view is clicked. Displays the project's expanded data
   block (TITLE / DATE / TYPE / TOOLS / NOTE) followed by the project's media
   stack (raw HTML authored per-project — images, videos, paragraphs in any
   order).

   Closes via ×, scrim click, or Escape. Prev/next buttons pinned to the
   sheet's left and right edges (and the ArrowLeft/ArrowRight keys) cycle
   through the project list in place, wrapping at the ends.

   NAVIGATION (cycling)
     The caller passes the WHOLE project list plus the index to open at —
     not a single project — so the modal can cycle without importing
     anything from its caller (modals never import from the modules that
     open them). Cycling repopulates the sheet in place via populate():
     title, data block, media, scroll position — no FLIP, the sheet
     doesn't move. The title re-scrambles on every cycle; the scramble IS
     the announcement that the sheet changed. Close always FLIPs back to
     the thumb the user ENTERED from, even after cycling.

   WHY A MODAL (NOT A SIDEBAR VIEW)
     Sidebar views are short-form chrome — they share the sheet's narrow
     column and live alongside the menu. A project's detail content is
     long-form, image-heavy, and demands width — it would feel cramped
     and competitive with the sidebar's other affordances. As a modal,
     it commits the user to the project; closing returns them exactly
     where they were in the sidebar.

   USAGE
     import { openProjectModal } from "./projectModal.js";

     // From inside sidebarProjects' click handler, with the clicked
     // thumb element passed in so the FLIP animation knows where to
     // grow from:
     openProjectModal(PROJECTS, index, thumbElement);

   FLIP ANIMATION (open and close)
     Same pattern as gridModal.js's per-image detail modal. On open:
       1. Make scrim visible (display:none → flex via .is-visible)
       2. Compute scale + translate that places the sheet visually AT
          the origin thumbnail's bounding rect (the "Invert" step)
       3. Force layout flush
       4. requestAnimationFrame → clear the transform and add .is-open
          to the scrim; CSS transition on .project-modal-sheet handles
          the grow, CSS transition on .project-modal-scrim::before
          handles the backdrop dim/blur fade-in

     Close runs the same in reverse: re-measure the origin thumb (its
     position may have changed if the sidebar reflowed), re-apply the
     FLIP transform, drop .is-open. After MODAL_ANIM_MS the scrim is
     hidden entirely and the transform cleared. The thumb still exists
     in the DOM through close because the sidebar doesn't auto-close
     when modals open (the project's intentional behavior — separate
     state spaces, separate dismissals).

   TITLE SCRAMBLE
     The modal title scrambles in on every open, matching the sidebar's
     text-reveal language. Cancellable on close so a fast close-then-
     reopen doesn't leave the title mid-scramble; cancellable on
     re-open with a different project so the previous project's
     scramble doesn't carry over.

   COUPLED WITH
     - projectModalStyles.css: emits .project-modal-scrim, .project-modal-sheet,
       .project-modal-close, .project-modal-nav (+ -prev / -next),
       .project-modal-content, .project-modal-title, .project-modal-data,
       .project-modal-data-label, .project-modal-data-value,
       .project-modal-media.
     - cancels.js: provides createCancelGroup() for the title scramble.
     - textScramble.js: provides startScramble for the title.
     - sidebarProjects.js: the caller — imports openProjectModal and invokes
       it from its thumbnail click handler with the whole PROJECTS list plus
       the clicked index; the modal's prev/next cycle that list internally.
   ========================================================================== */

import { startScramble }     from "./textScramble.js";
import { createCancelGroup } from "./cancels.js";

/* -----------------------------------------------------------------------------
   TUNABLES
   --------------------------------------------------------------------------- */

// FLIP animation duration. MUST match the CSS transition on
// .project-modal-sheet (transform) and .project-modal-scrim::before
// (the backdrop dim/blur). Named here only so the close timeout has
// a reference; the source of truth for the visible timing is CSS.
const MODAL_ANIM_MS = 450;

/* -----------------------------------------------------------------------------
   MODULE-LEVEL STATE
   -----------------------------------------------------------------------------
   Singleton — one modal exists, opened and closed by the exported function.
   All references private to this module; the only external surface is
   openProjectModal().
   --------------------------------------------------------------------------- */

let mounted = false;
let isOpen  = false;

let scrim     = null;   // full-viewport backdrop; click outside sheet closes
let sheet     = null;   // the 80vw × 80vh centered window
let closeBtn  = null;   // × in the sheet's top-right
let prevBtn   = null;   // ‹ pinned mid-height on the sheet's left edge
let nextBtn   = null;   // › pinned mid-height on the sheet's right edge
let content   = null;   // scrollable content container inside sheet
let titleEl   = null;   // <h2> populated per populate()
let dataEl    = null;   // <div> populated per populate() (data rows as HTML)
let mediaEl   = null;   // <div> populated per populate() with project.media

// The project list being cycled through and the index currently shown.
// Handed in per open; the prev/next buttons walk currentIndex over
// projectList with wrap-around.
let projectList  = [];
let currentIndex = 0;

// The thumbnail element the modal grew from. Kept across the open lifetime
// so close can shrink back to it — the ENTRY thumb, deliberately not
// updated while cycling (the modal never learns the other projects'
// thumbs; "the modal goes away toward where I came in" reads correctly).
// Cleared after the close transition.
let originEl = null;

// Keydown handler (Escape closes; ArrowLeft/ArrowRight cycle), attached
// on open / removed on close.
let keyHandler = null;

// Pending close-completion timeout. Cleared if the modal is re-opened
// mid-close (rapid open → close → open sequence).
let closeTimer = null;

// Cancellables for in-modal animations (currently just the title scramble).
const cancels = createCancelGroup();

/* =============================================================================
   PUBLIC API
   ========================================================================== */

export function openProjectModal(projects, index, originElement) {
  if (!Array.isArray(projects) || projects.length === 0) return;
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

  projectList = projects;
  isOpen      = true;
  originEl    = originElement || null;

  // Cycling to yourself is a no-op in a one-entry list; hide the arrows
  // rather than offer a button that does nothing.
  const showNav = projectList.length > 1 ? "" : "none";
  prevBtn.style.display = showNav;
  nextBtn.style.display = showNav;

  // Show the scrim (display:none → flex) BEFORE populating — populate()'s
  // scrollTop reset only sticks once the content has a scroll box (see the
  // ORDER IS LOAD-BEARING note inside populate). The forced layout also
  // makes the upcoming FLIP transform apply relative to the now-laid-out
  // sheet rect.
  scrim.classList.add("is-visible");
  // eslint-disable-next-line no-unused-expressions
  sheet.offsetHeight;

  // Populate the sheet (title, data block, media, scroll, title scramble).
  // The scramble's default duration (~260ms) is shorter than the FLIP
  // (MODAL_ANIM_MS = 450), so it resolves while the modal is still
  // arriving — by the time the FLIP settles, the title is locked in.
  populate(Number.isInteger(index) ? index : 0);

  // FLIP: compute the transform that places the sheet visually AT the
  // origin thumb. If no origin was passed (e.g. opened programmatically),
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
  // on transform (.project-modal-sheet) and opacity (.project-modal-scrim
  // ::before) run from the FLIP'd state back to the rest state.
  requestAnimationFrame(() => {
    sheet.style.transition = "";
    sheet.style.transform  = "";
    scrim.classList.add("is-open");
  });

  // Escape closes; Left/Right cycle. Attached here, removed in close.
  keyHandler = (e) => {
    if (e.key === "Escape")     closeProjectModal();
    if (e.key === "ArrowLeft")  goTo(currentIndex - 1);
    if (e.key === "ArrowRight") goTo(currentIndex + 1);
  };
  document.addEventListener("keydown", keyHandler);
}

/* =============================================================================
   PRIVATE — populate (shared by open and cycle)
   -----------------------------------------------------------------------------
   Writes one project into the sheet: title, expanded data block, media,
   scroll position, title scramble. The index wraps, so callers can pass
   currentIndex ± 1 without bounds checks. Callers are responsible for
   cancelling a running scramble first (cancels.cancelAll()); populate
   only starts the new one.
   ========================================================================== */

function populate(index) {
  const n = projectList.length;
  currentIndex = ((index % n) + n) % n;      // true modulo — wraps negatives
  const project = projectList[currentIndex];

  // Populate content fresh. Replacing innerHTML wipes previously injected
  // media (<img>/<video> elements + listeners). For videos that were
  // autoplaying, this releases their decode resources.
  titleEl.textContent = project.title || "";
  dataEl.innerHTML    = renderDataRows(project);
  mediaEl.innerHTML   = project.media || "";

  // Reset the content scroll position — every project starts at the top,
  // whether arrived at by open or by cycling, never at the offset the
  // previous project was left at.
  //
  // ORDER IS LOAD-BEARING. This must run AFTER the scrim is .is-visible —
  // which open() guarantees by showing the scrim before calling populate.
  // While the modal is closed the scrim is display:none, so
  // .project-modal-content has no layout box and therefore no scrolling
  // box: a scrollTop write there is silently discarded, and the browser
  // hands back the retained offset when the subtree is displayed again.
  // Resetting alongside the innerHTML population above (the intuitive
  // place, at open time) is dead code — the visible bug was a new project
  // opening part-way down the previous project's media stack.
  //
  // Media that sizes in later (images without intrinsic dimensions) grows
  // the stack BELOW the viewport; at scrollTop 0 there is nothing above
  // the anchor, so nothing shifts. No post-load re-reset is needed.
  content.scrollTop = 0;

  // The title scramble — on open it's the arrival reveal; on cycle it's
  // the announcement that the sheet changed.
  if (titleEl.textContent) {
    cancels.add(startScramble(titleEl));
  }
}

/* =============================================================================
   PRIVATE — cycle to a neighboring project
   ========================================================================== */

function goTo(index) {
  if (!isOpen) return;
  // Stop the outgoing title's scramble before the incoming one starts —
  // same reason as on open: no carry-over between projects.
  cancels.cancelAll();
  populate(index);
}

/* =============================================================================
   PRIVATE — close
   ========================================================================== */

function closeProjectModal() {
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
  // the thumb's rect is wherever it sits in the now-hidden Projects view;
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

   Earlier this function set `transition: none` for both, which was correct
   for open but silently broke close (the close jump played instantly
   instead of animating).
   ========================================================================== */
function applyFlipFromRect(originRect) {
  const targetRect = sheet.getBoundingClientRect();
  // Independent X and Y scales because the thumb (4:3) and the modal sheet
  // (typically wider than tall) have different aspect ratios. Using a
  // single scale would mean the FLIP arrives with the wrong aspect either
  // at the origin or the target. Independent scales make the rectangles
  // match exactly at both endpoints.
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
  scrim.className = "project-modal-scrim";
  scrim.setAttribute("aria-hidden", "true");

  sheet = document.createElement("aside");
  sheet.className = "project-modal-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");

  closeBtn = document.createElement("button");
  closeBtn.className = "project-modal-close";
  closeBtn.setAttribute("aria-label", "Close project detail");
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", closeProjectModal);

  // Prev/next — pinned mid-height on the sheet's edges, cycling the
  // project list with wrap-around. The chevrons are drawn by CSS
  // (border-drawn, like the close button's X).
  prevBtn = document.createElement("button");
  prevBtn.className = "project-modal-nav project-modal-nav-prev";
  prevBtn.setAttribute("aria-label", "Previous project");
  prevBtn.addEventListener("click", () => goTo(currentIndex - 1));

  nextBtn = document.createElement("button");
  nextBtn.className = "project-modal-nav project-modal-nav-next";
  nextBtn.setAttribute("aria-label", "Next project");
  nextBtn.addEventListener("click", () => goTo(currentIndex + 1));

  // Content container: holds title + data + media, scrolls internally when
  // the media stack overflows the 80vh sheet. The sheet itself doesn't
  // scroll — the inner container does — so the close button stays pinned
  // even as the user scrolls through a long project.
  content = document.createElement("div");
  content.className = "project-modal-content";

  titleEl = document.createElement("h2");
  titleEl.className = "project-modal-title";

  dataEl = document.createElement("div");
  dataEl.className = "project-modal-data";

  mediaEl = document.createElement("div");
  mediaEl.className = "project-modal-media";

  content.appendChild(titleEl);
  content.appendChild(dataEl);
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
  // visible bug: as the sidebar slides away, the thumb's rect moves
  // off-screen, so the close FLIP we just initiated ends up animating
  // toward (or snapping to) a point where the thumb no longer is.
  //
  // sidebar.md warns against stopPropagation in click handlers, but
  // that's specifically about sidebar VIEW handlers where the sidebar's
  // own machinery depends on events bubbling through its tree. This
  // modal is a sibling overlay layer (z:10 over the sidebar's z:9),
  // not a view; stopping the click here is the correct boundary —
  // events that originated within the modal shouldn't be ambient
  // page clicks as far as document-level listeners are concerned.
  scrim.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target === scrim) closeProjectModal();
  });
}

/* =============================================================================
   PRIVATE — data block rendering
   -----------------------------------------------------------------------------
   The expanded data block: TITLE / DATE / TYPE / TOOLS / NOTE. Single column
   (all rows full width). TOOLS is an array joined with ", " so a project
   that uses two tools or twelve renders the same way (the value cell wraps
   naturally). NOTE is multi-line text that wraps freely; the label cell is
   top-aligned via CSS so it pairs with the start of the wrapped value
   regardless of how tall the row becomes.

   Optional fields (tools, note) are omitted entirely if absent. The data
   block is the project's identity card — empty rows would look incomplete.
   --------------------------------------------------------------------------- */

function renderDataRows(p) {
  const rows = [];
  if (p.title) rows.push(makeRow("TITLE", p.title));
  if (p.date)  rows.push(makeRow("DATE",  p.date));
  if (p.type)  rows.push(makeRow("TYPE",  p.type));
  if (Array.isArray(p.tools) && p.tools.length) {
    rows.push(makeRow("TOOLS", p.tools.join(", ")));
  }
  if (p.note)  rows.push(makeRow("NOTE",  p.note));
  return rows.join("");
}

function makeRow(label, value) {
  // The data block is a 2-column CSS grid; each row contributes one label
  // cell and one value cell as direct grid children. No wrapping <div>
  // per row (would need display: contents to fall through the grid, and
  // that's an extra abstraction layer for no gain here).
  return `<div class="project-modal-data-label">${label}</div>` +
         `<div class="project-modal-data-value">${value}</div>`;
}
/* =============================================================================
   processCards.js — accordion behavior for authored .process-card blocks
   -----------------------------------------------------------------------------
   A sub-module of processModal (the relationship desktopDraggable has to
   the desktop family): one exported function, imported and invoked by
   processModal.js only. It gives the .process-card building block its
   expand/collapse behavior via a single delegated listener, so the cards
   themselves stay PURE AUTHORED HTML in a process's media field — no
   imports, no wiring, no per-card JS. Same philosophy as pdfModal's
   .pdf-card self-wiring: authoring a card is just writing markup.

   BEHAVIOR
     - Click a card's head        → open it (closing any other open card)
     - Click the open card's head → close it
     - Click INSIDE the open card's body → nothing (the user is reading,
       selecting text, or viewing screenshots — that's not a dismissal)
     - Click anywhere else in the container → close the open card
     One card open at a time. The open/closed state is purely the
     .is-open class; the expansion animation lives in CSS
     (grid-template-rows 0fr → 1fr on .process-card-body), which pushes
     surrounding content in-flow — no overlays, no measured heights.

   REPOPULATION SAFETY
     processModal replaces its media innerHTML per open/cycle, orphaning
     any open card. The returned handle's closeAll() is called by
     populate() before each swap so the tracked reference never dangles;
     even unreset, a stale reference is harmless (classList on a detached
     node is a no-op) — closeAll just keeps the state deterministic.

   USAGE (processModal.js, once, at build time)
     import { attachProcessCards } from "./processCards.js";
     const cards = attachProcessCards(contentEl);   // delegated, permanent
     // in populate(): cards.closeAll();

   COUPLED WITH
     - processModal.js: the only importer; attaches this to its content
       container and resets it per populate.
     - processModalStyles.css: styles the .process-card family and owns
       the open/close animation this module's .is-open class drives.
     - Authored media HTML (sidebarProcess.js PROCESSES[].media): emits
       .process-card / -head / -body markup. The head must be a <button
       class="process-card-head" aria-expanded="false"> for keyboard and
       assistive-tech access — this module maintains aria-expanded.
   ========================================================================== */

export function attachProcessCards(container) {
  // The one open card, or null. Tracked by element reference — stable
  // across scrolls, invalidated by innerHTML swaps (see header).
  let openCard = null;

  function setOpen(card, open) {
    card.classList.toggle("is-open", open);
    const head = card.querySelector(".process-card-head");
    if (head) head.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function closeAll() {
    if (openCard) {
      setOpen(openCard, false);
      openCard = null;
    }
  }

  function openCardEl(card) {
    closeAll();
    setOpen(card, true);
    openCard = card;
  }

  container.addEventListener("click", (e) => {
    // A head click toggles its card — close if it's the open one,
    // switch to it otherwise.
    const head = e.target.closest(".process-card-head");
    if (head && container.contains(head)) {
      const card = head.closest(".process-card");
      if (card === openCard) closeAll();
      else openCardEl(card);
      return;
    }

    // A click inside a card that isn't on its head: if it's the open
    // card, the user is interacting with its content — leave it open.
    // If it's a different card (only reachable via its borders while
    // closed), treat it as an open request — the card is clickable.
    const card = e.target.closest(".process-card");
    if (card && container.contains(card)) {
      if (card !== openCard) openCardEl(card);
      return;
    }

    // A click anywhere else in the container: dismiss.
    closeAll();
  });

  return { closeAll };
}

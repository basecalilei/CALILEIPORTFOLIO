/* =============================================================================
   desktopLockGate.js — the soft "access key" gate for locked desktop items
   -----------------------------------------------------------------------------
   The desktop family's analog of sidebarShopGate.js. Any item authored with
   `locked: true` + a `password` shows a small lock badge on its icon and,
   when clicked, raises a centered password prompt over the screen instead
   of opening. A correct key unlocks the item for the session and opens it.

   SOFT GATE — a casual deterrent, not security. Passwords are authored in
   plaintext in main.js, which ships to the browser; the comparison is
   trimmed + case-insensitive on purpose, forgiving for a casual visitor
   (same convention as the shop gate). Don't put anything behind it that
   actually needs protecting.

   WHY A SEPARATE MODULE (not inline in desktopPanel.js)
     The panel's job is items, windows, drag, and reveal. The gate is a
     self-contained interactive widget with its own DOM, states, and
     validation — the same reasoning that keeps sidebarShopGate out of
     sidebarHome. The panel touches the lock system in exactly three
     places, all one-liners: the .is-locked class in buildIconEl (the badge
     itself is pure CSS in this module's stylesheet), the requestUnlock
     routing in the icon onClick, and the locked-items filter on the
     openOnLoad pass.

   DELETION PATH
     Remove this file + desktopLockGateStyles.css + its <link> in
     index.html, drop the import and the three integration points in
     desktopPanel.js, and locked items degrade to ordinary items — the
     authored `locked` / `password` fields become inert data.

   AUTHORED DATA SHAPE (on any item, any type, any nesting depth)
     { type: "folder", name: "private", contents: [ ... ],
       locked: true, password: "opensesame" }

     Both fields are required for the gate to engage — `locked: true`
     without a password behaves unlocked (missing things are silent
     no-ops). isLocked() below is the single definition of "engaged";
     the panel uses it too, so badge and intercept can't disagree.

   UNLOCK SEMANTICS
     A correct key sets item.locked = false on the LIVE item state — the
     same session-only model as note edits and window layouts. The badge
     comes off, the item opens, and it stays unlocked until reload, which
     restores the authored data (re-locking it). Locked items can still
     be DRAGGED — the lock guards opening, not arranging.

   THE PROMPT
     One lazy singleton per panel instance (WeakMap keyed on state),
     appended to state.screen so it lives in the screen's coordinate
     space, fades with the panel's overlay opacity, and is clipped with
     the screen. Centered, frosted surface + hairline (the sanctioned
     depth treatment), z above windows and the frame chrome. Clicking a
     different locked item while it's open retargets it. Escape or an
     outside pointerdown dismisses it. If the user scrolls away from the
     panel with the prompt open, it simply fades with the overlay and is
     still open on return — state preserved, same as windows.

   COUPLED WITH
     - desktopLockGateStyles.css: emits .desktop-lock* and the
       .desktop-icon.is-locked::after badge.
     - desktopPanel.js: imports isLocked + requestUnlock (the three
       integration points above).
     - textScramble.js: startScramble for the label's decode-in — same
       primitive the shop gate and the menu use, so the reveals share a
       language.
   ========================================================================== */

import { startScramble } from "./textScramble.js";

/* How long the green "granted" beat shows before the unlock lands and the
   item opens. Matches the shop gate's hold: long enough to register as
   confirmation, short enough not to stall. */
const GRANT_HOLD_MS = 280;

/* -----------------------------------------------------------------------------
   isLocked — the single definition of "the gate is engaged for this item."
   Exported so desktopPanel's badge class and open intercept use the same
   test as the gate itself.
   --------------------------------------------------------------------------- */
export function isLocked(item) {
  return !!(item && item.locked && item.password != null);
}

/* -----------------------------------------------------------------------------
   requestUnlock — raise the prompt for an item; call onUnlock on success.
   The prompt is built lazily on first use, one per panel instance.
   --------------------------------------------------------------------------- */
const prompts = new WeakMap(); // panel state → prompt controller

export function requestUnlock(state, item, onUnlock) {
  let ctl = prompts.get(state);
  if (!ctl) {
    ctl = buildPrompt();
    state.screen.appendChild(ctl.el);
    prompts.set(state, ctl);
  }
  ctl.open(item, onUnlock);
}

/* -----------------------------------------------------------------------------
   THE PROMPT
   -----------------------------------------------------------------------------
   Same instrument grammar as the shop gate — Hornet kicker naming the
   item, /> syntax prompt, hairline data-rule with an activity register,
   brand-color status semantics — recomposed as a centered dialog card.
   The markup is owned by this widget and isn't reused.
   --------------------------------------------------------------------------- */
function buildPrompt() {
  const el = document.createElement("div");
  el.className = "desktop-lock";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `
    <div class="desktop-lock-label">// LOCKED</div>
    <div class="desktop-lock-field">
      <span class="desktop-lock-prompt" aria-hidden="true">/&gt;</span>
      <input class="desktop-lock-input" type="password" name="desktop-access-key"
             placeholder="enter key" autocomplete="off" spellcheck="false"
             aria-label="Access key for locked item" />
    </div>
    <div class="desktop-lock-rule"><span class="desktop-lock-scan"></span></div>
    <div class="desktop-lock-status" aria-live="polite"></div>
  `;

  const input = el.querySelector(".desktop-lock-input");
  const label = el.querySelector(".desktop-lock-label");

  let isOpen         = false;
  let target         = null;   // the item currently being unlocked
  let grantFn        = null;   // its onUnlock callback
  let unlocking      = false;  // guards the grant beat against double-submit
  let cancelScramble = null;   // the label's in-flight decode, if any
  let holdTimer      = null;   // the grant → open handoff timer

  function open(item, onUnlock) {
    // Retarget-or-open: a second locked icon clicked while the prompt is
    // up re-points the same prompt (fresh label, empty field). In
    // practice the outside-pointerdown below already closed it before
    // the icon's click resolved — makeDraggable settles clicks on
    // pointerup — so this path usually runs from closed; the retarget
    // branch is for programmatic callers.
    target  = item;
    grantFn = onUnlock;
    unlocking = false;
    clearTimeout(holdTimer);
    holdTimer = null;

    label.textContent = `// LOCKED.[${String(item.name || "FILE").toUpperCase()}]`;
    input.value = "";
    input.removeAttribute("readonly");
    el.classList.remove("is-wrong", "is-correct");

    if (!isOpen) {
      isOpen = true;
      el.classList.add("is-open");
      el.setAttribute("aria-hidden", "false");
      document.addEventListener("pointerdown", onOutsidePointer, true);
    }

    // Decode the label in — same primitive the shop gate and menu use.
    cancelScramble?.();
    cancelScramble = startScramble(label);

    input.focus();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    target = null;
    grantFn = null;
    unlocking = false;
    clearTimeout(holdTimer);
    holdTimer = null;

    el.classList.remove("is-open", "is-wrong", "is-correct");
    el.setAttribute("aria-hidden", "true");
    cancelScramble?.();
    cancelScramble = null;
    document.removeEventListener("pointerdown", onOutsidePointer, true);
    input.blur();
    input.value = "";              // don't leave a typed key sitting around
    input.removeAttribute("readonly");
  }

  /* Outside-dismiss — composedPath (not .contains), per the shop gate and
     sidebar.md: captured paths survive DOM mutations mid-dispatch. Only
     the prompt itself counts as inside; a pointerdown on a locked icon
     closes the prompt here, and the icon's subsequent click reopens it
     retargeted — which is the behavior a user pointing at a second locked
     file expects anyway. */
  function onOutsidePointer(e) {
    if (e.composedPath().includes(el)) return;
    close();
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Enter" || unlocking || !target) return;
    e.preventDefault();
    const ok =
      input.value.trim().toLowerCase() ===
      String(target.password).trim().toLowerCase();
    ok ? grant() : reject();
  }

  function grant() {
    unlocking = true;
    input.setAttribute("readonly", "");        // no edits during the handoff
    el.classList.remove("is-wrong");
    el.classList.add("is-correct");

    // Brief green confirmation, then: unlock the live item (session-only —
    // reload restores the authored lock), drop its badge, fold the prompt,
    // and hand control to the caller (→ openWindowFor).
    const item = target;
    const done = grantFn;
    holdTimer = setTimeout(() => {
      item.locked = false;
      // item.el is the live icon node (buildIconEl stores it). If the icon
      // is currently detached (its parent folder window was closed), the
      // class removal sticks for reattach — and a future buildIconEl call
      // re-derives the class from item.locked anyway, so both paths agree.
      item.el?.classList.remove("is-locked");
      close();
      done?.();
    }, GRANT_HOLD_MS);
  }

  function reject() {
    input.value = "";
    input.focus();
    el.classList.remove("is-correct");
    // Re-trigger the shake even on consecutive wrong entries: drop the
    // class, force a reflow, re-add — otherwise the keyframes only play
    // the first time the class appears.
    el.classList.remove("is-wrong");
    void el.offsetWidth;
    el.classList.add("is-wrong");
  }

  input.addEventListener("keydown", onKeyDown);
  // Clear the warn state the instant the visitor starts correcting, so the
  // red rule/readout doesn't linger while they retype.
  input.addEventListener("input", () => {
    if (el.classList.contains("is-wrong")) el.classList.remove("is-wrong");
  });

  return { el, open };
}

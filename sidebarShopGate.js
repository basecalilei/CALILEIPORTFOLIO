/* =============================================================================
   sidebarShopGate.js — the soft "access key" gate for the Shop menu item
   -----------------------------------------------------------------------------
   Turns the home menu's .SHOP button from a plain nav target into a gated
   one. Clicking it no longer navigates straight to the shop view; instead a
   small password prompt unfolds in the space beneath the button. Enter the
   key and the gate calls back to open the shop; click anywhere else and it
   folds away again.

   SOFT GATE — a casual deterrent, not security. The key lives in plaintext
   below (ACCESS_KEY) and the comparison is trimmed + case-insensitive on
   purpose, to be forgiving for a casual visitor. Don't put anything behind
   it that actually needs protecting.

   WHY A SEPARATE MODULE (not inline in sidebarHome.js)
     sidebarHome.js is the menu / sibling-router; its job is to list views
     and nav() to them. The gate is a self-contained interactive widget with
     its own DOM, its own open/close + ambient animation, and its own
     validation. Keeping it here leaves the home view focused, and makes the
     gate delete in isolation: remove this file + its stylesheet + its
     <link>, drop the import and createShopGate() call in sidebarHome.js, and
     restore the shop button to a plain data-target="shop" — nothing else
     changes.

   RELATIONSHIP TO THE MENU
     sidebarHome hands us the shop <button> (the trigger) and an onUnlock
     callback (just () => nav("shop")). We take over the trigger's click,
     insert our prompt immediately after it in the flex-column list — shop is
     the last item, so the prompt unfolds into the empty space below without
     pushing any other item — and call onUnlock on a correct key.

     The gate never imports sidebar.js. Its only outward channel is the
     onUnlock callback, exactly mirroring how views only know nav().

   ENTRY / EXIT
     open()  → wrapper gets .is-open (grid-template-rows 0fr→1fr unfolds it),
               the ambient scanline + prompt blink start (CSS, gated on
               .is-open), the label scrambles in, the input focuses, and a
               document-level outside-pointerdown listener is armed.
     close() → everything reverses; the scramble is cancelled (restoring the
               label text), the listener is removed.
     reset() → idempotent teardown the home view calls on onEnter/onExit so
               the prompt is always folded and empty whenever home is shown.

   COUPLED WITH
     - sidebarShopGateStyles.css: emits .shop-gate and its inner classes.
     - sidebarHome.js: builds the trigger, calls createShopGate(), and drives
       reset() from the home view's onEnter/onExit.
     - textScramble.js: startScramble, for the label's decode-in (same
       primitive the menu items use, so the two reveals share a language).
   ========================================================================== */

import { startScramble } from "./textScramble.js";

/* -----------------------------------------------------------------------------
   THE KEY — soft gate only (see file header). Change to whatever you like.
   Compared trimmed + lowercased, so "OpenSesame " still unlocks.
   --------------------------------------------------------------------------- */
const ACCESS_KEY = "opensesame";

/* How long the green "granted" beat shows before we hand off to the shop
   view. Long enough to register as confirmation, short enough not to stall.
   The nav that follows triggers home's onExit → reset(), which folds us. */
const GRANT_HOLD_MS = 280;

export function createShopGate({ trigger, onUnlock, password = ACCESS_KEY }) {
  /* --- build the prompt DOM ------------------------------------------------
     Authored inline: the markup is owned by this widget and isn't reused. */
  const gate = document.createElement("div");
  gate.className = "shop-gate";
  gate.setAttribute("aria-hidden", "true");
  gate.innerHTML = `
    <div class="shop-gate-inner">
      <div class="shop-gate-label">// ACCESS.KEY</div>
      <div class="shop-gate-field">
        <span class="shop-gate-prompt" aria-hidden="true">/&gt;</span>
        <input class="shop-gate-input" type="password" name="shop-access-key"
               placeholder="enter key" autocomplete="off" spellcheck="false"
               aria-label="Shop access key" />
      </div>
      <div class="shop-gate-rule"><span class="shop-gate-scan"></span></div>
      <div class="shop-gate-status" aria-live="polite"></div>
    </div>
  `;

  /* Insert directly after the trigger so the prompt lives in the menu column
     right under the shop button. Shop is the last item, so this unfolds into
     empty space. after() keeps us decoupled from the list container's id. */
  trigger.after(gate);

  const input = gate.querySelector(".shop-gate-input");
  const label = gate.querySelector(".shop-gate-label");

  let isOpen         = false;
  let unlocking      = false;   // guards the grant beat against double-submit
  let cancelScramble = null;    // the label's in-flight decode, if any
  let holdTimer      = null;    // the grant → onUnlock handoff timer

  /* --- open / close -------------------------------------------------------- */
  function open() {
    if (isOpen) { input.focus(); return; }
    isOpen = true;
    gate.classList.remove("is-wrong", "is-correct");
    gate.classList.add("is-open");
    gate.setAttribute("aria-hidden", "false");

    // Decode the label in — same primitive the menu items use, so the gate's
    // reveal reads as part of the site rather than a generic fade.
    cancelScramble?.();
    cancelScramble = startScramble(label);

    input.focus();

    // Arm outside-dismiss. No deferral needed: the click that opened us has
    // the trigger in its composedPath, and onOutsidePointer treats trigger +
    // prompt as "inside", so the opening click can't immediately close us.
    // (And it's a pointerdown listener — the opening click never reaches it.)
    document.addEventListener("pointerdown", onOutsidePointer, true);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    gate.classList.remove("is-open");
    gate.setAttribute("aria-hidden", "true");
    cancelScramble?.();
    cancelScramble = null;
    document.removeEventListener("pointerdown", onOutsidePointer, true);
    input.blur();
  }

  /* Full idempotent teardown. The home view calls this on onEnter (start
     folded) and onExit (leave folded), so every time home is shown the
     prompt is closed and the field is empty — the "prompt every time,
     remember nothing" behavior. */
  function reset() {
    clearTimeout(holdTimer);
    holdTimer = null;
    unlocking = false;
    input.value = "";
    input.removeAttribute("readonly");
    gate.classList.remove("is-wrong", "is-correct");
    close();
  }

  /* --- trigger toggles ----------------------------------------------------- */
  function onTriggerClick(e) {
    // The trigger no longer carries data-target (sidebarHome dropped it), so
    // the home delegation ignores it and we own the click outright.
    e.preventDefault();
    isOpen ? close() : open();
  }

  /* --- outside-dismiss -----------------------------------------------------
     composedPath (not .contains) per sidebar.md: onExit-driven DOM swaps (the
     menu's scramble) can orphan a click target from its ancestor chain, and
     the captured path survives that mutation. Trigger + prompt count as
     inside, so clicking the field keeps us open and re-clicking the shop
     button routes to onTriggerClick (which toggles) rather than closing here. */
  function onOutsidePointer(e) {
    const path = e.composedPath();
    if (path.includes(gate) || path.includes(trigger)) return;
    close();
  }

  /* --- submit -------------------------------------------------------------- */
  function onKeyDown(e) {
    if (e.key !== "Enter" || unlocking) return;
    e.preventDefault();
    const ok =
      input.value.trim().toLowerCase() ===
      String(password).trim().toLowerCase();
    ok ? grant() : reject();
  }

  function grant() {
    unlocking = true;
    input.setAttribute("readonly", "");        // no edits during the handoff
    gate.classList.remove("is-wrong");
    gate.classList.add("is-correct");
    // Brief green confirmation, then hand control to the caller (→ nav shop).
    // home's onExit fires during that nav and calls reset(), folding and
    // clearing us — so there's nothing to tear down here.
    holdTimer = setTimeout(() => onUnlock(), GRANT_HOLD_MS);
  }

  function reject() {
    input.value = "";
    input.focus();
    gate.classList.remove("is-correct");
    // Re-trigger the shake even on consecutive wrong entries: drop the class,
    // force a reflow, re-add — otherwise the keyframes only play the first
    // time the class appears.
    gate.classList.remove("is-wrong");
    void gate.offsetWidth;
    gate.classList.add("is-wrong");
  }

  /* --- wire up ------------------------------------------------------------- */
  trigger.addEventListener("click", onTriggerClick);
  input.addEventListener("keydown", onKeyDown);
  // Clear the warn state the instant the visitor starts correcting, so the
  // red rule/readout doesn't linger while they retype.
  input.addEventListener("input", () => {
    if (gate.classList.contains("is-wrong")) gate.classList.remove("is-wrong");
  });

  return { reset };
}

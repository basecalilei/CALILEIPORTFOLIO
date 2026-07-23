/* =============================================================================
   processLaunchGate.js — the soft "access key" gate for .process-launch controls
   -----------------------------------------------------------------------------
   A sub-module of processModal (the relationship processCards.js has): one
   exported function, imported and invoked by processModal.js only. It gives
   the .process-launch building block its click behavior — a password prompt
   that unfolds directly beneath the pressed control — so launch buttons stay
   PURE AUTHORED HTML in a process's media field: no imports, no wiring, no
   per-button JS. The third sibling of sidebarShopGate (in-flow unfold
   grammar) and desktopLockGate (per-item keys, retargeting) — deliberately
   the same widget a third time; extraction into a shared accessGate is a
   known, deferred decision.

   SOFT GATE — a casual deterrent, not security. Keys are authored in
   plaintext (data-launch-key in the media HTML), which ships to the
   browser; the comparison is trimmed + case-insensitive on purpose,
   forgiving for a casual visitor (same convention as the other two gates).
   Don't put anything behind it that actually needs protecting.

   WHY DELEGATED, NOT BOUND (the shop gate binds; this can't)
     processModal.populate() replaces the media container's innerHTML on
     every open AND every prev/next cycle, destroying and rebuilding every
     .process-launch button. A gate bound to a button reference at build
     time would dangle immediately. So, like processCards, this attaches
     ONE permanent listener to the modal's content container and resolves
     the button per click. The prompt element itself is cached across
     opens and (re)inserted after whichever button was pressed — an
     innerHTML swap merely orphans it; the next open reinserts it.

   AUTHORED DATA SHAPE (on any .process-launch, in any process's media)
     <button class="process-launch" type="button"
             data-launch="ipm" data-launch-key="opensesame">…</button>

     data-launch      names the hand-off — the prompt's LOCKED.[NAME] label
                      and the LAUNCH_ACTIONS lookup key on a correct entry.
     data-launch-key  the access key. Omitted → DEFAULT_KEY below.

   GRANT SEMANTICS — currently a gate to nowhere, on purpose
     A correct key shows the green granted beat, folds the prompt, and runs
     LAUNCH_ACTIONS[name] — which for "ipm" is authored null until the full
     IPM content exists (missing things are silent no-ops, per the house
     rule). Nothing unlocks and nothing persists: every press re-prompts,
     the shop gate's "prompt every time, remember nothing" model. When the
     IPM reveal is authored, fill in the action — or remove this gate and
     let the button call the reveal directly.

   KEYBOARD — the modal collision
     processModal attaches a document-level keydown while open: Escape
     closes the modal, ArrowLeft/ArrowRight cycle processes. Both collide
     with a text input: arrows meant to move the caret would cycle the
     process — repopulating the media and destroying this prompt mid-type —
     and Escape meant to dismiss the prompt would close the whole sheet.
     The input's keydown handler therefore stopPropagation()s Escape
     (after closing the prompt) and both arrows (letting the caret move).
     The modal's handler is bubble-phase on document; the input's fires
     first at the target, so the stop is sufficient.

   RESET CONTRACT (why processModal calls reset in TWO places)
     populate() → reset() before each innerHTML swap, exactly like
     cards.closeAll(): deterministic closed state for incoming content, no
     dangling references. closeProcessModal() → reset() as well — unlike
     the cards, this gate arms a document-level pointerdown listener while
     open, and a prompt left open at modal close would otherwise leave
     that listener live on a closed modal. reset() is idempotent; calling
     it folded is a no-op.

   COUPLED WITH
     - processLaunchGateStyles.css: emits .process-launch-gate and its
       inner classes, including the negative-margin fold trick against
       --process-gap (see the stylesheet header).
     - processModal.js: the only importer — attaches this to its content
       container at build, resets it per populate and per close.
     - Authored media HTML (sidebarProcess.js PROCESSES[].media): emits
       .process-launch markup with data-launch / data-launch-key.
     - textScramble.js: startScramble for the label's decode-in — same
       primitive the other two gates and the menu use, so the reveals
       share a language.
   ========================================================================== */

import { startScramble } from "./textScramble.js";

/* -----------------------------------------------------------------------------
   THE ACTIONS — what a correct key hands off to, per data-launch name.
   null = authored but not built yet (the grant beat runs, the prompt
   folds, nothing else happens — see GRANT SEMANTICS above).
   --------------------------------------------------------------------------- */
const LAUNCH_ACTIONS = {
  // TODO: the full IPM system reveal — unauthored. When the content
  // exists, replace null with the opener (a modal, an expanded card —
  // undecided per processModalStyles.css's building-block note), or
  // remove this gate entirely and wire the button straight to it.
  ipm: null,
};

/* Fallback key for a .process-launch that omits data-launch-key.
   Soft gate only (see file header) — same convention as the shop gate. */
const DEFAULT_KEY = "opensesame";

/* How long the green "granted" beat shows before the fold + hand-off.
   Matches the other gates: long enough to register as confirmation,
   short enough not to stall. */
const GRANT_HOLD_MS = 280;

export function attachProcessLaunch(container) {
  /* --- the prompt — one cached element, built lazily on first use --------
     Same instrument grammar as the other gates: Hornet kicker naming the
     system, /> syntax prompt, hairline data-rule with an activity
     register, brand-color status semantics. Inserted after the pressed
     button per open; innerHTML swaps orphan it, the next open reinserts
     it (the node survives orphaning — it's referenced here). */
  let gate  = null;   // the prompt element, or null until first use
  let input = null;
  let label = null;

  let isOpen         = false;
  let trigger        = null;   // the .process-launch currently prompting
  let unlocking      = false;  // guards the grant beat against double-submit
  let cancelScramble = null;   // the label's in-flight decode, if any
  let holdTimer      = null;   // the grant → hand-off timer

  function buildGate() {
    gate = document.createElement("div");
    gate.className = "process-launch-gate";
    gate.setAttribute("aria-hidden", "true");
    gate.innerHTML = `
      <div class="process-launch-gate-inner">
        <div class="process-launch-gate-label">// LOCKED</div>
        <div class="process-launch-gate-field">
          <span class="process-launch-gate-prompt" aria-hidden="true">/&gt;</span>
          <input class="process-launch-gate-input" type="password"
                 name="process-launch-key" placeholder="enter key"
                 autocomplete="off" spellcheck="false"
                 aria-label="Access key for locked system" />
        </div>
        <div class="process-launch-gate-rule"><span class="process-launch-gate-scan"></span></div>
        <div class="process-launch-gate-status" aria-live="polite"></div>
      </div>
    `;

    input = gate.querySelector(".process-launch-gate-input");
    label = gate.querySelector(".process-launch-gate-label");

    input.addEventListener("keydown", onKeyDown);
    // Clear the warn state the instant the visitor starts correcting, so
    // the red rule/readout doesn't linger while they retype.
    input.addEventListener("input", () => {
      if (gate.classList.contains("is-wrong")) gate.classList.remove("is-wrong");
    });
  }

  /* --- open / retarget ----------------------------------------------------- */
  function open(btn) {
    if (!gate) buildGate();

    // Retarget-or-open: pressing a different launch button while the
    // prompt is up moves the same prompt under it (fresh label, empty
    // field). Insertion is per-open on purpose — after() both places a
    // fresh/orphaned prompt and moves a live one, so the innerHTML-swap
    // and retarget cases are the same line.
    trigger   = btn;
    unlocking = false;
    clearTimeout(holdTimer);
    holdTimer = null;

    const name = btn.dataset.launch || "system";
    label.textContent = `// LOCKED.[${name.toUpperCase()}]`;
    input.value = "";
    input.removeAttribute("readonly");
    gate.classList.remove("is-wrong", "is-correct");

    btn.after(gate);

    if (!isOpen) {
      isOpen = true;
      document.addEventListener("pointerdown", onOutsidePointer, true);
    }
    // Set every open — a reinserted-after-orphaning node keeps its old
    // classes, so this also repairs state after an innerHTML swap.
    gate.classList.add("is-open");
    gate.setAttribute("aria-hidden", "false");

    // Decode the label in — same primitive the other gates and menu use.
    cancelScramble?.();
    cancelScramble = startScramble(label);

    // Focusing scrolls the modal's content to reveal the unfolding prompt
    // (the launch control sits at the bottom of a long stack).
    input.focus();
  }

  function close() {
    if (!isOpen) return;
    isOpen  = false;
    trigger = null;
    unlocking = false;
    clearTimeout(holdTimer);
    holdTimer = null;

    gate.classList.remove("is-open", "is-wrong", "is-correct");
    gate.setAttribute("aria-hidden", "true");
    cancelScramble?.();
    cancelScramble = null;
    document.removeEventListener("pointerdown", onOutsidePointer, true);
    input.blur();
    input.value = "";              // don't leave a typed key sitting around
    input.removeAttribute("readonly");
  }

  /* Idempotent teardown — processModal calls this from populate() (before
     each innerHTML swap, like cards.closeAll) and from close (so the
     document listener never outlives an open modal). See RESET CONTRACT. */
  function reset() {
    if (gate) close();
  }

  /* --- outside-dismiss -----------------------------------------------------
     composedPath (not .contains), per the sibling gates and sidebar.md:
     captured paths survive DOM mutations mid-dispatch. The prompt and ANY
     launch button count as inside — so clicking the field keeps us open,
     re-pressing the active button routes to the delegated click (which
     toggles closed), and pressing a different launch button routes there
     too (which retargets). */
  function onOutsidePointer(e) {
    const path = e.composedPath();
    for (const n of path) {
      if (n === gate) return;
      if (n instanceof Element && n.classList?.contains("process-launch")) return;
    }
    close();
  }

  /* --- keys ---------------------------------------------------------------- */
  function onKeyDown(e) {
    // See KEYBOARD in the file header: Escape and the arrows must not
    // reach processModal's document-level handler while the prompt has
    // focus — Escape would close the whole sheet, arrows would cycle the
    // process and destroy this prompt mid-type.
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.stopPropagation();     // caret movement, not process cycling
      return;
    }
    if (e.key !== "Enter" || unlocking || !trigger) return;
    e.preventDefault();
    const key = trigger.dataset.launchKey ?? DEFAULT_KEY;
    const ok =
      input.value.trim().toLowerCase() ===
      String(key).trim().toLowerCase();
    ok ? grant() : reject();
  }

  function grant() {
    unlocking = true;
    input.setAttribute("readonly", "");        // no edits during the handoff
    gate.classList.remove("is-wrong");
    gate.classList.add("is-correct");

    // Brief green confirmation, then fold and hand off. The action may be
    // null/unauthored — silent no-op by the house rule (see GRANT
    // SEMANTICS). Read the trigger's name BEFORE close() drops it.
    const name = trigger.dataset.launch;
    holdTimer = setTimeout(() => {
      close();
      LAUNCH_ACTIONS[name]?.();
    }, GRANT_HOLD_MS);
  }

  function reject() {
    input.value = "";
    input.focus();
    gate.classList.remove("is-correct");
    // Re-trigger the shake even on consecutive wrong entries: drop the
    // class, force a reflow, re-add — otherwise the keyframes only play
    // the first time the class appears.
    gate.classList.remove("is-wrong");
    void gate.offsetWidth;
    gate.classList.add("is-wrong");
  }

  /* --- the one delegated listener ------------------------------------------ */
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".process-launch");
    if (!btn || !container.contains(btn)) return;
    // Toggle on the active button; open/retarget on any other.
    if (isOpen && btn === trigger) close();
    else open(btn);
  });

  return { reset };
}

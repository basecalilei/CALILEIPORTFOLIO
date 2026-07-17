/* =============================================================================
   desktopTaskbar.js — the bottom taskbar for the "desktop" PANEL TYPE
   -----------------------------------------------------------------------------
   A passive reader of state.windows that renders one slot per open
   window, anchored at the bottom of the screen rectangle. Click a slot
   to bring that window to the front.

   SCOPE
     - A static identity section ("start button") at the left end —
       //CALILEI.[DESKTOP], sectioned off from the slot list the way
       the clock is on the right. Ornamental for now: no click
       behavior, no state. See buildStartSection for the upgrade path.
     - One slot per open window (minimized windows included)
     - Slot label = item.name
     - The currently-focused (top-z VISIBLE) slot is visually highlighted
     - Minimized window slots get a dimmer visual state
     - Click rules (see focusWindowById in desktopPanel.js for routing):
         - Click a minimized window's slot → restore + bring to front
         - Click the currently-focused window's slot → minimize it
         - Click a background visible window's slot → bring to front
     - A clock on the right showing time + date, locale-aware,
       updating on the minute boundary

   NOT IN SCOPE (future step)
     - Pinned shortcuts: a separate left-side region for authored or
       user-pinned items that aren't currently open.

   THE READER CONTRACT
   This module never WRITES to state. It reads state.windows + state.items
   on every notification and rebuilds its DOM. All window state changes
   (open, close, focus) go through the existing window machinery in
   desktopPanel.js, which calls notifyWindowsChanged after each. The
   taskbar's only outbound action is calling focusWindowById on click,
   which delegates to focusWindow — the same code path used by clicking
   the window itself.

   It also registers itself as the panel's MINIMIZE TARGET PROVIDER
   (setMinimizeTargetProvider): when a window minimizes or restores, the
   panel asks "where is this item's slot?" and the taskbar answers with
   the slot's rect so the window can fly to/from it. Answering a
   geometry question is read-only — the provider hands measurements out
   and writes nothing — so the reader contract holds. If this module is
   deleted, the panel falls back to a bottom-center pseudo-slot; nothing
   breaks.

   FULL REBUILD ON EACH NOTIFY
   The slot list is rebuilt from scratch on every change, no diffing.
   With <10 open windows in practice the savings from incremental
   updates aren't worth the complexity. innerHTML = "" + a fresh loop
   is also robust against accidentally drifting from the source of
   truth: if state.windows changes for any reason, the next render
   reflects it exactly.

   THE CLOCK is independent of the windows subscription. It runs on
   its own timer (aligned to the minute boundary) and only touches
   its own two text nodes — no relation to state, no rebuild on
   window changes.

   COUPLED WITH
     - desktopPanel.js: imports subscribeWindowsChanged + focusWindowById.
     - desktopTaskbarStyles.css: emits .desktop-taskbar, .desktop-taskbar-start,
       .desktop-taskbar-start-mark, .desktop-taskbar-list,
       .desktop-taskbar-slot, .desktop-taskbar-slot--focused,
       .desktop-taskbar-slot--minimized, .desktop-taskbar-clock,
       .desktop-taskbar-clock-time, .desktop-taskbar-clock-date.
   ========================================================================== */

import {
  subscribeWindowsChanged,
  focusWindowById,
  setMinimizeTargetProvider,
} from "./desktopPanel.js";

/* -----------------------------------------------------------------------------
   PUBLIC API
   -----------------------------------------------------------------------------
   buildTaskbar(state)
     Creates the taskbar DOM, wires its subscription to window changes,
     does an initial render so the bar is correct at first paint.
     Returns the DOM element — the caller appends it where it wants
     (typically as a child of state.screen so it lives in the screen's
     coordinate space and is hidden along with the screen on collapse).

     No init/dispose pattern: the subscription lives for the panel's
     lifetime, which is the page's lifetime in this project (panels
     aren't disposed and re-mounted at runtime).
   --------------------------------------------------------------------------- */
export function buildTaskbar(state) {
  const bar = document.createElement("div");
  bar.className = "desktop-taskbar";

  // The start section — the bar's left-end identity region, before the
  // slot list, where an OS taskbar puts its start button. Purely
  // ornamental for now: a static label, no click behavior, no reads or
  // writes of state (even simpler than the clock — no timer). CSS keeps
  // pointer-events off so it can't catch clicks. WHEN IT GROWS BEHAVIOR:
  // swap the <div> for a <button type="button">, re-enable its
  // pointer-events under the .is-clear gate, and route its action
  // through a panel-exported function — same contract as the slots.
  bar.appendChild(buildStartSection());

  const list = document.createElement("div");
  list.className = "desktop-taskbar-list";
  bar.appendChild(list);

  // The clock occupies the right end of the bar. It's a passive
  // peripheral — runs on its own timer and never reads or writes
  // state. Builds its own DOM, returns refs to the two text nodes
  // so startClock can update them without re-traversing.
  const { clockEl, timeEl, dateEl } = buildClock();
  bar.appendChild(clockEl);
  startClock(timeEl, dateEl);

  // Click delegation — one listener on the list catches every slot click.
  // No per-slot listeners means no cleanup on re-render (slots are
  // destroyed and rebuilt freely; the list's listener persists).
  list.addEventListener("click", (e) => {
    const slot = e.target.closest(".desktop-taskbar-slot");
    if (!slot) return;
    const id = slot.dataset.id;
    if (id) focusWindowById(state, id);
  });

  // Initial render runs synchronously so the bar is correct at first
  // paint — no flash of empty bar before the first notification fires.
  // Then subscribe for future changes.
  render(state, list);
  subscribeWindowsChanged(state, () => render(state, list));

  // Tell the panel where minimized windows fly to: this window's slot.
  // The lookup runs against OUR list element at flight time (slots are
  // rebuilt on every notify, so caching an element would go stale — a
  // fresh query is always current). Handing geometry out is read-only,
  // so this stays within the reader contract: the taskbar still never
  // writes panel state. If the slot isn't rendered for any reason we
  // return null and the panel uses its own fallback target.
  setMinimizeTargetProvider(state, (itemId) => {
    const slot = list.querySelector(
      `.desktop-taskbar-slot[data-id="${CSS.escape(itemId)}"]`
    );
    return slot ? slot.getBoundingClientRect() : null;
  });

  return bar;
}

/* -----------------------------------------------------------------------------
   RENDER
   -----------------------------------------------------------------------------
   Reads state.windows + state.items, rebuilds the slot list. Determines
   which window is on top by max zIndex (nextZ is monotonic, so the most
   recently focused window has the highest value).
   --------------------------------------------------------------------------- */
function render(state, list) {
  list.innerHTML = "";

  // Find the focused (top-z VISIBLE) window's id. Minimized windows
  // keep their zIndex but they aren't "focused" — by definition the
  // user can't see them. If no visible windows exist, focusedId stays
  // null and no slot gets the focused highlight.
  let focusedId = null;
  let maxZ = -Infinity;
  for (const [id, win] of state.windows) {
    if (win.minimized) continue;
    if (win.zIndex > maxZ) {
      maxZ = win.zIndex;
      focusedId = id;
    }
  }

  // One slot per open window (minimized or not — minimized windows
  // still appear in the bar; that's the whole point of the bar). Order
  // is state.windows insertion order, which is the order they were
  // opened. Equivalent to how OS taskbars order their open-window slots.
  for (const [id, win] of state.windows) {
    const item = state.items.get(id);
    if (!item) continue;     // defensive: shouldn't happen, but skip
                             // any window without a backing item.

    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "desktop-taskbar-slot";
    if (id === focusedId) slot.classList.add("desktop-taskbar-slot--focused");
    if (win.minimized) slot.classList.add("desktop-taskbar-slot--minimized");
    slot.dataset.id = id;

    const label = document.createElement("span");
    label.className = "desktop-taskbar-slot-label";
    label.textContent = item.name;
    slot.appendChild(label);

    list.appendChild(slot);
  }
}

/* -----------------------------------------------------------------------------
   CLOCK
   -----------------------------------------------------------------------------
   Two-line right-aligned readout — time on top, date below. Locale-aware
   via Intl.DateTimeFormat with `undefined` locale, which picks up the
   browser's. Renders in the user's native conventions (US: "4:30 PM" +
   "Mon, Jun 2"; other locales differ).

   The formatters are module-scoped so they're constructed once, not on
   every tick. Intl.DateTimeFormat creation isn't free.

   TICK ALIGNMENT
   The displayed precision is one minute, so the clock ticks once per
   minute — but ALIGNED to the minute boundary, not 60s from buildTaskbar.
   On startup we render immediately, then setTimeout until the next :00
   second, then setInterval every 60s from there. The user sees the
   minute change happen at the actual minute change, not at a drifted
   offset somewhere mid-minute.

   No interval cleanup wiring: the taskbar lives for the page's
   lifetime in this project, same as the windows subscription. If a
   teardown path ever appears, returning the interval ID from
   startClock and clearing it in a future dispose function is the move.
   --------------------------------------------------------------------------- */

/* -----------------------------------------------------------------------------
   START SECTION
   -----------------------------------------------------------------------------
   The left-end identity region — a sectioned-off zone of the bar
   (mirroring the clock's treatment on the right) carrying the
   //CALILEI.[DESKTOP] label: the syntax in the instrument voice
   (Hornet) and CALILEI itself in the display voice (Gridnik Bold),
   the bar's one wordmark moment, balancing the clock at the right end.
   Static by design: a <div>, not a <button>, because it does nothing
   yet and shouldn't advertise interactivity it doesn't have (hover
   states, focus ring, cursor). The upgrade path is documented at the
   call site in buildTaskbar.
   --------------------------------------------------------------------------- */
function buildStartSection() {
  const el = document.createElement("div");
  el.className = "desktop-taskbar-start";

  // Two voices in one label. The syntax (`//`, `.[ ]`) is ornament and
  // stays in the instrument face inherited from the section; CALILEI is
  // the wordmark, so it gets its own span to carry Gridnik Bold (Tier 1
  // display). Text nodes rather than innerHTML — no parsing, nothing to
  // escape, and the structure is explicit.
  //
  // The label sits inside ONE wrapper span, which matters: the section is
  // a flex container, and bare text nodes in a flex container become
  // anonymous flex items — each face would get its own box and the two
  // baselines would drift apart. Inside the wrapper it's ordinary inline
  // text, so the browser aligns the baselines for free, and flex only has
  // to center a single child.
  const label = document.createElement("span");
  label.className = "desktop-taskbar-start-label";

  label.appendChild(document.createTextNode("//"));

  const mark = document.createElement("span");
  mark.className = "desktop-taskbar-start-mark";
  mark.textContent = "CALILEI";
  label.appendChild(mark);

  label.appendChild(document.createTextNode(".[DESKTOP]"));

  el.appendChild(label);

  return el;
}

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

function buildClock() {
  const clockEl = document.createElement("div");
  clockEl.className = "desktop-taskbar-clock";

  const timeEl = document.createElement("span");
  timeEl.className = "desktop-taskbar-clock-time";

  const dateEl = document.createElement("span");
  dateEl.className = "desktop-taskbar-clock-date";

  clockEl.appendChild(timeEl);
  clockEl.appendChild(dateEl);

  return { clockEl, timeEl, dateEl };
}

function renderClock(timeEl, dateEl) {
  const now = new Date();
  timeEl.textContent = TIME_FMT.format(now);
  dateEl.textContent = DATE_FMT.format(now);
}

function startClock(timeEl, dateEl) {
  // Immediate render so the clock is correct at first paint.
  renderClock(timeEl, dateEl);

  // Align to the next minute boundary, then tick every 60s.
  // Math: ms remaining in the current minute = (60 - sec)*1000 - ms.
  const now = new Date();
  const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

  setTimeout(() => {
    renderClock(timeEl, dateEl);
    setInterval(() => renderClock(timeEl, dateEl), 60_000);
  }, msUntilNextMinute);
}
/* =============================================================================
   cancels.js — cancel-group helper
   -----------------------------------------------------------------------------
   A tiny factory: createCancelGroup() returns { add, cancelAll }. Callers
   register cancel functions for in-flight work and call cancelAll() to
   stop everything at once. Typical sources for the cancel functions:
     - startScramble (textScramble.js) returns a stop function
     - requestAnimationFrame: store the id, push () => cancelAnimationFrame(id)
     - setTimeout / setInterval: same pattern
     - fetch: AbortController — push () => controller.abort()
     - any async operation that exposes a cancel/dispose handle

   WHY THIS EXISTS
     The pair (cancels list, cancelAll function) emerged in the sidebar's
     view modules (sidebarHome, sidebarAbout, sidebarProjects), where
     visibility hooks fire repeatedly and each entry must cancel the
     previous one's in-flight work to stay idempotent. Once a fourth
     consumer appeared — projectModal needing the same shape for its
     title-scramble cancellation — the helper was renamed from
     sidebarCancels to cancels: the pattern is general, not sidebar-
     specific, and the prefix was lying about scope.

     Any module that ties cancellable work to a lifecycle event is a
     legitimate consumer. CSS-driven animation doesn't need it (toggling
     a class self-cancels); JS-driven almost always does.

   WHY A FACTORY, NOT A SINGLETON
     Each caller owns its own group at module scope — independent
     lifetimes, independent cancel pools. A singleton would entangle
     them: one caller's cancelAll() catching another's in-flight work,
     or a module leaking cancels into another's pool. The factory keeps
     each caller's group private to its module.

   WHY .add() RATHER THAN EXPOSING THE ARRAY
     `cancels.add(fn)` reads as a sentence; `cancels.push(fn)` reads as
     "I happen to know this is an array." The cost of the wrapper is one
     method call — and in return the helper is free to evolve its internal
     storage (a Set for dedup? a doubly-linked list for ordered removal?)
     without rippling through consumers.

   USAGE (sidebar view shown; same shape works in any module)
     import { createCancelGroup } from "./cancels.js";
     import { startScramble }     from "./textScramble.js";

     const cancels = createCancelGroup();

     export const someView = {
       name: "some",
       buildDOM(nav) { ... return el; },
       onEnter(el) {
         cancels.cancelAll();                              // defensive reset
         cancels.add(startScramble(el.querySelector(".x")));
         cancels.add(startScramble(el.querySelector(".y")));
       },
       onExit() {
         cancels.cancelAll();                              // clean up before hidden
       },
     };
   ========================================================================== */

export function createCancelGroup() {
  // Module-private list. Closed over by add/cancelAll; never exposed.
  const list = [];

  return {
    /**
     * Record a cancel function. Returns the same function unchanged, so
     * callers can chain if they need to keep a local reference too. No
     * dedup, no null-guard — pushing falsy values would just blow up
     * cancelAll, which is correct (a cancel slot that holds undefined
     * was a bug at the call site, not something this helper papers over).
     */
    add(cancel) {
      list.push(cancel);
    },

    /**
     * Invoke every recorded cancel and empty the list. Safe to call when
     * the list is empty (no-op). Safe to call repeatedly — second call
     * runs over nothing. Iteration uses a snapshot of length so cancels
     * that schedule new work via add() during cancellation don't break
     * the loop. (No current consumer does that, but the pattern is cheap
     * insurance.)
     */
    cancelAll() {
      const n = list.length;
      for (let i = 0; i < n; i++) list[i]();
      list.length = 0;
    },
  };
}

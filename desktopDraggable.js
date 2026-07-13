/* =============================================================================
   desktopDraggable.js — drag/click utility for the "desktop" PANEL TYPE
   -----------------------------------------------------------------------------
   A tiny helper that takes a handle element and a set of callbacks, then
   produces correct click-vs-drag behaviour using the Pointer Events API.

   Used three ways inside desktopPanel.js:
     1. Folder/file ICONS — onClick opens, onDrag moves (with portal-reparent).
     2. WINDOW headers     — onClick focuses, onDrag moves the window.
     3. (Future close/min buttons can use onClick only.)

   THE CLICK-VS-DRAG DISTINCTION
     Pressing and releasing within CLICK_THRESHOLD_PX of the pointerdown
     position counts as a click. Crossing the threshold during pointermove
     promotes the interaction to a drag — onDragStart fires once, then
     onDrag fires every move, then onDragEnd on release.

     Threshold matches the same value used by gridModal.js so the feel is
     uniform across the project.

   ONE ACTIVE DRAG AT A TIME
     A page only ever has one pointer interaction in flight. Module-level
     `activeDrag` tracks it; window-level pointermove/up listeners route to
     whichever drag is current. This avoids attaching/detaching window
     listeners on every drag — they're added lazily on first use, then
     stay for the page lifetime.

     The pointerId check inside the handlers means a second pointer
     (touch + mouse, multi-touch) can't hijack an in-flight drag — only
     the originating pointer can advance or end it.

   POINTER CAPTURE
     setPointerCapture on the handle means pointermove/up keep firing on
     it even if the pointer leaves the element bounds. Wrapped in
     try/catch because some platforms refuse capture under specific
     conditions (e.g. synthetic events in tests) and we'd rather degrade
     to "drag works without capture" than throw.

   COORDINATES
     Callbacks receive (dx, dy) deltas relative to the pointerdown
     position, in client (CSS) pixels. The caller decides how to apply
     them — typically by recording the element's starting position in
     onDragStart and writing `start + d*` in onDrag.
   ========================================================================== */

/* -----------------------------------------------------------------------------
   TUNABLES
   --------------------------------------------------------------------------- */
const CLICK_THRESHOLD_PX = 5;   // pointer travel below this on release is a
                                //   click; above is (or was) a drag. Matches
                                //   gridModal.js for consistency.

/* -----------------------------------------------------------------------------
   MODULE STATE
   -----------------------------------------------------------------------------
   activeDrag is the single in-flight interaction. The shape of the object
   is set in the pointerdown handler returned by makeDraggable; the window
   handlers below only read from it.
   --------------------------------------------------------------------------- */
let activeDrag = null;
let windowListenersAttached = false;

/* -----------------------------------------------------------------------------
   WINDOW-LEVEL HANDLERS
   -----------------------------------------------------------------------------
   Attached once, lazily, on the first makeDraggable call. They check
   activeDrag.pointerId so a stray pointer from another input device can't
   advance someone else's drag.
   --------------------------------------------------------------------------- */
function ensureWindowListeners() {
  if (windowListenersAttached) return;
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  windowListenersAttached = true;
}

function onPointerMove(e) {
  if (!activeDrag || e.pointerId !== activeDrag.pointerId) return;

  const dx = e.clientX - activeDrag.startX;
  const dy = e.clientY - activeDrag.startY;

  // Promote to drag on first move past threshold. onDragStart fires here so
  // the caller can record "drag start" state at the moment the interaction
  // is recognised as a drag (not at pointerdown — at pointerdown we don't
  // yet know whether it's a click or a drag).
  if (!activeDrag.dragging && Math.hypot(dx, dy) > CLICK_THRESHOLD_PX) {
    activeDrag.dragging = true;
    activeDrag.onDragStart(e);
  }

  if (activeDrag.dragging) {
    activeDrag.onDrag(dx, dy, e);
  }
}

function onPointerUp(e) {
  if (!activeDrag || e.pointerId !== activeDrag.pointerId) return;

  // Snapshot then clear, so the callback can start a new drag if it wants
  // without re-entering us.
  const drag = activeDrag;
  activeDrag = null;

  if (drag.dragging) {
    drag.onDragEnd(e);
  } else {
    drag.onClick(e);
  }
}

/* -----------------------------------------------------------------------------
   PUBLIC API
   -----------------------------------------------------------------------------
   makeDraggable(handle, options)
     handle  — the element that receives pointerdown
     options — callback bag (all optional except onDrag if you want the
               element to actually move):

         onClick(e)         — pointerup with no movement past threshold
         onDragStart(e)     — first frame the drag is recognised
         onDrag(dx, dy, e)  — every subsequent move
         onDragEnd(e)       — pointerup after a drag

     Missing callbacks default to no-ops, so a click-only handle (no drag
     wanted) can pass just { onClick }.
   --------------------------------------------------------------------------- */
export function makeDraggable(handle, options = {}) {
  const onClick     = options.onClick     || (() => {});
  const onDragStart = options.onDragStart || (() => {});
  const onDrag      = options.onDrag      || (() => {});
  const onDragEnd   = options.onDragEnd   || (() => {});

  handle.addEventListener("pointerdown", (e) => {
    // Left mouse button (or any touch/pen). Ignore right-click, middle, etc.
    // — they'd otherwise grab the drag state and never receive a matching
    // pointerup of the kind we expect.
    if (e.button !== undefined && e.button !== 0) return;

    // Refuse to start a new drag if one is already in flight (defensive —
    // shouldn't happen because pointer capture funnels events to one
    // element, but covers the edge case of overlapping handles where the
    // outer one didn't capture).
    if (activeDrag) return;

    ensureWindowListeners();

    activeDrag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      onClick, onDragStart, onDrag, onDragEnd,
    };

    // Pointer capture keeps move/up events flowing to this element even if
    // the pointer leaves its bounds. try/catch because some browsers throw
    // here under specific conditions; the drag still works without capture
    // because we listen on window.
    try { handle.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  });
}

/* =============================================================================
   cursor.js — the INVERTING CROSSHAIR (site-wide enhancement module)
   -----------------------------------------------------------------------------
   Replaces the static SVG crosshair from infiniteStyles.css with one that
   inverts against whatever it's over: black over the white page, white over the
   dark md-editor window, complements over the brand colors.

   WHY IT CAN'T BE A CSS cursor
     The `cursor` property paints a fixed bitmap above the page with no access
     to blend modes — no static cursor can react to what's beneath it. So the
     native cursor is hidden (body { cursor: none } in infiniteStyles.css) and
     this module draws its own: a fixed-position element that follows the mouse
     with `mix-blend-mode: difference`. A white shape on difference computes
     |background − white| per pixel — true inversion, done by the compositor,
     no color sampling or JS readbacks.

   PRESERVING EVERY OTHER CURSOR (the load-bearing rule)
     The core comment for the old rule promises that element-specific cursors
     still win: grab/grabbing on the turn model, the resize arrows on window
     edges, pointer on buttons, I-beam over text fields. This module keeps that
     promise mechanically:

       hovered element's computed cursor == "none"
         → it INHERITED the body cursor → this is crosshair territory → show ours
       computed cursor == anything else (grab, pointer, text, ew-resize, auto…)
         → the element (or the UA) declared its own affordance → hide ours,
           and since that element's own `cursor` rule beats the inherited
           `none`, the NATIVE cursor shows there, exactly as before.

     Because "inherited the body value" is precisely where the old crosshair
     appeared, the new cursor appears in exactly the same places — no per-type
     bookkeeping, and panel types that later add `cursor: pointer` to their
     buttons keep working with zero changes here.

     The check runs on hover transitions, and continuously while a mouse
     button is held (drag state can change mid-press with no target change).

   THE --cursor PROTOCOL (drag + pointer variants)
     Drag surfaces and clickable elements used to show the native hands (open
     grab / pointing finger) — stock OS glyphs inside an otherwise designed
     cursor system, and invisible to inversion. Their rules now declare
     `cursor: none; --cursor: <intent>;`: `none` hides the native cursor, and
     the custom property carries the intent this module reads:

       --cursor: grab      → arrowheads on the crosshair's four ends
                             ("movable in any direction")
       --cursor: grabbing  → arrowheads + compressed (gripped; set by the
                             modules' .is-dragging states)
       --cursor: pointer   → the crosshair's center gap gains a dot — the
                             reticle acquires a target ("clickable")

     Pressing the mouse button also compresses the glyph (.is-pressed, set
     here on mousedown/mouseup) — so "pressed = compressed" reads the same
     whether you're gripping a drag or clicking a button. Custom properties
     inherit like `cursor` does, so a surface's children report it too. Each
     module's stylesheet still owns its own affordance in the same rule it
     always did; this module just renders it. Bare <a> links get their pointer
     from the UA stylesheet, so cursorStyles.css opts them in with one author
     rule. Everything else (resize, I-beam) is untouched — those compute
     non-none and the native cursor shows.

   SHAPE
     The same geometry as the old cursor: 32×32, four 1px lines with an 8px
     center gap, hotspot at the center. Stroke is pure white — on difference,
     white is what yields full inversion. (Inherent limit: over a perfect 50%
     grey, |v − 255| ≈ v and the cursor nearly vanishes; nothing in the site's
     palette sits there, but it's the one background inversion can't win.)

   LIFECYCLE
     - Gated on (pointer: fine) — touch devices never get a fake cursor.
     - Hidden until the first real mousemove; hidden again when the pointer
       leaves the document (so it doesn't hang mid-page when the mouse exits).
     - Position updates via transform only (compositor path, no layout).

   NOT A PANEL TYPE
     This registers nothing and reads no scroll state — it's a standalone
     side-effect module like the taskbar. main.js imports it once.

   COUPLED WITH
     - infiniteStyles.css: the body rule must be `cursor: none` (ONE core edit;
       the old data-URI crosshair rule is superseded by this module).
     - cursorStyles.css: positioning, blend mode, visibility states.
     - index.html: <link> to cursorStyles.css.
     - main.js: `import "./cursor.js";`
   ========================================================================== */

/* Fine-pointer devices only. On touch there is no hover point to represent;
   simulated mousemove events on tap would otherwise flash the crosshair. */
if (window.matchMedia("(pointer: fine)").matches) {

  /* The cursor element. Same 32×32 four-segment geometry as the old data-URI
     crosshair (lines 0–12 and 20–32 through center 16), stroke white for the
     difference blend. Built here rather than in index.html so the module is
     self-contained — remove the import and every trace is gone. */
  const el = document.createElement("div");
  el.className = "site-cursor is-hidden";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `
    <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <line x1="16" y1="0"  x2="16" y2="12" stroke="white"/>
      <line x1="16" y1="20" x2="16" y2="32" stroke="white"/>
      <line x1="0"  y1="16" x2="12" y2="16" stroke="white"/>
      <line x1="20" y1="16" x2="32" y2="16" stroke="white"/>
      <!-- Drag affordance: arrowheads on the four ends ("movable in any
           direction"). Hidden by default; .is-drag reveals them (CSS). -->
      <g class="cursor-arrows" fill="none" stroke="white">
        <polyline points="12,4 16,0 20,4"/>
        <polyline points="12,28 16,32 20,28"/>
        <polyline points="4,12 0,16 4,20"/>
        <polyline points="28,12 32,16 28,20"/>
      </g>
      <!-- Click affordance: the center gap gains a dot — reticle on target.
           Hidden by default; .is-point reveals it (CSS). -->
      <circle class="cursor-dot" cx="16" cy="16" r="2.5" fill="white"/>
    </svg>
  `;
  document.body.appendChild(el);

  /* Cache the hovered element so the style check normally runs only on hover
     transitions. While a mouse button is held, re-evaluate every move instead:
     drag state flips (grab → grabbing via .is-dragging) without the target
     changing, and drags are transient enough that the extra reads are cheap. */
  let lastTarget = null;

  /* Read the hovered element's affordance and set the cursor's state:
       computed cursor ≠ "none"        → suppressed (native cursor shows)
       --cursor: grab                  → drag variant (arrowheads)
       --cursor: grabbing              → drag variant, compressed (gripped)
       --cursor: pointer               → point variant (center dot)
       otherwise                       → plain crosshair */
  const evaluate = (target) => {
    let cursor = "none";
    let custom = "";
    if (target instanceof Element) {
      const cs = getComputedStyle(target);
      cursor = cs.cursor;
      custom = cs.getPropertyValue("--cursor").trim();
    }
    const sup = cursor !== "none";
    const drag = !sup && (custom === "grab" || custom === "grabbing");
    el.classList.toggle("is-suppressed", sup);
    el.classList.toggle("is-drag", drag);
    el.classList.toggle("is-drag-active", drag && custom === "grabbing");
    el.classList.toggle("is-point", !sup && custom === "pointer");
  };

  document.addEventListener("mousemove", (e) => {
    // Follow the pointer. The -16px margins in CSS center the 32×32 box on the
    // hotspot, so transform carries only the raw pointer position.
    el.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
    el.classList.remove("is-hidden");

    // Affordance check — on hover transitions, and continuously mid-press.
    if (e.target !== lastTarget || e.buttons) {
      lastTarget = e.target;
      evaluate(e.target);
    }
  });

  /* Click boundaries flip drag state immediately (grab ⇄ grabbing) without a
     mousemove; evaluate right away so the grip doesn't lag the press. The
     .is-pressed compression is the click-side twin of the drag grip:
     button down = glyph compressed, everywhere. */
  document.addEventListener("mousedown", (e) => {
    el.classList.add("is-pressed");
    evaluate(e.target);
  });
  document.addEventListener("mouseup", (e) => {
    el.classList.remove("is-pressed");
    lastTarget = null;               // classes may have changed; force re-read
    evaluate(e.target);
  });

  /* Pointer left the window: hide, drop any press (a release outside the
     window never reaches us), and forget the cached target so re-entry
     re-evaluates (the DOM under the pointer may have changed while away). */
  document.addEventListener("mouseleave", () => {
    el.classList.add("is-hidden");
    el.classList.remove("is-pressed");
    lastTarget = null;
  });
}

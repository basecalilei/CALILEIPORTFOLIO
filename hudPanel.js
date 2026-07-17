/* =============================================================================
   hudPanel.js — the "hud" PANEL TYPE
   -----------------------------------------------------------------------------
   An avionics-inspired HUD end card — a full-viewport instrument face (HSI /
   nav-display) rendered entirely in 2D. No scene, no buttons, no modal. The
   site's visual language at full volume: Hornet readouts, hairline rules,
   brand primaries as status colors.

   TWO LAYERS, INVERTED FROM THE USUAL PANEL
     Most panels put their content in the overlay and let --shift carry it
     with the scroll. This panel wants the opposite: the whole instrument
     stays STILL while exactly one element rides the scroll (the user's
     "page is still moving" cue). So:

     1. The STAGE (.hud-stage) — the static HUD body: the dial SVG, every
        readout cluster, the frame chrome. A viewport-fixed SIBLING of the
        overlay, inserted before it in #infinite-overlays. Does NOT move
        with scroll. Fades with the same `grow` value as the overlay so
        the two layers enter and leave as one panel.

     2. The OVERLAY (.hud-overlay) — carries the scroll-linked pair and
        nothing else: the horizon line (.hud-horizon) and the headline
        (.hud-headline). The core writes --shift on the overlay every
        frame and the base .infinite-overlay transform consumes it, so
        both ride the scroll at native speed (SHIFT = one viewport per
        panel-unit) with ZERO custom scroll code — the core's own
        pipeline is the scroll-link. When the scroll settles, --shift is
        0: the horizon sits exactly on the dial's center axis and the
        headline docks back onto the plate.

   WHY THE STAGE IS A SIBLING OF THE OVERLAY (NOT A CHILD)
     The overlay carries `transform: translateY(calc(-50% + var(--shift)))`.
     A transformed ancestor creates a containing block for positioned
     descendants, so a child of the overlay would inherit the shifted
     coordinate space and drag along with scroll — the one thing the stage
     must not do. Sibling escapes that: the stage lives directly in
     #infinite-overlays (position:fixed, viewport coverage, no transform),
     so absolute positioning there is viewport-relative and the stage
     holds still as the overlay shifts past.

     Same pattern wallPanel.js uses for its textWall (and for the same
     containing-block reason).

   STACKING — NO Z-INDEX NEEDED
     Sibling positioned elements without explicit z-index stack by DOM
     order: later = higher. The stage is `insertBefore`-d ahead of the
     overlay, so the scroll-linked pair paints ABOVE the instrument —
     moving elements sweeping over a fixed face, which is exactly the
     HUD read.

   SCROLL-DRIVEN MOTION
     Beyond the overlay pair, three things read the scroll directly via
     tick()'s `dist` argument: two of the dial's rings spin (different
     rates, opposite directions) and the heading + range readouts count.
     dist is 0 at rest and continuous anywhere near view (its only jump
     is at the far side of the loop, where the panel is long invisible),
     so the piece always settles back to the authored composition and
     can't pop at the wrap seam. Per the house motion doctrine the
     machine moves smoothly while the numbers update in steps. Rates are
     the SPIN_* / *_REST / *_RATE constants below.

   IDLE MOTION
     The display layer carries ambient life while the panel is visible;
     the paper layer — rules, crosses, plates, fiducials — stays inert,
     per the substrate doctrine (visualLanguage.md):
       - the bearing pointer HUNTS smoothly around its rest bearing on
         two incommensurate sines (a single sine reads as mechanical;
         the sum never quite repeats) — and the bottom scale bar's heavy
         segment tracks the same hunt, a coupled indicator,
       - the wind readout takes a bounded stepped random walk,
       - the LAM ETA counts down in real seconds and reseeds at zero,
       - the hatch field twinkles, one row regenerating at a time, with
         sparse brand-color pings,
       - the DME distances (VOR1, ILS2) close on their stations in
         stepped 0.1 NM writes, reseeding past zero — station passage,
         next leg — and TERR walks its clearance values; every one of
         these writes carries the UPDATE AFTERGLOW (the visual
         language's write signature): the value snaps to write-blue,
         then decays back,
       - the AUTO and DME HOLD annunciators arm and release on
         independent irregular cycles — the checkbox fills while armed,
       - GPS does a quick acquisition double-blink at long intervals,
       - the dotted range ring's dots march in a slow crawl (the one
         smooth machine motion of the second pass).
     Same doctrine throughout: smooth motion for the machine, stepped
     writes for the numbers. Everything runs on a module clock
     accumulated from tick's dt (state.idleT — dt's seconds are proven
     by the fade math; t's units aren't assumed), gated on visibility so
     off-screen panels pay nothing.

   THE CONTACT FIELD
     The traffic plotted inside the dial — TCAS-style altitude tags with
     diamond-and-arrow marks, waypoint/project fiducials, and signal
     readouts (the fiducial-label pattern from visualLanguage.md, plotted
     live). DOM elements, not SVG: tag boxes self-size to their text, the
     hot state is a class toggle, and the text primitives can reach them
     later. Positions are written as vmin-unit transforms, sharing the
     dial's coordinate system (1440 units = 100vmin) with no resize
     handling. Three motions layer on each contact:

       FLOAT — anchored wander: a per-contact Lissajous (randomized
         rates/phases, seeded at init) around the AUTHORED position.
         Chosen over free-velocity drift on purpose: free drift needs
         containment and collision shepherding and slowly shuffles the
         composition; anchored wander floats while guaranteeing the
         field always reads as the designed layout. The default mode.

       TRANSIT — contacts authored with trk/spd (compass track °, dial
         units/s) fly a straight world-frame track across the dial
         instead of wandering: they fade out over the coverage edge and
         re-enter antipodally once fully faded, like traffic leaving
         and entering radar coverage. Reserved for some of the TCAS
         tags — waypoint fiducials and signal readouts are stations,
         and stations hold.

       ORBIT — glyph contacts authored with `orb` (deg/s, sign = the
         direction) circle the center on their authored radius, like
         traffic in holding patterns. Inner orbits are authored faster
         than outer ones — cheap Kepler, which makes the field read as
         physical. Orbiters never leave coverage; directional ones face
         their tangent (see FACE).

       TUMBLE — SYMMETRIC glyph marks take `tum` (deg/s), a slow
         own-axis spin layered onto whatever carries them — a transit
         track or an orbit: tumbling objects crossing or circling the
         scope. Reserved for marks with no facing — a directional mark
         tumbling reads as broken.

       FACE — DIRECTIONAL (aircraft-shaped) glyph marks authored with
         `face` are heading-aligned instead: a transiting one holds its
         track heading, an orbiting one faces the tangent of its ring —
         a holding pattern — both inclusive of the field rotation. This
         is how radar traffic symbology draws targets: along their
         heading.

     Glyph contacts (t: "glyph", n → assets/svg/logo<n>.svg) render as
     CSS masks painted in currentColor — NOT <img> tags, which are
     opaque to CSS — so cursor designation recolors them exactly like
     the text tags, for free.

       SCROLL — the field rotates with `dist` at FIELD_SPIN: the same
         direction as the rim card but lagging it, so card and traffic
         read as one world turning, with parallax depth between them.
         Like everything dist-keyed, it lands on the authored frame at
         rest.

       CURSOR — interrogation: the contact nearest the cursor within
         CAPTURE_R is designated — it lights the write-event blue; a
         wandering contact additionally eases its wander to zero,
         locking onto its plotted position. Transiting traffic is
         highlighted but never stopped — traffic doesn't halt for the
         cursor; only wanderers lock. Implemented with a module-level
         mousemove listener plus coordinate math (wallPanel's
         precedent), NOT pointer-events: the stage stays
         wheel-transparent and the scroll contract is untouched. No
         cursor (touch) simply means no designation.

   CONTENT AUTHORING
     The PANELS entry may override the pieces that speak to the
     reader or name real work:
       { type: "hud", headline: "THANK YOU", url: "www.calilei.com",
         contacts: [ { t: "id", s: "AZULI", x: 179, y: 265 }, ... ] }
     `contacts` replaces DEFAULT_CONTACTS wholesale (t: "alt" | "id" |
     "db" | "glyph"; x/y in dial units, center-relative; glyphs take
     n → assets/svg/logo<n>.svg, a carrier — orb | trk/spd | neither =
     wander — and optionally `face` for directional marks or `tum` for
     symmetric spin). Everything else on the face (frequencies,
     bearings, menu labels) is art direction, not content — it lives
     here in the module and doubles as animation state.

   THE DIAL IS GENERATED, NOT HAND-WRITTEN
     The compass card is ~100 SVG elements (72 rim ticks, 11 rotated
     labels, dotted ring, center burst, waypoints, bearing needle). They
     are generated by buildDialSVG() from a handful of geometry constants
     so retuning the card is a one-number edit, not surgery on markup.
     ViewBox units are calibrated 1:1 to the source graphic's pixels at a
     1440p reference (100vmin box ↔ 1440 viewBox units), so measurements
     taken off the design transfer directly.

   READOUTS ARE DOM, NOT SVG
     Every text cluster is real DOM text carrying a data-hud attribute.
     The coming animation phase follows the house motion doctrine —
     "instrument readouts don't tween, they update" — which means
     per-element discrete writes (and possibly the text primitives), and
     those want DOM text nodes. The data-hud hooks are the addresses
     that phase will write to; they cost nothing now.

   FADE — THE STANDARD GATE CONTRACT
     Single-channel self-driven fade, same as every other panel type
     (handoffGate.md §4): ease `grow` toward isClearToEnter(index),
     report it via registerWeight, last-write opacity onto BOTH layers
     so they move as one. Single channel ⇒ no rising-edge re-arm needed.

   POINTER STORY (FOR NOW)
     Display-only. Both layers stay pointer-events:none, so the wheel
     falls through to the scroller untouched. When the interactive phase
     lands, interactivity gets gated pointer-events on .is-active plus
     wheel forwarding via scrollPageBy (turnPanel's pattern) — nothing
     here forecloses that.

   COUPLED WITH
     - infiniteScroll.js: registerPanelType, registerWeight, isClearToEnter.
     - hudStyles.css: every .hud-* class, the horizon dash + mask, and the
       cluster positions (measured off the source graphic).
     - main.js: `import "./hudPanel.js"` + a { type: "hud" } PANELS entry.
     - index.html: <link rel="stylesheet" href="hudStyles.css" />.
   ========================================================================== */

import { registerPanelType, registerWeight, isClearToEnter } from "./infiniteScroll.js";

/* Self-driven fade easing rate (s⁻¹). Matches turnPanel/wallPanel so panel
   entrances feel like one system. */
const FADE_SPEED = 12.0;

/* Content defaults — overridable per PANELS entry (see CONTENT AUTHORING). */
const DEFAULT_HEADLINE = "THANK.YOU";
const DEFAULT_URL      = "www.calilei.com";

/* ---- scroll-driven motion ----
   Everything below is keyed to tick()'s `dist` — this panel's signed
   distance from the scroll position, in panel-units. dist is 0 when the
   panel is centered and continuous anywhere near view, so every
   scroll-driven element returns exactly to the authored composition at
   rest. Visible travel is roughly ±0.42 panel-units (the core's FADE
   width) before the panel is gone, so rates are set for that window. */
const SPIN_BURST = 140;   // center burst spin, degrees per panel-unit
const SPIN_RIM   = -55;   // outer rim spin, degrees per panel-unit —
                          //   slower and counter-rotating, so the two
                          //   rings read as independent mechanisms
const HDG_REST   = 30;    // authored heading at rest ("030")
const HDG_RATE   = 45;    // heading degrees counted per panel-unit
const RNG_REST   = 4.99;  // authored range at rest (NM)
const RNG_RATE   = 3.2;   // NM counted per panel-unit — positive, so the
                          //   range closes toward rest as the panel
                          //   scrolls into view from above

/* ---- idle motion ----
   Runs whenever the panel is visible, on a clock accumulated from dt
   (state.idleT, seconds). Smooth for the machine, stepped for the
   readouts — see IDLE MOTION in the file header. */
const BRG_A1 = 4.4, BRG_W1 = 0.31; // bearing hunt: two incommensurate
const BRG_A2 = 2.4, BRG_W2 = 0.83; //   sines (amp °, rate rad/s)
const SEG_TRACK = 0.42;   // the scale bar's heavy segment tracks the same
                          //   hunt — vw of travel per degree of wobble
const WIND_MIN_S  = 2.6;   // seconds between wind writes (randomized
const WIND_MAX_S  = 5.2;   //   within this band so the cadence breathes)
const WIND_DIR_REST = 266, WIND_DIR_SPREAD = 10; // walk bounds around the
const WIND_SPD_REST = 36,  WIND_SPD_SPREAD = 6;  //   authored rest values
const ETA_REST      = 75;  // authored countdown at rest ("01:15", seconds)
const ETA_RESEED_MIN  = 66;  // at zero the countdown reseeds to a fresh
const ETA_RESEED_SPAN = 28;  //   value in [MIN, MIN+SPAN) — a recompute
const HATCH_ROWS = 13, HATCH_COLS = 34; // hatch field dimensions
const HATCH_STEP_S = 0.14; // one hatch row re-twinkles per step
const HATCH_GAP_P  = 0.07; // per-character dropout probability
const HATCH_FLASH_P = 0.025; // per-character brand-color ping probability —
                             //   a ping lives until its row re-rolls
const HATCH_FLASH_CLASSES = ["hud-red", "hud-green", "hud-blue", "hud-amber"];

/* ---- idle motion, second pass ----
   Same clock, same gate. The stepped writes here carry the UPDATE
   AFTERGLOW — the write snaps its element to write-blue (is-lit), tick
   lifts the class a beat later, and the CSS transition decays the color
   back to rest. */
const GLOW_HOLD_S = 0.14;  // is-lit hold before the CSS decay takes over
const DME_MIN_S = 1.4, DME_MAX_S = 2.6;         // seconds between DME ticks
const DME_RESEED_MIN = 12, DME_RESEED_SPAN = 6; // NM after station passage
const TERR_MIN_S = 3.5, TERR_MAX_S = 7;         // clearance walk cadence
const ANN_ARM_MIN_S = 2.5, ANN_ARM_SPAN_S = 2.5; // annunciator armed hold…
const ANN_OFF_MIN_S = 6,   ANN_OFF_SPAN_S = 8;   // …and disarmed gap
const GPS_MIN_S = 7, GPS_SPAN_S = 9; // gap between acquisition blinks
const RING_CRAWL = 1.4;    // deg/s — the dotted ring's slow dot-march

/* ---- the contact field ----
   See THE CONTACT FIELD in the file header. Coordinates are dial units
   (viewBox space: 1440 units = 100vmin), center-relative. */
const FIELD_SPIN = -40;   // deg per panel-unit — same direction as the rim
                          //   card but lagging it: one turning world, with
                          //   parallax depth between card and traffic
const FIELD_SPIN_RAD = FIELD_SPIN * Math.PI / 180;
const CAPTURE_R  = 85;    // cursor interrogation radius, dial units
const HOLD_SPEED = 9.0;   // lock-on ease rate (s⁻¹) — how fast a designated
                          //   contact settles onto its plotted position
const DRIFT_AMP_MIN = 7,    DRIFT_AMP_SPAN = 8;    // wander amplitude (units)
const DRIFT_W_MIN   = 0.09, DRIFT_W_SPAN   = 0.22; // wander rates (rad/s)
const TRANSIT_BOUND = 395; // movers wrap at this radius (inside the rim)…
const TRANSIT_FADE  = 55;  // …fading over this band, so the antipodal
                           //   re-entry happens fully faded — traffic
                           //   leaving and entering coverage

/* The plotted traffic — transcribed from the source graphic. Overridable
   wholesale via the PANELS entry's `contacts` (see CONTENT AUTHORING).
   Alt tags authored with trk/spd TRANSIT the dial (compass track in
   degrees, speed in dial units/s); everything else hovers on anchored
   wander. */
const DEFAULT_CONTACTS = [
  /* TCAS-style altitude tags, diamond-and-arrow marks */
  { t: "alt", s: "+15", x:  216, y: -213, trk: 205, spd: 22 },
  { t: "alt", s: "+03", x:   33, y: -157 },
  { t: "alt", s: "+17", x:   -4, y:  112 },
  { t: "alt", s: "+07", x: -252, y:  152, trk: 95, spd: 17 },
  { t: "alt", s: "+11", x:  205, y:  155 },
  { t: "alt", s: "+19", x:  313, y:  185 },
  { t: "alt", s: "+14", x:  -42, y:  265 },
  { t: "alt", s: "-09", x:  141, y:  310, trk: 335, spd: 26 },
  /* waypoint / project fiducials */
  { t: "id", s: "FREE.BIRZ",      x: 237, y: -51 },
  { t: "id", s: "CRUDE",     x: 263, y:  16 },
  { t: "id", s: "FUSION",   x: 157, y:  42 },
  { t: "id", s: "TEXWAX",    x: 234, y:  47 },
  { t: "id", s: "ARCSYS",    x: 234, y:  78 },
  { t: "id", s: "____",  x: 197, y: 232 },
  { t: "id", s: "AZULI",     x: 179, y: 265 },
  { t: "id", s: "BASE", x: 216, y: 297 },
  /* signal readouts */
  { t: "db", s: "-57.98",  x: 213, y: 106 },
  { t: "db", s: "-67.34",  x: 246, y: 134 },
  { t: "db", s: "-109.10", x: 171, y: 197 },
  /* glyph contacts — the assets/svg/ marks, grouped by orientation:
     1–5 are directional (face their heading — transit holds the track,
     orbit faces the tangent), 6–8 are symmetric (tum spin on their
     carrier), 9–10 stay upright (one wanders — the only lockable
     glyph — one orbits). Orbit radii are Kepler-ordered: inner faster. */
  { t: "glyph", n: 1,  x: -240, y: -220, trk: 118, spd: 19, face: true },
  { t: "glyph", n: 2,  x: -355, y:   65, orb: -2.2, face: true },
  { t: "glyph", n: 3,  x:  300, y:  -80, trk: 210, spd: 15, face: true },
  { t: "glyph", n: 4,  x:   60, y:  -60, trk: 232, spd: 24, face: true },
  { t: "glyph", n: 5,  x: -106, y: -106, orb:  5.5, face: true },
  { t: "glyph", n: 6,  x: -170, y:  170, orb: -3.8, tum:  40 },
  { t: "glyph", n: 7,  x:  -60, y:  300, trk:  20, spd: 16, tum:  45 },
  { t: "glyph", n: 8,  x:  300, y: -230, trk: 265, spd: 21, tum: -35 },
  { t: "glyph", n: 9,  x:  20, y:  166, orb:  5.8 },
  { t: "glyph", n: 10, x:  366, y:  120, orb:  1.8 },
];

/* The diamond-and-arrow traffic mark — a tiny inline SVG rather than the
   ◇ / ↓ codepoints, which Hornet Display isn't guaranteed to carry.
   currentColor throughout, so the hot-state color flip is free. */
const CONTACT_MARK_SVG =
  `<svg class="hud-contact-mark" viewBox="0 0 22 11" aria-hidden="true">
     <rect x="1.7" y="1.7" width="5.4" height="5.4" transform="rotate(45 4.4 4.4)"
       fill="none" stroke="currentColor" stroke-width="1.1" vector-effect="non-scaling-stroke"/>
     <path d="M15.5 1.2 V8.2 M13.2 6 L15.5 8.8 L17.8 6" fill="none"
       stroke="currentColor" stroke-width="1.1" vector-effect="non-scaling-stroke"/>
   </svg>`;

/* Module-level cursor tracking — one listener pair for all instances
   (wallPanel's precedent). Coordinate math only, no pointer-events: the
   stage stays wheel-transparent. */
let cursorX = 0, cursorY = 0, cursorActive = false, docListenersOn = false;
function ensureDocListeners() {
  if (docListenersOn) return;
  docListenersOn = true;
  document.addEventListener("mousemove", (e) => {
    cursorX = e.clientX;
    cursorY = e.clientY;
    cursorActive = true;
  }, { passive: true });
  document.addEventListener("mouseleave", () => { cursorActive = false; });
}

/* Per-instance state, keyed by panel index. Instances are never torn down
   (house convention — panels live for the page's lifetime). */
const instances = new Map();

/* =============================================================================
   THE DIAL — generated SVG
   -----------------------------------------------------------------------------
   Geometry constants are in viewBox units calibrated to the source graphic:
   the SVG renders at 100vmin × 100vmin with viewBox "-720 -720 1440 1440",
   so at a 1440p viewport 1 unit = 1 source pixel. All radii below are
   measured straight off the design.

   Hairlines carry vector-effect="non-scaling-stroke" so they stay crisp
   1-to-2px lines at any viewport size (technical-drawing behavior: geometry
   scales, line weight doesn't). The dotted ring and card labels scale
   naturally — dots and numerals are part of the geometry.
   ========================================================================== */

const DIAL = {
  R_DISC:     430,    // the faint instrument disc
  R_TICK_IN:  414,    // rim tick inner radius…
  R_TICK_OUT: 430,    // …to outer radius, every 5°
  R_RING:     444,    // fine dashed ring just outside the ticks
  R_LABEL:    468,    // compass card numerals baseline
  R_DOT:      207.5,  // dotted range ring (the waypoints sit on it)
  R_BURST_IN:  64,    // center tick burst, inner…
  R_BURST_OUT: 88,    // …to outer radius, every 30° (tick length = OUT − IN)
  LUBBER_TOP: -603,   // vertical lubber line extent (center-relative)…
  LUBBER_BOT:  537,   // …top runs long, bottom stops above the range text
  BEARING:    329,    // the bearing pointer's heading (head at 329°,
                      // circle-and-line tail on the reciprocal, 149°)
};

/* Compass card labels, every 30° clockwise from the top — the FULL card,
   including "3" at the top slot: the card spins with the scroll, so no
   slot may be blank. The heading box sits above the label ring, so every
   numeral stays visible as the card turns. Cardinals lowercase as in the
   design. */
const CARD_LABELS = [
  [0, "3"], [30, "6"], [60, "e"], [90, "12"], [120, "15"], [150, "s"],
  [180, "21"], [210, "24"], [240, "w"], [270, "30"], [300, "33"], [330, "n"],
];

function buildDialSVG() {
  const D = DIAL;
  const parts = [];

  /* The disc — a barely-there field that separates the instrument from the
     page white without becoming a "card". */
  parts.push(`<circle r="${D.R_DISC}" fill="rgba(28,24,19,0.035)"/>`);

  /* The compass card — rim ticks every 5°, the fine dashed outer ring,
     and the numerals, all inside ONE spin group: on a real HSI the
     numerals are printed on the card, so they turn with it (the heading
     box, lubber-referenced, stays fixed). Each numeral is rotated by its
     card angle so the glyphs sit tangent to the ring, tops facing
     outward — "21" at the bottom reads upside down on purpose. The
     dashed circle spins with the ticks, adding dash-crawl to the
     motion. tick rotates the group about the SVG origin = dial center. */
  const ticks = [];
  for (let a = 0; a < 360; a += 5) {
    ticks.push(`<line y1="${-D.R_TICK_IN}" y2="${-D.R_TICK_OUT}" transform="rotate(${a})"/>`);
  }
  const labels = CARD_LABELS.map(([a, t]) =>
    `<g transform="rotate(${a})">
       <text y="${-D.R_LABEL}" text-anchor="middle" font-size="32">${t}</text>
     </g>`
  );
  parts.push(
    `<g class="hud-spin-rim">
       <g stroke="rgba(28,24,19,0.28)" stroke-width="1" vector-effect="non-scaling-stroke">${ticks.join("")}</g>
       <circle r="${D.R_RING}" fill="none" stroke="rgba(28,24,19,0.22)" stroke-width="1"
         stroke-dasharray="2 9.5" vector-effect="non-scaling-stroke"/>
       <g fill="var(--ink-dimmer)" font-family="Hornet Display" letter-spacing="2">${labels.join("")}</g>
     </g>`
  );

  /* Lubber line (vertical) + inner crosshair (horizontal, waypoint to
     waypoint). The dashed horizon — the overlay's scrolling element —
     lands exactly on the crosshair when the scroll settles. */
  parts.push(
    `<g stroke="rgba(28,24,19,0.30)" stroke-width="1" vector-effect="non-scaling-stroke">
       <line y1="${D.LUBBER_TOP}" y2="${D.LUBBER_BOT}"/>
       <line x1="${-D.R_DOT}" x2="${D.R_DOT}"/>
     </g>`
  );

  /* Dotted range ring. Round-capped near-zero dashes render as true dots;
     the stroke scales with the dial (no non-scaling here) so the dots stay
     round instead of squashing into ovals. The wrapper group is tick's
     handle for the idle dot-march — a slow crawl of the ring. */
  parts.push(
    `<g class="hud-ring-crawl">
       <circle r="${D.R_DOT}" fill="none" stroke="var(--ink)" stroke-width="2.6"
         stroke-dasharray="0.1 8.8" stroke-linecap="round" opacity="0.85"/>
     </g>`
  );

  /* Center tick burst — 12 radial hairlines, the instrument's center
     reference and the second scroll-spin target (the class is tick's
     handle). Indicators may take weight (line grammar), hence 2px
     against the 1px field. */
  const burst = [];
  for (let a = 0; a < 360; a += 30) {
    burst.push(`<line y1="${-D.R_BURST_IN}" y2="${-D.R_BURST_OUT}" transform="rotate(${a})"/>`);
  }
  parts.push(
    `<g class="hud-spin-burst" stroke="var(--ink-strong)" stroke-width="2" vector-effect="non-scaling-stroke">${burst.join("")}</g>`
  );

  /* Waypoint markers — boxed "+" fiducials at the range ring's cardinal
     points. The box takes brand red (active emphasis); the cross takes ink. */
  const wp = [[0, -D.R_DOT], [0, D.R_DOT], [-D.R_DOT, 0], [D.R_DOT, 0]].map(([x, y]) =>
    `<g transform="translate(${x} ${y})">
       <rect x="-12" y="-12" width="24" height="24" fill="var(--bg)"
         stroke="var(--hud-red)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
       <line x1="-5" x2="5" stroke="var(--ink-strong)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
       <line y1="-5" y2="5" stroke="var(--ink-strong)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
     </g>`
  );
  parts.push(wp.join(""));

  /* Heading box — the "030" readout capping the lubber line, with a small
     tab pointing back at the card. Raised clear of the card's label ring
     so the numerals — including the top-slot "3" — pass beneath it as the
     card spins. Painted after the lubber so it sits on top of the line it
     caps. */
  parts.push(
    `<g>
       <rect x="-31" y="-540" width="62" height="30" fill="var(--bg)"
         stroke="rgba(28,24,19,0.35)" stroke-width="1" vector-effect="non-scaling-stroke"/>
       <path d="M -6 -510 L 0 -501 L 6 -510" fill="none"
         stroke="rgba(28,24,19,0.35)" stroke-width="1" vector-effect="non-scaling-stroke"/>
       <text y="-518" text-anchor="middle" font-family="Hornet Display" font-size="21"
         letter-spacing="2" fill="var(--ink-dim)" data-hud="hdg-box">030</text>
     </g>`
  );

  /* Bearing pointer — head at BEARING°, thickening toward the inner end
     (main stroke plus a short parallel companion), with the classic RMI
     circle-and-line tail on the reciprocal. The tail rides lighter than
     the head — hairline, faded ink — so the head stays the indicator.
     One rotate places both; the class is tick's handle for the idle
     hunt, which re-writes this transform as BEARING plus a small wander. */
  parts.push(
    `<g class="hud-bearing" transform="rotate(${D.BEARING})" stroke="var(--ink-dim)" fill="none">
       <line y1="-470" y2="-228" stroke-width="1.75" vector-effect="non-scaling-stroke"/>
       <line x1="4" x2="4" y1="-320" y2="-228" stroke-width="1" vector-effect="non-scaling-stroke"/>
       <circle cy="266" r="27" stroke="rgba(28,24,19,0.35)" stroke-width="1" vector-effect="non-scaling-stroke"/>
       <line y1="293" y2="375" stroke="rgba(28,24,19,0.35)" stroke-width="1" vector-effect="non-scaling-stroke"/>
     </g>`
  );

  return `<svg class="hud-dial" viewBox="-720 -720 1440 1440" aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}

/* =============================================================================
   THE STAGE — frame chrome + readout clusters
   -----------------------------------------------------------------------------
   Every cluster is absolutely positioned by hudStyles.css (coordinates
   measured off the source graphic). Values that will animate later carry
   data-hud hooks. Decorative blocks are aria-hidden; the headline and url
   are real content.
   ========================================================================== */

/* The hatch block — rows of "/" glyphs, syntax as ornament (house pattern):
   real text, so the idle twinkle can regenerate rows like everything else.
   Dimensions live in HATCH_ROWS/COLS, shared with the twinkle. */
function buildHatchRows() {
  let out = "";
  for (let i = 0; i < HATCH_ROWS; i++) out += `<span>${"/".repeat(HATCH_COLS)}</span>`;
  return out;
}

/* Bounded random walk for the stepped idle readouts: take a step of up to
   ±maxStep, rounded, clamped into [rest − spread, rest + spread]. */
function wander(v, rest, spread, maxStep) {
  const next = Math.round(v + (Math.random() * 2 - 1) * maxStep);
  return Math.max(rest - spread, Math.min(rest + spread, next));
}

/* Uniform random in [min, min + span) — drift parameter seeding. */
function rnd(min, span) {
  return min + Math.random() * span;
}

/* The update afterglow: snap the element to write-blue (is-lit sets the
   color with no transition), and register its release — tick lifts the
   class a beat later, letting the base CSS transition decay the color
   back to rest. */
function lightWrite(state, el, T) {
  el.classList.add("is-lit");
  state.glows.push({ el, until: T + GLOW_HOLD_S });
}

/* The contact field's markup — one flex column per contact: tag box (and
   the diamond-and-arrow mark for the altitude type), or a currentColor
   mask for glyph contacts. Order matches the defs array; init zips them
   back together by index. */
function buildContactsHTML(defs) {
  return defs.map((d) => `
    <div class="hud-contact hud-contact--${d.t}">${
      d.t === "glyph"
        ? `<span class="hud-glyph" style="--hud-glyph: url('assets/svg/logo${d.n}.svg')"></span>`
        : `<span class="hud-contact-tag">${d.s}</span>${d.t === "alt" ? CONTACT_MARK_SVG : ""}`
    }</div>`).join("");
}

function buildStageHTML(url, contacts) {
  return `
    <!-- frame chrome -->
    <div class="hud-topbar" aria-hidden="true"></div>
    <div class="hud-footer" aria-hidden="true"></div>

    <!-- headline plate: the brand strip and the surface the headline
         (which rides the overlay) docks onto at rest -->
    <div class="hud-plate">
      <div class="hud-colorbar" aria-hidden="true">
        <span class="hud-colorbar-green"></span><span class="hud-colorbar-yellow"></span><span class="hud-colorbar-red"></span><span class="hud-colorbar-blue"></span>
      </div>
    </div>

    <!-- the instrument -->
    ${buildDialSVG()}

    <!-- the contact field — painted above the dial, below the overlay pair -->
    <div class="hud-contacts" aria-hidden="true">${buildContactsHTML(contacts)}</div>

    <!-- top rail readouts -->
    <div class="hud-status">
      <div><span class="hud-dim">HOTAS</span><span class="hud-red" data-hud="hotas">232</span></div>
      <div><span class="hud-dim">FCGS </span><span class="hud-green" data-hud="fcgs">253</span></div>
      <div><span class="hud-wind" data-hud="wind">266&deg;/ 36</span></div>
    </div>
    <div class="hud-hdg hud-dimmer" data-hud="hdg">HDG030&deg;</div>
    <div class="hud-gps hud-blue" data-hud="gps">GPS</div>
    <div class="hud-nav hud-dimmer">
      <div data-hud="nav-id">LAM 1</div>
      <div data-hud="nav-brg">BRG 121</div>
      <div data-hud="nav-dist">9.6N</div>
      <div data-hud="nav-eta">01:15</div>
    </div>
    <div class="hud-hatch hud-dimmer" aria-hidden="true">${buildHatchRows()}</div>

    <!-- mid readouts -->
    <div class="hud-terr">
      <div><span class="hud-dim">TERR </span><span class="hud-write" data-hud="terr-1">008</span></div>
      <div class="hud-terr-2 hud-write" data-hud="terr-2">006</div>
    </div>

    <!-- left nav source (its extended bottom rule is a CSS ::after, so it
         tracks the box's content height) + the right-side structural leader -->
    <div class="hud-vor1">
      <div><span class="hud-ring-icon hud-ring-icon--blue" aria-hidden="true"></span> VOR1</div>
      <div class="hud-dim" data-hud="vor1-freq">112.50</div>
      <div class="hud-dim hud-write" data-hud="vor1-dme">15.1 NM</div>
    </div>
    <div class="hud-leader hud-leader--ils" aria-hidden="true"></div>

    <!-- lower-left menu tree -->
    <div class="hud-menu" aria-hidden="true">
      <span class="hud-menu-rule hud-menu-rule--1"></span>
      <span class="hud-menu-rule hud-menu-rule--2"></span>
      <span class="hud-menu-rule hud-menu-rule--3"></span>
      <div class="hud-menu-item hud-menu-anti hud-dim">ANTI ICING</div>
      <div class="hud-menu-item hud-menu-de hud-dim">DE ICING</div>
      <div class="hud-menu-item hud-menu-nodev hud-red">NO DEVICE</div>
      <div class="hud-menu-item hud-menu-vorils hud-dim">VOR/ILS</div>
      <div class="hud-menu-box"></div>
      <div class="hud-menu-item hud-menu-adf hud-dim">ADF</div>
      <div class="hud-menu-item hud-menu-noovly hud-red">NO OVLY</div>
    </div>

    <!-- right nav source + radio stack — ONE flow column, so the rows can
         never collide however the em-based heights land -->
    <div class="hud-radios">
      <div class="hud-radios-ils2 hud-dim">
        <div class="hud-ils2-id">ILS2</div>
        <div data-hud="ils2-freq">109.50</div>
        <div class="hud-write" data-hud="ils2-dme">13.2 NM</div>
      </div>
      <div class="hud-radios-hdr"><span class="hud-green">ACTIVE</span><span></span><span class="hud-dim">STBY</span></div>
      <div class="hud-radios-vals">
        <span class="hud-val" data-hud="vils1-active">112.50</span>
        <span class="hud-swap" aria-hidden="true">&lt;&gt;</span>
        <span class="hud-val" data-hud="vils1-stby">109.50</span>
      </div>
      <div class="hud-radios-name hud-dim">V/ILS1 <span class="hud-ring-icon hud-ring-icon--blue" aria-hidden="true"></span></div>
      <div class="hud-radios-opts">
        <span class="hud-opt" data-hud="auto"><span class="hud-check" aria-hidden="true"></span> <span class="hud-amber">AUTO</span></span>
        <span class="hud-opt hud-opt--dme" data-hud="dme-hold"><span class="hud-check" aria-hidden="true"></span> <span class="hud-dim">DME HOLD</span></span>
      </div>
      <div class="hud-radios-name hud-dim">V/ILS2 <span class="hud-dart-icon" aria-hidden="true"></span></div>
      <div class="hud-radios-hdr"><span class="hud-green">ACTIVE</span><span></span><span class="hud-dim">STBY</span></div>
      <div class="hud-radios-vals">
        <span class="hud-val" data-hud="vils2-active">109.50</span>
        <span class="hud-swap" aria-hidden="true">&lt;&gt;</span>
        <span class="hud-val" data-hud="vils2-stby">112.50</span>
      </div>
    </div>

    <!-- under-dial range + traffic -->
    <div class="hud-range">
      <div><span class="hud-dim">L </span><span data-hud="range">4.99 NM</span></div>
      <div class="hud-dim">TCAS BELOW</div>
    </div>

    <!-- bottom scale bar -->
    <div class="hud-scale" aria-hidden="true">
      <span class="hud-scale-seg"></span>
      <span class="hud-scale-tick hud-scale-tick--l"></span>
      <span class="hud-scale-tick hud-scale-tick--r"></span>
    </div>

    <!-- footer readouts -->
    <div class="hud-url">${url}</div>
    <div class="hud-end hud-dimmer" aria-hidden="true">|END|</div>
  `;
}

/* -----------------------------------------------------------------------------
   REGISTER WITH THE CORE
   -----------------------------------------------------------------------------
   buildDOM stashes the PANELS entry on the overlay element so init can read
   `headline` / `url` — the same bridge pattern turnPanel and wallPanel use
   (the core only passes index + overlay into init).
   --------------------------------------------------------------------------- */
const PANEL_REF = "__hudPanelRef__";

registerPanelType("hud", {
  // tick() owns this overlay's opacity; the core skips its presence default.
  selfDrivenOpacity: true,


  buildDOM(panel /*, index */) {
    /* The overlay carries the scroll-linked pair — the horizon and the
       headline — and nothing else. Everything that must hold still lives
       on the stage, built in init as a sibling.

       The headline is HTML text whose box is pinned to the plate width
       (--hud-plate-w) and whose font-size is a container-query width unit
       (cqw), so the type auto-scales to FILL the plate with no fixed
       geometry to guess — and, being real text, it uses the actual
       @font-face and renders the brackets as literal glyphs. */
    const overlay = document.createElement("div");
    overlay.className = "infinite-overlay hud-overlay";
    overlay.innerHTML = `
      <div class="hud-horizon" aria-hidden="true"></div>
      <div class="hud-headline"><span class="hud-headline-text">${panel.headline || DEFAULT_HEADLINE}</span></div>`;
    overlay[PANEL_REF] = panel;
    return overlay;
  },

  init(index, overlay) {
    const panel = overlay[PANEL_REF];

    const state = {
      grow: 0,         // 0..1 self-driven fade; also this panel's gate weight
      stage: null,     // the static instrument layer (sibling of the overlay)
      spinBurst: null, // SVG spin groups — resolved once below, rotated
      spinRim: null,   //   every tick from `dist`
      hdgEl: null,     // scroll-driven readouts: the HDG rail readout…
      hdgBoxEl: null,  //   …its twin in the heading box (one datum, two
      rangeEl: null,   //   displays), and the L-range readout
      lastDist: null,  // last dist consumed — settled scroll pays nothing
      lastHdg: "",     // last written strings — readouts update in steps,
      lastRange: "",   //   so text is written only when the format changes

      /* idle motion (see IDLE MOTION in the file header) */
      idleT: 0,        // module clock, seconds, accumulated from dt
      bearingEl: null, // the hunting pointer group
      windEl: null,    // the stepped-walk wind readout…
      windDir: WIND_DIR_REST, // …and its walking values
      windSpd: WIND_SPD_REST,
      windNext: 0,     // idleT deadlines for the three stepped clocks
      etaEl: null,     // the countdown readout…
      etaS: ETA_REST,  // …and its remaining seconds
      etaNext: 1,
      hatchRows: null, // the twinkling field's row spans
      hatchNext: 0,
      scaleSegEl: null, // the scale bar's heavy segment — tracks the hunt
      headlineText: null, // the wordmark span — scaled to fill the plate
      headlineFit: false, // one-shot fit-to-plate flag

      /* idle motion, second pass (see IDLE MOTION in the file header).
         Timer seeds are staggered so nothing fires simultaneously on
         the panel's first entry. */
      glows: [],          // pending afterglow releases: { el, until }
      vor1DmeEl: null, vor1Dme: 15.1, vor1Next: 2,    // DME countdowns
      ils2DmeEl: null, ils2Dme: 13.2, ils2Next: 3.2,
      terr1El: null, terr2El: null,                    // clearance walk
      terr1: 8, terr2: 6, terrNext: 5,
      autoEl: null,    autoArmed: false, autoNext: 6,  // annunciators
      dmeHoldEl: null, dmeArmed: false,  dmeNext: 11,
      gpsEl: null, gpsNext: 4, gpsBlinkAt: -1,         // acquisition blink
      ringCrawlEl: null,  // the dotted ring's crawl group
      contacts: null,   // the contact field — per-contact element, polar
                        //   anchor, seeded drift params, and lock state
    };
    instances.set(index, state);

    /* `grow` drives the fade — eased toward isClearToEnter(index) in tick(),
       reported as this panel's weight so the handoff gate sees its presence
       in the sequencing. */
    registerWeight(index, () => state.grow);

    /* The static stage — sibling of the overlay, inserted BEFORE it so the
       scroll-linked pair paints above the instrument (see file header for
       both the containing-block and the stacking reasoning). */
    const contactDefs = panel.contacts || DEFAULT_CONTACTS;
    state.stage = document.createElement("div");
    state.stage.className = "hud-stage";
    state.stage.innerHTML = buildStageHTML(panel.url || DEFAULT_URL, contactDefs);
    overlay.parentNode.insertBefore(state.stage, overlay);

    /* Animated element refs, resolved once — tick only writes. All are
       our own markup, built two lines up. */
    state.spinBurst = state.stage.querySelector(".hud-spin-burst");
    state.spinRim   = state.stage.querySelector(".hud-spin-rim");
    state.hdgEl     = state.stage.querySelector('[data-hud="hdg"]');
    state.hdgBoxEl  = state.stage.querySelector('[data-hud="hdg-box"]');
    state.rangeEl   = state.stage.querySelector('[data-hud="range"]');
    state.bearingEl = state.stage.querySelector(".hud-bearing");
    state.windEl    = state.stage.querySelector('[data-hud="wind"]');
    state.etaEl     = state.stage.querySelector('[data-hud="nav-eta"]');
    state.hatchRows = state.stage.querySelectorAll(".hud-hatch span");
    state.scaleSegEl = state.stage.querySelector(".hud-scale-seg");
    state.headlineText = overlay.querySelector(".hud-headline-text");
    state.vor1DmeEl   = state.stage.querySelector('[data-hud="vor1-dme"]');
    state.ils2DmeEl   = state.stage.querySelector('[data-hud="ils2-dme"]');
    state.terr1El     = state.stage.querySelector('[data-hud="terr-1"]');
    state.terr2El     = state.stage.querySelector('[data-hud="terr-2"]');
    state.gpsEl       = state.stage.querySelector('[data-hud="gps"]');
    state.autoEl      = state.stage.querySelector('[data-hud="auto"]');
    state.dmeHoldEl   = state.stage.querySelector('[data-hud="dme-hold"]');
    state.ringCrawlEl = state.stage.querySelector(".hud-ring-crawl");

    /* The contact field: zip the defs with their elements (same document
       order), convert each anchor to polar for the field rotation, and
       seed the per-contact drift so every contact floats on its own
       never-quite-repeating path. Defs with trk/spd become MOVERS: they
       integrate a world-frame velocity instead of wandering (compass
       track: 0° = up, clockwise). lx/ly cache the last rendered position
       for the cursor's nearest-contact search (one-frame lag, invisible). */
    const contactEls = state.stage.querySelectorAll(".hud-contact");
    state.contacts = contactDefs.map((d, i) => {
      const mover = d.trk != null;
      const trkRad = mover ? d.trk * Math.PI / 180 : 0;
      return {
        el: contactEls[i],
        a0: Math.atan2(d.y, d.x),
        r0: Math.hypot(d.x, d.y),
        ax: rnd(DRIFT_AMP_MIN, DRIFT_AMP_SPAN),
        wx: rnd(DRIFT_W_MIN, DRIFT_W_SPAN),
        px: Math.random() * Math.PI * 2,
        ay: rnd(DRIFT_AMP_MIN, DRIFT_AMP_SPAN),
        wy: rnd(DRIFT_W_MIN, DRIFT_W_SPAN),
        py: Math.random() * Math.PI * 2,
        mover,
        mx: d.x,     // mover world position, integrated per frame…
        my: d.y,
        vx: mover ? d.spd * Math.sin(trkRad) : 0,  // …along this velocity
        vy: mover ? -d.spd * Math.cos(trkRad) : 0, //   (screen y is down)
        orbiter: d.orb != null,
        orbRad: d.orb != null ? d.orb * Math.PI / 180 : 0, // rad/s
        tum: d.tum || 0,   // own-axis spin, deg/s (symmetric marks)
        face: !!d.face,    // heading-aligned (directional marks)
        trkDeg: mover ? d.trk : 0, // held heading for faced movers
        hot: false,  // currently designated by the cursor
        hold: 0,     // 0..1 lock-on ease — scales the wander to zero
        lx: d.x,     // last rendered position, dial units
        ly: d.y,
      };
    });

    /* Module-level cursor tracking — attached on the first init. */
    ensureDocListeners();
  },

  tick(index, overlay, _presence, dist, dt /*, t */) {
    const state = instances.get(index);
    if (!state) return;

    /* Self-driven fade — the standard single-channel gate contract
       (handoffGate.md §4). Ease `grow` toward the gate's verdict;
       last-write opacity on BOTH the overlay AND the stage so the two
       layers enter/leave as one. */
    const target = isClearToEnter(index) ? 1 : 0;
    state.grow += (target - state.grow) * (1 - Math.exp(-FADE_SPEED * dt));
    // Settled-value guard — the same discipline as lastDist/lastHdg/lastRange
    // below, applied to the fade pair. The type declares selfDrivenOpacity,
    // so this tick is the overlay channel's only writer.
    const alpha = state.grow.toFixed(3);
    if (alpha !== state.lastAlpha) {
      overlay.style.opacity = alpha;
      state.stage.style.opacity = alpha;
      state.lastAlpha = alpha;
    }

    /* All motion is gated on visibility — far-away panels pay nothing.
       On re-entry the first, still-imperceptible visible frame re-syncs
       everything before it can be seen. */
    if (state.grow > 0.002) {
      const T = (state.idleT += dt);

      /* Fit the wordmark to the plate exactly — once, on the first
         visible frame (fonts are loaded by then, so the measure is
         accurate). UNIFORM scale (both axes by the same factor) so the
         letterforms keep their proportions — a one-axis scaleX squished
         them wide-and-short. Anchored bottom-left so the wordmark still
         docks on the plate's bottom edge as it grows. Independent of the
         string, the font, or its metrics; this is what guarantees "same
         width as the block" for any headline. */
      if (!state.headlineFit) {
        const el = state.headlineText;
        const plate = state.stage.querySelector(".hud-plate");
        if (el && plate && el.scrollWidth > 0) {
          state.headlineFit = true;
          const target = plate.getBoundingClientRect().width;
          const natural = el.getBoundingClientRect().width;
          if (natural > 0) {
            el.style.transformOrigin = "left bottom";
            el.style.transform = `scale(${(target / natural).toFixed(4)})`;
          }
        }
      }

      /* IDLE — the machine moves smoothly: the bearing pointer hunts
         around its rest bearing on two incommensurate sines, and the
         scale bar's heavy segment tracks the same signal — two
         indicators listening to one source reads as a coupled machine. */
      const wob = BRG_A1 * Math.sin(T * BRG_W1) + BRG_A2 * Math.sin(T * BRG_W2);
      state.bearingEl.setAttribute("transform", `rotate(${(DIAL.BEARING + wob).toFixed(2)})`);
      state.scaleSegEl.style.transform = `translateX(${(wob * SEG_TRACK).toFixed(2)}vw)`;

      /* IDLE — the readouts update in steps, each on its own clock.
         Wind takes a bounded random walk around its rest values… */
      if (T >= state.windNext) {
        state.windNext = T + WIND_MIN_S + Math.random() * (WIND_MAX_S - WIND_MIN_S);
        state.windDir = wander(state.windDir, WIND_DIR_REST, WIND_DIR_SPREAD, 3);
        state.windSpd = wander(state.windSpd, WIND_SPD_REST, WIND_SPD_SPREAD, 2);
        state.windEl.textContent = `${state.windDir}°/ ${state.windSpd}`;
      }

      /* …the ETA counts down in real seconds, reseeding at zero like a
         recompute… */
      if (T >= state.etaNext) {
        state.etaNext = T + 1;
        state.etaS = state.etaS > 0
          ? state.etaS - 1
          : ETA_RESEED_MIN + Math.floor(Math.random() * ETA_RESEED_SPAN);
        state.etaEl.textContent =
          `${String(Math.floor(state.etaS / 60)).padStart(2, "0")}:` +
          `${String(state.etaS % 60).padStart(2, "0")}`;
      }

      /* …and the hatch field twinkles: one row regenerates per step with
         sparse dropouts (nbsp, not space — nowrap collapses spaces) and
         the occasional brand-color ping, which lives until its row
         re-rolls. Row content is our own generated string, so innerHTML
         is safe here. */
      if (T >= state.hatchNext) {
        state.hatchNext = T + HATCH_STEP_S;
        const row = state.hatchRows[(Math.random() * state.hatchRows.length) | 0];
        let s = "";
        for (let i = 0; i < HATCH_COLS; i++) {
          const r = Math.random();
          if (r < HATCH_GAP_P) {
            s += "\u00A0";
          } else if (r < HATCH_GAP_P + HATCH_FLASH_P) {
            s += `<span class="${HATCH_FLASH_CLASSES[(Math.random() * HATCH_FLASH_CLASSES.length) | 0]}">/</span>`;
          } else {
            s += "/";
          }
        }
        row.innerHTML = s;
      }

      /* IDLE — stepped writes with the UPDATE AFTERGLOW, the visual
         language's write signature: each write snaps its value to
         write-blue (is-lit), and the CSS transition decays it back once
         tick lifts the class. The DMEs close on their stations in
         0.1 NM steps, reseeding past zero — station passage, next leg;
         TERR takes a slow bounded clearance walk. */
      if (T >= state.vor1Next) {
        state.vor1Next = T + DME_MIN_S + Math.random() * (DME_MAX_S - DME_MIN_S);
        state.vor1Dme = state.vor1Dme <= 0.4
          ? DME_RESEED_MIN + Math.random() * DME_RESEED_SPAN
          : state.vor1Dme - 0.1;
        state.vor1DmeEl.textContent = `${state.vor1Dme.toFixed(1)} NM`;
        lightWrite(state, state.vor1DmeEl, T);
      }
      if (T >= state.ils2Next) {
        state.ils2Next = T + DME_MIN_S + Math.random() * (DME_MAX_S - DME_MIN_S);
        state.ils2Dme = state.ils2Dme <= 0.4
          ? DME_RESEED_MIN + Math.random() * DME_RESEED_SPAN
          : state.ils2Dme - 0.1;
        state.ils2DmeEl.textContent = `${state.ils2Dme.toFixed(1)} NM`;
        lightWrite(state, state.ils2DmeEl, T);
      }
      if (T >= state.terrNext) {
        state.terrNext = T + TERR_MIN_S + Math.random() * (TERR_MAX_S - TERR_MIN_S);
        state.terr1 = wander(state.terr1, 8, 4, 2);
        state.terr2 = wander(state.terr2, 6, 4, 2);
        state.terr1El.textContent = String(state.terr1).padStart(3, "0");
        state.terr2El.textContent = String(state.terr2).padStart(3, "0");
        lightWrite(state, state.terr1El, T);
        lightWrite(state, state.terr2El, T);
      }

      /* IDLE — annunciators arm and release on independent irregular
         cycles: the checkbox fills while armed, then clears. Two
         different-seeming rhythms so they never read as synchronized. */
      if (T >= state.autoNext) {
        state.autoArmed = !state.autoArmed;
        state.autoEl.classList.toggle("is-armed", state.autoArmed);
        state.autoNext = T + (state.autoArmed
          ? ANN_ARM_MIN_S + Math.random() * ANN_ARM_SPAN_S
          : ANN_OFF_MIN_S + Math.random() * ANN_OFF_SPAN_S);
      }
      if (T >= state.dmeNext) {
        state.dmeArmed = !state.dmeArmed;
        state.dmeHoldEl.classList.toggle("is-armed", state.dmeArmed);
        state.dmeNext = T + (state.dmeArmed
          ? ANN_ARM_MIN_S + Math.random() * ANN_ARM_SPAN_S
          : ANN_OFF_MIN_S + Math.random() * ANN_OFF_SPAN_S);
      }

      /* IDLE — GPS acquisition flicker: a quick double-blink at long
         irregular intervals, solid otherwise. */
      if (state.gpsBlinkAt >= 0) {
        const p = T - state.gpsBlinkAt;
        if (p > 0.5) {
          state.gpsBlinkAt = -1;
          state.gpsEl.style.opacity = "1";
        } else {
          const dim = p < 0.12 || (p > 0.22 && p < 0.34);
          state.gpsEl.style.opacity = dim ? "0.15" : "1";
        }
      } else if (T >= state.gpsNext) {
        state.gpsBlinkAt = T;
        state.gpsNext = T + GPS_MIN_S + Math.random() * GPS_SPAN_S;
      }

      /* IDLE — the range ring's dot-march: the second pass's one smooth
         machine motion, a slow crawl of the dotted ring. */
      state.ringCrawlEl.setAttribute("transform", `rotate(${((T * RING_CRAWL) % 360).toFixed(2)})`);

      /* Afterglow bookkeeping — lift is-lit a beat after each write so
         the CSS decay takes over. */
      if (state.glows.length) {
        state.glows = state.glows.filter((g) => {
          if (T < g.until) return true;
          g.el.classList.remove("is-lit");
          return false;
        });
      }

      /* THE CONTACT FIELD — three motions layered per contact (see file
         header): anchored Lissajous wander, field rotation with dist,
         and cursor interrogation. Runs every visible frame — the field
         floats whether or not the scroll moves. */
      {
        /* Cursor → dial units. The dial's coordinate system is 1440
           units across 100vmin, centered on the viewport. */
        let hotContact = null;
        if (cursorActive) {
          const scale = Math.min(window.innerWidth, window.innerHeight) / 1440;
          const cx = (cursorX - window.innerWidth / 2) / scale;
          const cy = (cursorY - window.innerHeight / 2) / scale;
          /* Nearest contact within the interrogation radius, against
             last frame's rendered positions. */
          let best = CAPTURE_R * CAPTURE_R;
          for (const c of state.contacts) {
            const ddx = c.lx - cx, ddy = c.ly - cy;
            const d2 = ddx * ddx + ddy * ddy;
            if (d2 < best) { best = d2; hotContact = c; }
          }
        }

        const fieldRot = dist * FIELD_SPIN_RAD;
        const fieldRotDeg = dist * FIELD_SPIN;
        const csF = Math.cos(fieldRot), snF = Math.sin(fieldRot);
        for (const c of state.contacts) {
          const hot = c === hotContact;
          if (hot !== c.hot) {
            c.hot = hot;
            c.el.classList.toggle("is-hot", hot);
          }
          /* Designation locks a WANDERING contact: hold eases toward 1
             and scales the wander away, settling it onto its plotted
             position. Movers only take the highlight — traffic doesn't
             halt for the cursor. */
          c.hold += ((hot ? 1 : 0) - c.hold) * (1 - Math.exp(-HOLD_SPEED * dt));

          let x, y, faceDeg = 0;
          if (c.orbiter) {
            /* ORBIT — a holding pattern: constant angular rate on the
               authored radius, plus the field rotation like everyone
               else. Bound radius < TRANSIT_BOUND, so no edge fade.
               FACE points the mark along the ring's tangent — with
               screen-y down and CSS rotation clockwise, "up" aligns
               with the direction of travel at θ + 180° for a positive
               (clockwise) orbit, θ for a negative one. */
            const th = c.a0 + T * c.orbRad + fieldRot;
            x = c.r0 * Math.cos(th);
            y = c.r0 * Math.sin(th);
            if (c.face) faceDeg = th * 180 / Math.PI + (c.orbRad > 0 ? 180 : 0);
          } else if (c.mover) {
            /* TRANSIT — integrate the world-frame track; once past the
               bound (fully faded by then), re-enter antipodally on the
               same velocity. The world then rotates by the field
               rotation, like every other contact. FACE holds the track
               heading, rotated with the world. */
            c.mx += c.vx * dt;
            c.my += c.vy * dt;
            let r = Math.hypot(c.mx, c.my);
            if (r > TRANSIT_BOUND + 6) {
              c.mx = -c.mx;
              c.my = -c.my;
              r = Math.hypot(c.mx, c.my);
            }
            x = c.mx * csF - c.my * snF;
            y = c.mx * snF + c.my * csF;
            if (c.face) faceDeg = c.trkDeg + fieldRotDeg;
            /* Coverage-edge fade — multiplies visually with the stage's
               panel fade. */
            const edge = Math.max(0, Math.min(1, (TRANSIT_BOUND - r) / TRANSIT_FADE));
            c.el.style.opacity = edge.toFixed(3);
          } else {
            const th = c.a0 + fieldRot;
            const free = 1 - c.hold;
            x = c.r0 * Math.cos(th) + free * c.ax * Math.sin(T * c.wx + c.px);
            y = c.r0 * Math.sin(th) + free * c.ay * Math.sin(T * c.wy + c.py);
          }
          c.lx = x;
          c.ly = y;
          /* 1 dial unit = 100/1440 vmin, hence /14.4 — vmin transforms
             keep the field glued to the dial at any viewport size.
             Orientation (transform-origin is the element center, so it
             turns in place): FACE holds the heading; TUMBLE spins. */
          let spin = "";
          if (c.face) {
            spin = ` rotate(${faceDeg.toFixed(1)}deg)`;
          } else if (c.tum) {
            spin = ` rotate(${((T * c.tum) % 360).toFixed(1)}deg)`;
          }
          c.el.style.transform =
            `translate(-50%, -50%) translate(${(x / 14.4).toFixed(3)}vmin, ${(y / 14.4).toFixed(3)}vmin)${spin}`;
        }
      }

      /* SCROLL-DRIVEN — skipped entirely while the scroll is settled. */
      if (dist !== state.lastDist) {
        state.lastDist = dist;

        /* The machine moves smoothly… (rotation is about the SVG origin,
           which the viewBox places at the dial's center) */
        state.spinBurst.setAttribute("transform", `rotate(${(dist * SPIN_BURST).toFixed(2)})`);
        state.spinRim.setAttribute("transform", `rotate(${(dist * SPIN_RIM).toFixed(2)})`);

        /* …the readouts update in steps: text is written only when the
           FORMATTED value changes (visualLanguage.md — readouts don't
           tween). The heading writes its two displays from one datum. */
        const hdg = String(((Math.round(HDG_REST + dist * HDG_RATE) % 360) + 360) % 360).padStart(3, "0");
        if (hdg !== state.lastHdg) {
          state.lastHdg = hdg;
          state.hdgEl.textContent = `HDG${hdg}°`;
          state.hdgBoxEl.textContent = hdg;
        }
        const rng = Math.max(0, RNG_REST + dist * RNG_RATE).toFixed(2);
        if (rng !== state.lastRange) {
          state.lastRange = rng;
          state.rangeEl.textContent = `${rng} NM`;
        }
      }
    }
  },
});
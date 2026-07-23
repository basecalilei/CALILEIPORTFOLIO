/* =============================================================================
   desktopGame.js — the "game" + "inspector" FILE TYPES (desktopPanel family)
   -----------------------------------------------------------------------------
   Hosts CalileiGame (the platform fighter) in a desktop window, with a
   PAIRED INSPECTOR WINDOW — a live DOM readout of the running match. One
   module registers both types because they are one feature: the inspector
   exists to watch the game, they share module-scope match state, and their
   lifecycles are bound (opening the game opens the inspector; closing the
   game closes it). Registering siblings from one file is the sub-module
   relationship desktop* already uses elsewhere (sidebarShopGate : sidebarHome).

   THE GAME WINDOW is an ALTERNATE COMPOSITION ROOT for the game: it plays
   the role the game repo's main.js plays standalone — create the World,
   own the fixed-timestep accumulator, call tick(world, inputs), call
   render(world, ctx) — inside a window the desktop panel owns.

   THE CLOCK
     The module owns its own requestAnimationFrame loop while the game is
     live, consuming rAF's vsync-aligned frame timestamp — EXACTLY the
     standalone build's clock. At a steady 60Hz the accumulator drains one
     tick per frame, every frame; smoothness parity with standalone is
     structural, not tuned. The loop exists only while the game is LIVE;
     a closed, minimized, blurred, or off-panel game schedules nothing.

   LIVENESS — one rule: THE GAME RUNS WHILE ITS SURFACE HOLDS DOM FOCUS.
     The surface is a focusable element (tabindex); the browser is the
     input-exclusivity mechanism. Element-scoped key listeners mean the
     game hears the keyboard — and suppresses arrow/Space defaults — only
     while actually focused. Click a note and type WASD: the note gets it.
     No window-level listeners, no ownership bookkeeping, nothing to leak.

     focus    → loop starts (accumulator cleared: resume, never catch up)
     blur     → loop stops, held keys cleared, last frame stays painted
     minimize → pause + blur (the frozen frame shrinks into the taskbar —
                same policy as media types, it's what real desktops do)
     restore  → refocus (the user explicitly asked for the game back)
     close    → loop cancelled; the inspector closes with it; window DOM
                and this open's closure state die together
     scroll away → the running loop watches its overlay's .is-clear class
                — the desktop's OWN interaction gate (grow > 0.7, the
                same class whose CSS rule enables pointer-events on every
                window). Crossing the midpoint flips the gate target,
                grow decays, .is-clear drops, and the game blurs ITSELF
                right as the desktop disassembles. A partial excursion
                that never crosses the midpoint never pauses: the desktop
                never disassembles, so the match keeps running. Scrolling
                back does NOT auto-resume — the frozen frame and the
                CLICK TO PLAY hint wait for a deliberate click, so the
                keyboard is never captured by surprise.

                Why .is-clear and NOT the core's .is-active: the desktop
                is a self-driven type — its visible/interactive state
                follows its gate-driven grow — while .is-active carries a
                presence term that follows the core's presence fade
                (FADE 0.42, failing at |dist| ≈ 0.365). The two signals
                disagree in the band |dist| ≈ 0.365..0.5: the core says
                "not active" while the desktop is still fully opaque,
                assembled, and interactive. Keying liveness to .is-active
                froze the game inside that band with clicks appearing
                dead. .is-clear makes the liveness signal IDENTICAL to
                the clickability signal, so that dead zone cannot exist.
                (The overlay is fade-only and never leaves the viewport
                box, so IntersectionObserver can't see panel exits; the
                class read — one classList.contains per live frame — can.)

   THE INSPECTOR WINDOW — replaces the vendored canvas debug overlay's
   TEXT panels (live stats + history) with real DOM in a desktop window:
   selectable, legible at any scale, styled in the site's language
   (frosted shell from the panel, brand strip, Hornet kickers, Gridnik
   data rows on the ink ramp). Always open alongside the game — no
   toggle; it is presentation as much as tooling, in the site's
   instrument tradition. Design decisions, each deliberate:

     - PAIRED LIFECYCLE. Opening the game programmatically opens the
       inspector item's window through the panel's openItemWindowByName
       (the one export this module uses beyond registerFileType — a
       named primitive, not a reach into internals). Closing the game
       closes the inspector. Closing the inspector alone is allowed —
       the close button is panel-owned and honest — and the next game
       open brings it back. Opened standalone with no match running, it
       shows an empty state.
     - THE GAME LOOP DRIVES THE REPAINT. The inspector runs no clock of
       its own: the game's loop repaints it after each render. A paused
       game means a frozen World, so a frozen readout is CORRECT — one
       clock, one writer, zero idle cost.
     - ALWAYS-ON ROLLING HISTORY. The vendored overlay's press-\-to-
       record model is replaced by a 20-entry ring of fighter A's state,
       captured PER GAME TICK (frame-accurate, unlike the vendored
       per-render capture) and always current — the last 20 frames are
       simply always there, newest first.
     - SINGLE MATCH BY DESIGN. One authored game icon, one World, one
       inspector. (If two game items were ever authored, the last
       opened match owns the inspector — acceptable for a dev surface.)
     - RE-DERIVED FORMATTING. The vendored liveStats/history draw to
       canvas and don't export their line builders, so this module
       rebuilds the row text itself — reusing the vendored fmt/signed/
       bit number formatters (importing vendored code is fine; only
       EDITING it is forbidden). If the game grows a fighter field,
       add its row here by hand.
     - OPENS BESIDE ITS MATCH. The paired open passes pixel geometry
       (computed from the game window's live rect, height-matched, right
       side preferred / left as fallback) through openItemWindowByName's
       optional second argument — the same authored-geometry channel
       openOnLoad uses. First open per session only: once the user drags
       either window, the panel's per-session windowState wins the
       precedence chain, so custom layouts stick.
     - THE INSTRUMENT PALETTE. The readout is a visual instrument, not
       just tooling — the site is a showcase and the panel should read
       as a wall of moving figures in the brand primaries. Roles follow
       visualLanguage.md: green = go (grounded yes, any input bit held,
       shield on), red = warn (grounded no, damage above zero, spent air
       jumps, a pending hit), blue = info (facing, moving velocity, live
       stick deflection), yellow = the action state — the value that IS
       the match. State changes, damage changes, and landed hits blink
       via a restartable CSS animation; everything else changes color by
       simply being what it is, 60 times a second.

   THE BOX OVERLAY (the debug overlay's WORLD-SPACE half)
     Hurtboxes are spatial draws over the fighters — they can only live
     on the game canvas. Backtick toggles them, handled in the surface's
     element-scoped keydown (fires only while the game is focused, so the
     key never leaks site-wide — the wart the vendored initOverlayInput's
     window-level listener had is structurally gone, and initOverlayInput
     is not imported at all). The color editor is retired entirely. The
     toggle is module-scope so it survives close-and-reopen within a
     session.

     HITBOXES ARE NOT PART OF THIS TOGGLE. They were promoted out of the
     debug layer into the game's own renderer — always drawn, in both
     composition roots, because until real attack animations exist the
     active hitbox IS the attack's visual. gameRender paints them; this
     file does nothing to get them and cannot turn them off. One
     consequence: hitboxes now land on the canvas BEFORE the hurtbox
     draw below, so where the two overlap green sits over red — the
     inverse of the old vendored-overlay order.

   THE VENDOR RULE (unchanged)
     ./calileiGame/src/** is a byte-identical copy of the game repo's src/
     tree. NEVER edit it here — sync is a dumb copy of src/ from the game
     repo, forever. Anything embed-shaped lives in THIS file. The game's
     own main.js sits unused in the vendored tree; input/keyboard.js and
     debug/overlay.js are not imported (window-level listeners); the
     draw-only debug modules (hurtboxes, format) ARE imported —
     importing vendored code is the point of vendoring it. (debug/
     hitboxes.js no longer exists — that draw moved into the renderer.)

   WINDOW CONTENT DOM (game window):

     .desktop-game-surface (tabindex="0")   ← the focus target; field-grey
       ├── <canvas class="desktop-game-canvas" width="960" height="540">
       └── .desktop-game-hint               ← "CLICK TO PLAY" — pure CSS:
                                               visible until :focus, so it
                                               reads as the pause state too

   WINDOW CONTENT DOM (inspector window):

     .desktop-inspector-wrap
       ├── .desktop-inspector-strip         ← 4-color brand strip (4px),
       │     └── …-strip-{r,y,g,b}             the desktopVideo motif
       └── .desktop-inspector-body          ← scrollable readout
             ├── .desktop-inspector-empty   ← "NO MATCH RUNNING" state
             └── .desktop-inspector-live
                   ├── MATCH section (frame marquee)
                   ├── the fighters band — .desktop-inspector-fighters,
                   │     a sideways-scrolling row of fixed-width
                   │     .desktop-inspector-fighter columns, so both
                   │     fighters AND the history are on screen at once
                   │     at desktop sizes
                   └── HISTORY section (20 four-column rows, newest first)

   AUTHORED DATA SHAPE
     { type: "game",      name: "calileiGame", lineColor: …, fillColor: … }
     { type: "inspector", name: "inspector",   lineColor: …, fillColor: … }
     The inspector item's NAME must match INSPECTOR_ITEM_NAME below —
     it's how the game window finds it to open it.

   COUPLED WITH
     - desktopPanel.js: imports registerFileType + openItemWindowByName
       (name, plus optional pixel geometry — the openOnLoad authored
       channel — used to place the inspector beside its match).
       Uses the win handle's fitToContent + onMinimize + onRestore +
       onClose. The game loop also READS the panel-owned .is-clear class
       off its ancestor overlay — the same gate that enables window
       pointer-events (no import; one classList.contains per live frame).
     - desktopGameStyles.css: emits BOTH class families diagrammed above.
     - ./calileiGame/src/**: the vendored game engine (read-only here).
     - main.js: importing this file installs both types; the desktop's
       items array must author both entries.
   ========================================================================== */

import {
  registerFileType,
  openItemWindowByName,
} from "./desktopPanel.js";

// --- CalileiGame imports — the same set the game's main.js composes from,
//     minus input/keyboard.js (replaced by the focus-scoped listeners
//     below) and minus main.js itself (self-executing; never imported).
import { createWorld }            from "./calileiGame/src/world/world.js";
import { tick as gameTick }       from "./calileiGame/src/world/tick.js";
import { render as gameRender }   from "./calileiGame/src/render/renderer.js";
import { createFighter }          from "./calileiGame/src/entities/fighter.js";
import { battlefield }            from "./calileiGame/src/data/stages/battlefield.js";
import { fighterA }               from "./calileiGame/src/data/characters/fighterA.js";
import { fighterB }               from "./calileiGame/src/data/characters/fighterB.js";
import { states }                 from "./calileiGame/src/data/states/states.js";
// NEUTRAL_SNAPSHOT is the engine's own frozen "no input" object. The
// inputSystem takes a POSITIONAL array — inputsByFighter[i] → fighters[i]
// (Phase 13) — so this module feeds an array shaped like the one the
// standalone main.js builds, reusing this exact neutral for the dummy.
import { NEUTRAL_SNAPSHOT }       from "./calileiGame/src/core/inputBuffer.js";
// The debug pieces that survive the overlay's retirement: the hurtbox
// world-space draw (canvas-only by nature) and the number formatters
// (reused so the inspector's values read identically to the standalone
// overlay's). Hitboxes are absent by design — the renderer draws them
// unconditionally now; see THE BOX OVERLAY in the header.
import { drawHurtboxes }          from "./calileiGame/src/debug/hurtboxes.js";
import { fmt, signed, bit }       from "./calileiGame/src/debug/format.js";

/* -----------------------------------------------------------------------------
   FILE-TYPE TUNABLES
   --------------------------------------------------------------------------- */

// --- Game-clock constants. Provenance: the game repo's main.js. Kept
//     numerically identical so the embedded build ticks exactly like the
//     standalone one.
const TARGET_FPS = 60;
const MS_PER_FRAME = 1000 / TARGET_FPS;
const MAX_PENDING_FRAMES = 5;

// --- Spawn points. Provenance: game main.js (Phase 13). Bottom-center
//     anchor — these are each fighter's feet. Both spawn airborne; Idle's
//     notGrounded transition sends them to Fall on the first tick.
//     fighters[0] is the human-controlled A; fighters[1] is the dummy B.
const SPAWN_Y = 100;
const SPAWN_X_A = 400;
const SPAWN_X_B = 560;

// --- Native resolution. The renderer, stage geometry, and blast zones all
//     live in this coordinate space; the backing store must stay 960×540.
//     Display size is the window's job.
const GAME_W = 960;
const GAME_H = 540;

// Initial window dimensions before the immediate fitToContent calls.
const GAME_DEFAULT_W = 640;
const GAME_DEFAULT_H = 360;
const INSPECTOR_DEFAULT_W = 640;   // two fighter columns side by side
const INSPECTOR_DEFAULT_H = 460;   // floor; placement height-matches the game
const INSPECTOR_MIN_W = 340;       // one column + sideways fighter scroll —
                                   //   the narrowest the auto-placement goes
                                   //   before switching sides / pinning

// The authored NAME of the inspector item — how the game window asks the
// panel to open it. Rename the authored entry → rename this.
const INSPECTOR_ITEM_NAME = "inspector";

// Rolling history depth, in game ticks. Matches the vendored overlay's
// HISTORY_FRAMES so the tool reads the same as the standalone one.
const HISTORY_FRAMES = 20;

// Backtick toggles the hurtbox canvas overlay. Element-scoped — only
// fires while the game surface is focused. (Hitboxes are not toggleable;
// the renderer always draws them — see THE BOX OVERLAY in the header.)
const BOX_TOGGLE_KEY = "Backquote";

// Keys whose browser default we suppress WHILE THE SURFACE IS FOCUSED —
// the deliberate claim: down-arrow should crouch, not scroll the page.
// Identical set to the game repo's keyboard.js. Element-scoped, so the
// suppression ends the instant focus moves anywhere else.
const PREVENT_DEFAULT = new Set([
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space",
]);

/* -----------------------------------------------------------------------------
   SHARED MATCH STATE (module scope)
   -----------------------------------------------------------------------------
   The narrow channel between the two windows. The GAME writes all of it;
   the inspector only holds its own DOM refs. Single-match by design.
   --------------------------------------------------------------------------- */
let currentWorld = null;   // the open match's World, or null
let inspectorUI = null;    // the inspector's DOM refs while open, or null
let inspectorWin = null;   // the inspector's win handle while open, or null
let boxesOn = false;       // hurtbox canvas overlay (backtick);
                           //   module-scope so it survives reopen

// The rolling history ring: prebuilt row strings, newest first. Built at
// push time (once per game tick) so repaint only moves strings into DOM.
const history = [];

function pushHistory(world) {
  const f = world.fighters[0];
  if (!f) return;
  history.unshift({
    fr: String(world.frame),
    st: `${f.actionState} (${f.stateFrame})`,
    ps: `${fmt(f.x)},${fmt(f.y)}`,
    vl: `${fmt(f.vx)},${fmt(f.vy)} ${f.grounded ? "G" : "\u00b7"}`,
  });
  if (history.length > HISTORY_FRAMES) history.pop();
}

function clearHistory() {
  history.length = 0;
}

/* -----------------------------------------------------------------------------
   INSPECTOR — DOM construction and repaint
   -----------------------------------------------------------------------------
   Built once per inspector open; (re)bound to a match whenever the game
   opens or the inspector opens mid-match. Values are TOKENS — individual
   spans with a guarded text write and a guarded modifier class, so a
   settled value writes nothing and a color only changes when its meaning
   does. Palette roles (see THE INSTRUMENT PALETTE, header): is-go green,
   is-warn red, is-info blue, is-dim receded; the state token is yellow by
   its base class; the frame counter is the accent marquee.
   --------------------------------------------------------------------------- */

// A token ref: { el, last (text), cls (current modifier class) }.
function makeRef(el) {
  return { el, last: null, cls: null };
}

// Guarded text + guarded modifier-class write.
function setTok(ref, text, cls = null) {
  if (ref.last !== text) {
    ref.last = text;
    ref.el.textContent = text;
  }
  if (ref.cls !== cls) {
    if (ref.cls) ref.el.classList.remove(ref.cls);
    if (cls) ref.el.classList.add(cls);
    ref.cls = cls;
  }
}

// Restart the blink animation on a token. The remove/reflow/add dance
// restarts the CSS animation; the forced reflow is a tiny span at
// change cadence, not per frame.
function flashTok(ref) {
  ref.el.classList.remove("desktop-inspector-flash");
  void ref.el.offsetWidth;
  ref.el.classList.add("desktop-inspector-flash");
}

// setTok + a blink when the text actually changed. ONLY for tokens whose
// text changes exactly when their meaning does (damage, pending). NOT
// for the state token: its text carries the per-tick stateFrame counter,
// so "text changed" fires every frame while the loop runs, and a
// per-change blink keeps the animation pinned at its dim first keyframe
// — the state row sat unreadable during play. State blinks via flashTok
// on ACTION-STATE changes only, in repaintInspector.
function setTokFlash(ref, text, cls = null) {
  const changed = ref.last !== text;
  setTok(ref, text, cls);
  if (changed) flashTok(ref);
}

// One label row. Returns the value container; tokens are added into it.
function addRow(section, label) {
  const row = document.createElement("div");
  row.className = "desktop-inspector-row";
  const k = document.createElement("span");
  k.className = "desktop-inspector-k";
  k.textContent = label;
  const v = document.createElement("span");
  v.className = "desktop-inspector-v";
  row.appendChild(k);
  row.appendChild(v);
  section.appendChild(row);
  return v;
}

// A dynamic token span inside a value container. baseClass is for
// tokens whose color is fixed by role (state yellow, facing blue).
function addTok(container, baseClass = "") {
  const el = document.createElement("span");
  el.className = `desktop-inspector-t${baseClass ? " " + baseClass : ""}`;
  container.appendChild(el);
  return makeRef(el);
}

// A static separator between tokens ("·"), receded.
function addSep(container) {
  const el = document.createElement("span");
  el.className = "desktop-inspector-t is-dim";
  el.textContent = "\u00b7";
  container.appendChild(el);
}

function addKicker(parent, text) {
  const el = document.createElement("div");
  el.className = "desktop-inspector-kicker";
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

function buildInspectorDOM() {
  const wrap = document.createElement("div");
  wrap.className = "desktop-inspector-wrap";

  // Brand strip — the desktopVideo motif, the family's instrument mark.
  const strip = document.createElement("div");
  strip.className = "desktop-inspector-strip";
  for (const c of ["r", "y", "g", "b"]) {
    const cell = document.createElement("div");
    cell.className = `desktop-inspector-strip-${c}`;
    strip.appendChild(cell);
  }
  wrap.appendChild(strip);

  const body = document.createElement("div");
  body.className = "desktop-inspector-body";
  wrap.appendChild(body);

  // Empty state — shown whenever no match is running.
  const empty = document.createElement("div");
  empty.className = "desktop-inspector-empty";
  const emptyKicker = document.createElement("div");
  emptyKicker.className = "desktop-inspector-kicker";
  emptyKicker.textContent = "NO MATCH RUNNING";
  const emptyHint = document.createElement("div");
  emptyHint.className = "desktop-inspector-empty-hint";
  emptyHint.textContent = "open calileiGame to begin";
  empty.appendChild(emptyKicker);
  empty.appendChild(emptyHint);
  body.appendChild(empty);

  // Live container — fighter sections are (re)built per match by
  // bindInspectorToMatch, since the fighter roster belongs to the World.
  const live = document.createElement("div");
  live.className = "desktop-inspector-live";
  body.appendChild(live);

  return {
    wrap,
    empty,
    live,
    boundWorld: null,  // the World the live sections were built for
    frame: null,       // token refs, filled by bindInspectorToMatch
    fighters: [],
    historyRows: [],
  };
}

function bindInspectorToMatch(world) {
  const ui = inspectorUI;
  if (!ui) return;
  ui.boundWorld = world;
  ui.live.textContent = "";  // drop any previous match's sections
  ui.fighters = [];
  ui.historyRows = [];

  // MATCH section — the frame counter is the marquee: the always-moving
  // number that makes the panel read as a live instrument at a glance.
  const match = document.createElement("div");
  match.className = "desktop-inspector-section";
  addKicker(match, "MATCH");
  ui.frame = addTok(addRow(match, "frame"), "desktop-inspector-frame");
  ui.live.appendChild(match);

  // The fighters band — one horizontal row of per-fighter columns, so
  // both fighters AND the history below them are on screen at once at
  // desktop sizes (the point of the panel: everything visible on first
  // open). Columns are fixed-width so value tokens wrap within them;
  // the ROW scrolls sideways when the window is narrower than its
  // columns.
  const band = document.createElement("div");
  band.className = "desktop-inspector-section";
  const fightersRow = document.createElement("div");
  fightersRow.className = "desktop-inspector-fighters";
  band.appendChild(fightersRow);

  for (let i = 0; i < world.fighters.length; i++) {
    const f = world.fighters[i];
    const col = document.createElement("div");
    col.className = "desktop-inspector-fighter";
    addKicker(col, `FIGHTER ${i} \u2014 ${f.config.name}`);

    const r = { stateName: null };  // action-state tracking for the blink
    r.state   = addTok(addRow(col, "state"), "desktop-inspector-state");
    r.pos     = addTok(addRow(col, "pos"));
    r.vel     = addTok(addRow(col, "vel"));

    const groundV = addRow(col, "ground");
    r.ground  = addTok(groundV);
    addSep(groundV);
    r.facing  = addTok(groundV, "is-info");

    r.airjump = addTok(addRow(col, "airjump"));
    r.damage  = addTok(addRow(col, "damage"));

    const sticksV = addRow(col, "sticks");
    r.stickL  = addTok(sticksV);
    r.stickR  = addTok(sticksV);

    const attackV = addRow(col, "attack");
    r.bits = {};
    for (const b of ["jmp", "la", "ha", "ls", "hs", "grb"]) {
      r.bits[b] = addTok(attackV);
    }

    const defV = addRow(col, "defense");
    r.shd     = addTok(defV);
    r.depth   = addTok(defV);

    r.pending = addTok(addRow(col, "pending"));

    ui.fighters.push(r);
    fightersRow.appendChild(col);
  }
  ui.live.appendChild(band);

  // HISTORY section — fighter A, newest first, fixed row count so the
  // panel never jitters; unfilled rows stay blank until the ring fills.
  const hist = document.createElement("div");
  hist.className = "desktop-inspector-section";
  addKicker(hist, `HISTORY \u2014 LAST ${HISTORY_FRAMES} TICKS`);
  const table = document.createElement("div");
  table.className = "desktop-inspector-history";
  for (let i = 0; i < HISTORY_FRAMES; i++) {
    const row = document.createElement("div");
    row.className = "desktop-inspector-hrow";
    const cells = [];
    for (let c = 0; c < 4; c++) {
      const cell = document.createElement("span");
      row.appendChild(cell);
      cells.push(makeRef(cell));
    }
    table.appendChild(row);
    ui.historyRows.push(cells);
  }
  hist.appendChild(table);
  ui.live.appendChild(hist);

  ui.empty.style.display = "none";
  ui.live.style.display = "";
}

function inspectorShowEmpty() {
  const ui = inspectorUI;
  if (!ui) return;
  ui.boundWorld = null;
  ui.empty.style.display = "";
  ui.live.style.display = "none";
}

function repaintInspector(world) {
  const ui = inspectorUI;
  if (!ui) return;
  if (ui.boundWorld !== world) bindInspectorToMatch(world);

  setTok(ui.frame, String(world.frame));

  for (let i = 0; i < world.fighters.length; i++) {
    const f = world.fighters[i];
    const r = ui.fighters[i];
    if (!r) continue;

    // State — yellow by base class; the text updates every tick (the
    // stateFrame counter), but the blink fires only when the ACTION
    // STATE itself changes. Blinking on every text change kept the
    // animation permanently restarted at its dim first keyframe while
    // the loop ran — the state row sat unreadable during play.
    setTok(r.state, `${f.actionState} (${f.stateFrame})`);
    if (r.stateName !== f.actionState) {
      r.stateName = f.actionState;
      flashTok(r.state);
    }

    setTok(r.pos, `x=${fmt(f.x)} y=${fmt(f.y)}`);

    // Velocity — info-blue while anything is moving.
    const moving = Math.abs(f.vx) > 0.001 || Math.abs(f.vy) > 0.001;
    setTok(r.vel, `vx=${fmt(f.vx)} vy=${fmt(f.vy)}`, moving ? "is-info" : null);

    // Grounded — the user-specified pair: yes green, no red.
    setTok(r.ground, f.grounded ? "grounded" : "airborne",
      f.grounded ? "is-go" : "is-warn");
    setTok(r.facing, f.facing > 0 ? "facing right" : "facing left");

    // Air jumps — spent = warn.
    const maxJ = f.config.physics.maxAirJumps;
    setTok(r.airjump, `${f.airJumpsUsed}/${maxJ}`,
      f.airJumpsUsed >= maxJ ? "is-warn" : null);

    // Damage — warn-red the moment it exists, blinks when it grows.
    setTokFlash(r.damage, `${f.damage.toFixed(1)}%`,
      f.damage > 0 ? "is-warn" : null);

    const now = f.inputBuffer[0];
    if (now) {
      const lLive = now.stickX !== 0 || now.stickY !== 0;
      const rLive = now.cStickX !== 0 || now.cStickY !== 0;
      setTok(r.stickL, `L=(${signed(now.stickX)},${signed(now.stickY)})`, lLive ? "is-info" : null);
      setTok(r.stickR, `R=(${signed(now.cStickX)},${signed(now.cStickY)})`, rLive ? "is-info" : null);

      // Input bits — each held button lights go-green on its own. This
      // row is the "wall of flashing figures" while someone plays.
      setTok(r.bits.jmp, `jmp=${bit(now.jump)}`,         now.jump         ? "is-go" : null);
      setTok(r.bits.la,  `la=${bit(now.lightattack)}`,   now.lightattack  ? "is-go" : null);
      setTok(r.bits.ha,  `ha=${bit(now.heavyattack)}`,   now.heavyattack  ? "is-go" : null);
      setTok(r.bits.ls,  `ls=${bit(now.lightspecial)}`,  now.lightspecial ? "is-go" : null);
      setTok(r.bits.hs,  `hs=${bit(now.heavyspecial)}`,  now.heavyspecial ? "is-go" : null);
      setTok(r.bits.grb, `grb=${bit(now.grab)}`,         now.grab         ? "is-go" : null);

      setTok(r.shd,   `shd=${bit(now.shield)}`, now.shield ? "is-go" : null);
      setTok(r.depth, `depth=${now.shieldDepth.toFixed(2)}`);
    } else {
      setTok(r.stickL, "(buffer empty)", "is-dim");
      setTok(r.stickR, "");
      for (const b of Object.values(r.bits)) setTok(b, "");
      setTok(r.shd, "");
      setTok(r.depth, "");
    }

    // Pending hit — a landed attack blinks in warn-red.
    const p = f.pendingHit;
    setTokFlash(r.pending, p
      ? `F${p.attackerIndex} d=${p.damage} a=${p.angle} bk=${p.baseKnockback} kg=${p.knockbackGrowth} hs=${p.hitstun}`
      : "\u2014",
      p ? "is-warn" : "is-dim");
  }

  for (let i = 0; i < ui.historyRows.length; i++) {
    const cells = ui.historyRows[i];
    const entry = history[i];
    setTok(cells[0], entry ? entry.fr : "");
    setTok(cells[1], entry ? entry.st : "");
    setTok(cells[2], entry ? entry.ps : "");
    setTok(cells[3], entry ? entry.vl : "");
  }
}

/* -----------------------------------------------------------------------------
   INSPECTOR PLACEMENT — beside its match
   -----------------------------------------------------------------------------
   Computes pixel geometry (the openWindowFor authored channel) from the
   game window's live rect, in the desktop surface's coordinate space.
   Height-matched to the game so the pair reads as one kit; right side
   preferred, left as fallback, pinned inside the surface otherwise.
   Reading the window rect via closest() is a layout read of panel DOM —
   the same posture as the .is-clear read, and only at open time.
   First open per session only: the panel's windowState precedence means
   a user-dragged layout wins on every later open.
   --------------------------------------------------------------------------- */
function inspectorPlacement(surface) {
  const winEl = surface.closest(".desktop-window");
  const host = winEl ? winEl.parentElement : null;
  if (!winEl || !host) return null;

  const wr = winEl.getBoundingClientRect();
  const hr = host.getBoundingClientRect();
  const GAP = 14;
  const MARGIN = 8;
  const h = Math.max(INSPECTOR_DEFAULT_H, Math.round(wr.height));

  // Width adapts to the room beside the game: the full two-column
  // default when it fits, squeezing down to INSPECTOR_MIN_W (one
  // column, fighters row scrolls sideways) before giving up on a side.
  const gameL = wr.left - hr.left;
  const gameR = wr.right - hr.left;
  const roomRight = hr.width - MARGIN - (gameR + GAP);
  const roomLeft  = gameL - GAP - MARGIN;

  let x, w;
  if (roomRight >= INSPECTOR_MIN_W) {
    w = Math.min(INSPECTOR_DEFAULT_W, roomRight);   // right of the game
    x = gameR + GAP;
  } else if (roomLeft >= INSPECTOR_MIN_W) {
    w = Math.min(INSPECTOR_DEFAULT_W, roomLeft);    // left of the game
    x = gameL - GAP - w;
  } else {
    w = Math.min(INSPECTOR_DEFAULT_W, hr.width - MARGIN * 2);
    x = Math.max(MARGIN, hr.width - w - MARGIN);    // pin to the right edge
  }

  let y = wr.top - hr.top;
  y = Math.max(MARGIN, Math.min(y, hr.height - MARGIN - 40));  // header reachable

  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/* -----------------------------------------------------------------------------
   REGISTRATION — the "game" type
   --------------------------------------------------------------------------- */
registerFileType("game", {

  // A gamepad glyph — rounded body, d-pad cross, two action buttons.
  // Tinting per desktopPanel.md §7: body fill via desktop-glyph-fill,
  // solid marks via currentColor.
  buildIcon(_file) {
    const wrap = document.createElement("div");
    wrap.className = "desktop-game-glyph";
    wrap.innerHTML = `
      <svg viewBox="0 0 40 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="4" y="8" width="32" height="16" rx="5"
              class="desktop-glyph-fill"
              stroke="currentColor" stroke-width="1.5"
              stroke-linejoin="round" />
        <path d="M13,12.5 L13,19.5 M9.5,16 L16.5,16"
              stroke="currentColor" stroke-width="1.5"
              stroke-linecap="round" />
        <circle cx="26.5" cy="14" r="1.8" fill="currentColor" />
        <circle cx="30.5" cy="18" r="1.8" fill="currentColor" />
      </svg>
    `;
    return wrap;
  },

  buildWindow(file, win) {
    // ---------- Surface + canvas + hint ----------
    const surface = document.createElement("div");
    surface.className = "desktop-game-surface";
    surface.tabIndex = 0;

    const canvas = document.createElement("canvas");
    canvas.className = "desktop-game-canvas";
    canvas.width = GAME_W;
    canvas.height = GAME_H;
    surface.appendChild(canvas);

    const hint = document.createElement("div");
    hint.className = "desktop-game-hint";
    hint.textContent = "CLICK TO PLAY";
    surface.appendChild(hint);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.error(`desktopGame "${file.name}": failed to acquire 2D context`);
      return surface; // an inert dark window beats a thrown build
    }

    // ---------- Compose the game, exactly as the standalone main.js
    //            does (Phase 13): fighter A (human) + fighter B (dummy).
    const world = createWorld(battlefield, states);
    world.fighters.push(createFighter(fighterA, SPAWN_X_A, SPAWN_Y));
    world.fighters.push(createFighter(fighterB, SPAWN_X_B, SPAWN_Y));

    // This match becomes THE match: the inspector's subject, the
    // console's `world`. Fresh history for a fresh match.
    currentWorld = world;
    clearHistory();
    window.world = world;

    // Frame zero, synchronously: the renderer is a pure function of the
    // World and a detached canvas draws fine, so the window opens showing
    // the spawn frame under the hint even before focus arrives.
    gameRender(world, ctx);

    // ---------- Loop state (closure-local) ----------
    const heldKeys = new Set();
    let rafId = 0;         // 0 = not scheduled; doubles as the live flag
    let lastTime = null;   // null = first frame after (re)start elapses 0
    let accumulator = 0;
    let minimized = false;
    let overlayEl = null;  // ancestor .infinite-overlay — resolved lazily
                           //   on first focus (buildWindow runs pre-insert)

    // Exact mirror of the game repo's getCurrentInput(). If the game
    // repo rebinds keys, re-mirror here.
    function buildSnapshot() {
      let stickX = 0;
      if (heldKeys.has("ArrowLeft")  || heldKeys.has("KeyA")) stickX -= 1;
      if (heldKeys.has("ArrowRight") || heldKeys.has("KeyD")) stickX += 1;

      let stickY = 0;
      if (heldKeys.has("ArrowUp")    || heldKeys.has("KeyW")) stickY -= 1;
      if (heldKeys.has("ArrowDown")  || heldKeys.has("KeyS")) stickY += 1;

      const shield = heldKeys.has("KeyX");

      return {
        stickX,
        stickY,
        cStickX: 0,
        cStickY: 0,
        jump:         heldKeys.has("Space"),
        lightattack:  heldKeys.has("KeyZ"),
        heavyattack:  heldKeys.has("KeyC"),
        lightspecial: heldKeys.has("KeyV"),
        heavyspecial: heldKeys.has("KeyB"),
        grab:         heldKeys.has("KeyN"),
        shield,
        shieldDepth: shield ? 1.0 : 0.0,
      };
    }

    // ---------- The loop — the game main.js loop body, re-hosted ----------
    // Consumes rAF's frame timestamp (see THE CLOCK, header). Schedules
    // its successor FIRST so the off-panel branch's blur() — which stops
    // the loop synchronously via the blur listener — cancels the id that
    // was just created, leaving nothing scheduled.
    function loop(now) {
      rafId = requestAnimationFrame(loop);

      // Off-panel self-check, keyed to the DESKTOP'S OWN gate. The panel
      // toggles .is-clear on the overlay at grow 0.7 — the same class
      // that gates pointer-events on every window — so "the game may
      // run" and "the game is clickable" are one signal and can never
      // disagree. (Keying this to the core's .is-active opened a dead
      // zone near the panel edge; see the header.)
      if (!overlayEl || !overlayEl.classList.contains("is-clear")) {
        surface.blur();
        return;
      }

      if (lastTime === null) lastTime = now;
      accumulator += now - lastTime;
      lastTime = now;

      const maxAccum = MS_PER_FRAME * MAX_PENDING_FRAMES;
      if (accumulator > maxAccum) accumulator = maxAccum;

      // Sample inputs once per rAF; the same snapshots feed every tick
      // drained this frame — matching the standalone loop. Positional
      // contract (Phase 13): [0] human, [1] dummy on the frozen neutral.
      const inputsByFighter = [buildSnapshot(), NEUTRAL_SNAPSHOT];

      while (accumulator >= MS_PER_FRAME) {
        gameTick(world, inputsByFighter);
        pushHistory(world);          // per TICK — frame-accurate history
        accumulator -= MS_PER_FRAME;
      }

      gameRender(world, ctx);

      // The debug overlay's world-space half, canvas-composited.
      // Hurtboxes only: gameRender has already painted the hitboxes
      // (always-on, not ours to gate), so this draw lands on top and a
      // landed attack reads as green-over-red — the inverse of the old
      // vendored-overlay order. Both boxes are translucent, so the
      // overlap stays readable either way.
      if (boxesOn) {
        drawHurtboxes(world, ctx);
      }

      // The inspector rides the game's clock — see header. No-op when
      // the inspector window is closed.
      repaintInspector(world);
    }

    function startLoop() {
      if (rafId) return;
      lastTime = null;     // first frame back elapses 0 — a pause is a
      accumulator = 0;     //   pause, never a queued catch-up burst
      rafId = requestAnimationFrame(loop);
    }

    function stopLoop() {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      heldKeys.clear();    // no key held across a liveness boundary
    }

    // ---------- Focus = liveness ----------
    surface.addEventListener("focus", () => {
      if (minimized) return;                    // restore refocuses for us
      if (!overlayEl) overlayEl = surface.closest(".infinite-overlay");
      window.world = world;                     // DevTools follows attention
      startLoop();
    });

    surface.addEventListener("blur", () => stopLoop());

    // Element-scoped: fire only while the surface holds focus, so there
    // is no liveness check to make — the browser already made it.
    surface.addEventListener("keydown", (e) => {
      if (e.code === "Escape") {                // deliberate release valve
        surface.blur();
        return;
      }
      if (e.code === BOX_TOGGLE_KEY) {          // hurtbox overlay
        if (!e.repeat) boxesOn = !boxesOn;
        e.preventDefault();
        return;
      }
      heldKeys.add(e.code);                     // event.code: layout-independent
      if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
    });
    surface.addEventListener("keyup", (e) => {
      heldKeys.delete(e.code);
    });

    // Clicking anywhere on the game focuses it. Most browsers focus a
    // tabindexed element on click natively; Safari historically doesn't,
    // so make it explicit.
    surface.addEventListener("pointerdown", () => surface.focus());

    // ---------- Window lifecycle ----------
    win.onMinimize(() => {
      minimized = true;
      stopLoop();
      surface.blur();      // a hidden surface must not keep the keyboard;
                           //   the frozen frame is what flies to the taskbar
    });
    win.onRestore(() => {
      minimized = false;
      surface.focus();     // restoring IS "give me the game back"
    });
    win.onClose(() => {
      stopLoop();
      if (window.world === world) window.world = undefined;
      if (currentWorld === world) {
        currentWorld = null;
        clearHistory();
        inspectorShowEmpty();
        // Paired lifecycle: the inspector closes with its match. Deferred
        // a frame so we never nest a closeWindow inside the panel's own
        // close pass for THIS window. (inspectorWin is re-read inside the
        // callback — if the user already closed it, this is a no-op.)
        requestAnimationFrame(() => inspectorWin?.close());
      }
    });

    // ---------- Sizing, the paired open, auto-focus ----------
    // Aspect is known statically — fit immediately (panel clamps to its
    // usual viewport limits, honors userResized on later opens).
    win.fitToContent(GAME_W, GAME_H);

    // Deferred one frame so the panel finishes inserting THIS window
    // before we ask it to open another — which also means the game
    // window's rect is final (fitToContent applied), so the placement
    // math below sees the real geometry. Order matters: open the
    // inspector first (it takes the panel's z-top), then hand DOM focus
    // to the game surface so play starts instantly. If no inspector
    // item is authored, openItemWindowByName returns false and the game
    // simply runs alone.
    requestAnimationFrame(() => {
      openItemWindowByName(INSPECTOR_ITEM_NAME, inspectorPlacement(surface));
      surface.focus();
    });

    return surface;
  },

  defaultWindow: { width: GAME_DEFAULT_W, height: GAME_DEFAULT_H },
});

/* -----------------------------------------------------------------------------
   REGISTRATION — the "inspector" type
   --------------------------------------------------------------------------- */
registerFileType("inspector", {

  // A readout glyph — a screen with a pulse trace. Same tinting
  // conventions as the game glyph: fillable screen, currentColor trace.
  buildIcon(_file) {
    const wrap = document.createElement("div");
    wrap.className = "desktop-inspector-glyph";
    wrap.innerHTML = `
      <svg viewBox="0 0 40 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="4" y="5" width="32" height="22" rx="2"
              class="desktop-glyph-fill"
              stroke="currentColor" stroke-width="1.5"
              stroke-linejoin="round" />
        <path d="M8,18 L14,18 L17,11 L21,23 L24,16 L32,16"
              stroke="currentColor" stroke-width="1.5"
              stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    `;
    return wrap;
  },

  buildWindow(_file, win) {
    const ui = buildInspectorDOM();
    inspectorUI = ui;
    inspectorWin = win;

    if (currentWorld) {
      bindInspectorToMatch(currentWorld);
      repaintInspector(currentWorld);  // show the frozen state even if
                                       //   the game is currently paused
    } else {
      inspectorShowEmpty();
    }

    win.onClose(() => {
      // The user may close the inspector alone — honest close button,
      // honest close. The next game open brings it back.
      inspectorUI = null;
      inspectorWin = null;
    });

    return ui.wrap;
  },

  defaultWindow: { width: INSPECTOR_DEFAULT_W, height: INSPECTOR_DEFAULT_H },
});
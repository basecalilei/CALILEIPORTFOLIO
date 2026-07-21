## Phase 10: The Debug Overlay

Phase 10 is the only phase that changes nothing about gameplay. The engine ticks exactly the same with the overlay enabled, disabled, or with the user dragging sliders around inside it. What this phase adds is *visibility* and, in the expansions you authored, *interactive authoring* — the ability to see what the engine is doing every frame, watch state propagate across recent history, and tune visual properties in real time without editing source files.

For a project where most bugs hide in frame-by-frame state transitions (Phases 5 through 9 each had at least one bug of this flavor), that visibility is worth its weight in development time. And for a project where the visual identity of states is part of how you read what's happening, an in-engine color editor is the difference between "edit, save, refresh, observe" and "tune until it feels right, in one continuous flow."

This breakdown covers the whole phase as it stands now: the original overlay scaffold, the expanded input snapshot, the 20-frame history panel, the color editor, and the state-color authoring change. I'll walk each piece, explain the architectural choices, and call out what's load-bearing for future work.

---

### Where this phase fits

The plan called Phase 10 "a debug overlay." That framing implied: a small file, a toggle key, some text on the canvas. We ended up with something larger — a real developer tool with multiple panels, interactive widgets, and its own mouse and keyboard handling. The reason for the expansion: once the architecture proved capable of supporting it cheaply, adding more value was just authoring more panels. Each panel is its own focused module, each panel is independent of the others, each panel uses the same patterns. The substrate absorbed the expansion without protest.

Two things made this possible. First, **the overlay state is meta-state, not game state.** It lives outside the World, mutates freely without affecting determinism, and doesn't participate in the tick. Second, **the existing render path was already pure — read World, write pixels, hold no references.** Layering more panels on top of that pipeline is just more drawing functions.

---

### The base scaffold: toggle, draw, ignore

The original Phase 10 had two files: `overlayState.js` and `overlay.js`. Together they did one thing well — toggle a HUD on and off, and when on, draw a translucent panel with per-frame fighter stats.

**`overlayState.js`** was a singleton object with one field:

> *overlayState is an object with an `enabled` boolean.*
> *toggleOverlay() flips it.*

That's the whole file. It exists as its own module so that any code that wants to read or modify the flag does so through a single source of truth. Both the keyboard listener (which toggles it) and the draw function (which checks it) import the same module. The flag is *not* on the World — that's the load-bearing architectural choice. Game logic should not know whether the overlay is visible. The simulation runs identically with the overlay shown or hidden. If overlayState lived on the World, the same World would behave differently based on UI state, which would break the determinism rule.

The pattern here is important: **the overlay is meta-state, not game state.** Anything that doesn't affect the simulation lives outside the World. The flag, the history buffer, the selected color state, the active slider drag — all of them are meta-state, all of them are in `overlayState.js`, none of them touch game logic.

**`overlay.js`** exported two functions. `initOverlayInput()` installed a window-level keydown listener for the toggle key, which was bound to backtick (event.code `'Backquote'`) because that key sits outside the gameplay area and reads as a "console" key on most keyboards. The listener guarded against auto-repeat — holding the key down shouldn't flicker the toggle every frame the OS sends a repeat event. One toggle per discrete press.

`drawOverlay(world, ctx)` was called from main.js once per render, *after* the main render. The order was: clear canvas → draw stage → draw fighter → draw overlay on top. The overlay sat in screen space, anchored to the top-left corner regardless of where the fighter was.

The panel itself was a translucent dark rectangle with text lines. The lines showed: frame counter, action state and frame, position, velocity, grounded flag, facing direction, air jumps used/max, and a few lines of input snapshot. Each fighter got its own block (in case of future multi-fighter setups). The header lines were accented yellow for visual anchoring while scanning; the rest was off-white.

The choice of *what* to show was itself a design decision worth pinning down. Included: things that change per-frame and matter per-frame — state, position, velocity, grounded, input. Excluded: things that are static (stage geometry), rare (performance metrics), or noisy (full input buffer history). The principle: **show what changes per-frame and matters per-frame.** Everything else either belongs in the source or in dedicated debug tools.

**The keyboard listener was deliberately separate from the gameplay keyboard module.** This is worth emphasizing because it generalizes. If the overlay toggle went through the gameplay pipeline (`input/keyboard.js`), the backtick key would get added to the held-keys Set, get included in input snapshots, sit in the input buffer, and need to be ignored by every condition that scans the buffer. That's wrong on every level. The toggle isn't a game input. It doesn't affect the simulation. It shouldn't even exist in the deterministic state stream. By giving the overlay its own listener, the gameplay input pipeline carries only game inputs. **Meta-tools have meta-input.** Pause buttons, debug toggles, menu navigation, screenshot triggers — none of these should flow through the gameplay buffer. Each is independent.

That was the entirety of the base Phase 10. Two files, maybe 200 lines combined, no changes to anything else in the engine. The substrate ate it cleanly.

---

### The input snapshot expansion

After the base overlay was built, a question came up that wasn't strictly part of Phase 10 but landed in the same session: *should the snapshot shape be expanded now, knowing that gamepad support and combat are both coming?*

The original snapshot was `{stickX, stickY, jump, attack, shield}`. Three buttons, one stick. Two of those buttons (`attack`, `shield`) were captured but unused — they were added in Phase 4 as a deliberate "claim the obvious slots so we don't keep changing the contract."

The expansion: bring the snapshot to a shape that maps cleanly to a real controller, names fields by gameplay role rather than hardware button, and covers every input a platform fighter needs. The final shape:

> *A snapshot has:*
> *- stickX, stickY: left stick. Integer -1/0/+1 on keyboard; analog (-1.0 to +1.0) on a future gamepad.*
> *- cStickX, cStickY: right stick / c-stick. Always 0 on keyboard; analog on gamepad. Reserved for smash and aerial direction.*
> *- jump: boolean.*
> *- lightattack, heavyattack: standard attack family, decoupled by which button is pressed rather than by stick + attack combination.*
> *- lightspecial, heavyspecial: special move family.*
> *- grab: bypasses shield.*
> *- shield: boolean, held at any depth.*
> *- shieldDepth: float 0.0 to 1.0. Analog shield strength.*

Eleven fields, all consumer-named (light/heavy/neutral, not A/B/X/Y), maps cleanly to a real controller. The keyboard bindings: Z = lightattack, C = heavyattack, V = lightspecial, B = heavyspecial, N = grab, X = shield (and shieldDepth = 1.0). Six keys in a row across the bottom row of QWERTY, easy to reach with the right hand while the left hand drives movement on WASD or arrows.

**Why expand the contract now instead of incrementally?**

The cost of expanding the snapshot incrementally is low — each new field is a few lines of code. But the cost of doing it incrementally across the project is structural friction. Each time the snapshot shape changes, every place in the engine that constructs or reads a snapshot has to be checked. If we added `special` in two months and `taunt` in three months, that's two rounds of contract migration: update the keyboard builder, decide on defaults for missing fields, update the input buffer's pushInput behavior, update any test snapshots. Adding them all now is zero rounds. **The snapshot is a contract; stable contracts are cheap to consume.**

The fields are inert — no condition reads `lightattack` or `heavyspecial` yet. They sit in the buffer as default values until a future state references them through `wasPressedWithin(buffer, 'lightattack', N)` or similar. Adding the consuming logic later is purely additive: no contract migration, no buffer reshape, no condition rewrite.

**Why decouple light from heavy via separate buttons?**

Smash and many Smash-likes use stick + attack combination to distinguish light tilt attacks from heavy smash attacks. You authored a different design: separate buttons for each. This is architecturally cleaner. The attack character is determined by *which button* the player presses, not by *how they pressed it*. That removes a whole category of input-disambiguation work — no more "was that a smash or a tilt" buffer-history classification, because the player tells you directly which they want.

The tradeoff: more buttons. The player has to learn a more complex button layout. But the engine's input-classification work is cut to nothing. For a project that values clarity over input-vocabulary economy, this is the right tradeoff.

**On shieldDepth as a float.**

This is the one analog field in the shape. On a controller, this comes from the trigger axis — most gamepad shoulder triggers report a float from 0.0 (released) to 1.0 (fully pulled). In Melee, light-shield (partial trigger) has different properties from hard-shield (fully pulled): bigger shield bubble, more knockback when hit, lighter shield damage. The depth is gameplay-meaningful.

On keyboard, depth is binary. Pressing X gives `shieldDepth = 1.0`; releasing gives `0.0`. Same boolean as `shield`, just expressed as a float. This means keyboard players default to "hard shield" — fine, since there's no way to express analog input from a key.

The redundancy with `shield` (boolean) is intentional. `shield` answers "is shield held at all?" (any depth > 0). `shieldDepth` answers "how hard?" Conditions that care only about presence read `shield`; conditions that care about depth read `shieldDepth`. Both fields are populated, both stay in sync. **Different consumers, same input.**

**What this change touched.** Two files. `keyboard.js` produces the new shape. The debug overlay's input display was updated to show all the new fields across three compact lines (sticks, attack buttons, defense). No other file changed — no condition, no effect, no system, no state data. The expansion was purely additive.

**What was deferred.** A gamepad listener. The Gamepad API itself isn't hard — poll `navigator.getGamepads()` once per frame, read the values — but gamepad-vs-keyboard introduces real input-source ambiguity (last-touched wins? always-prefer rules? merge?), analog calibration (dead zones, drift, per-controller variation), and condition rewrites for analog input (what counts as "slammed" on a stick that can rest at 0.05 due to drift?). None of those are unsolvable. They're real problems that take design time. The right time to wire the gamepad is when there's a player who wants to use one — which is usually after attacks exist, because the c-stick is a smash-attack stick and useless until smash attacks exist. The architecture is ready; the implementation can wait.

---

### The history panel

The first expansion of the overlay was a 20-frame history panel. The goal: see what just happened in the last 20 frames, in one glance, without paging through the input buffer or replaying the scene.

**The data flow.**

A new field on `overlayState`: `frameHistory`, an array. Every frame, `pushFrameHistory(world)` captures a compact snapshot of the world state and unshifts it onto the front of the array. The array is trimmed to `HISTORY_FRAMES` entries (20). The newest snapshot is always at index 0.

The push happens **unconditionally** — even when the overlay is hidden. This is a deliberate choice: it means turning the overlay on after seeing weird behavior shows the preceding frames including the ones from while the overlay was off. The alternative (push only when enabled) would reset the history every time you toggled, which defeats the "I just saw something, let me inspect what happened" workflow.

The snapshot captured per frame includes: frame number, state name, state frame, position (x, y), velocity (vx, vy), grounded, facing, air jumps used/max, and every field from the input snapshot. That's a lot of data — but the panel is designed to show all of it, at small font.

**The rendering.**

The panel sits along the right side of the canvas (anchored at x=470, top=8). It draws a header row labeling each column, then 20 data rows below it. The newest row (index 0) is rendered in yellow as a visual anchor; the rest is in lighter gray. Font is 8px monospace for the rows, 9px monospace for the header. Each row is one line of formatted, fixed-width text.

Format choices that matter:

**Monospace font.** Critical. Without it, the column widths would jitter with each frame's data and the table would be unreadable. Monospace at 8px is right at the edge of readable on a standard display — the user explicitly accepted that tradeoff in exchange for fitting all columns horizontally.

**Fixed-width number formatting.** Every numeric value is padded to a known character count. `fmt1(x, 6)` gives "1234.5" or " 999.0" or "-100.0" — always six characters. The decimal points line up across rows.

**Compact symbols for booleans and small integers.** Grounded is `Y` or `.` (not `true`/`false`). Facing is `R` or `L`. Stick axes show as `+1` / ` 0` / `-1` (signed, padded). Buttons are `1` or `0`. The denser representation is what makes 24 columns fit in a screen-readable panel.

**Translucent background.** The panel sits over the right side of the playable area. The translucent black background keeps the table readable while letting the player see the game through it. If a fighter walks into the panel's territory, they're visible behind the rows.

**What this panel makes visible.**

Buffer-style debugging suddenly becomes a glance. When `stickSlammed` doesn't fire as you expected, you can look at the `Sx` column across the last few rows and see whether the rising edge actually happened. When a transition timing feels off, you can look at the state name column across the last few rows and see exactly which frame each state ended. When fast-fall doesn't engage, you can see whether `Sy` and `vy` lined up at the right moment.

This is what the live-stats panel could never do alone — it shows *now*, not *recently*. The history is what makes the live stats trustworthy: you can verify that `now` was the natural successor to `then`.

---

### The color editor

The second expansion turned the overlay into a real authoring tool. The goal: every state has its own color, and you can tune any state's color in real time without touching source code.

**The two halves.**

The change came in two coupled halves. The first was a data change: every state in `states.js` now declares its own `render.color`. Before this change, states without a `render` block fell back to the character's default color (red, `#dd5555`). Now every state authors its own color, so the character's default is never reached. This makes the colors **all in one location**, which is what makes the editor's "list every state with its color" view meaningful.

The starting palette is a coherent family — red tones for grounded-rest states (Idle, Walk, Squat, Land), orange tones for the dash family (Dash, DashBack, Run, DashStop), warmer or darker reds for airborne states (Fall, AirJump, FastFall), and a hint-of-orange for JumpSquat (which represents jump preparation). The palette is hand-tuned to keep families related but distinguishable.

The second half was the editor itself: a panel below the live stats that shows every state's color, lets you select one for editing, and provides H/S/L sliders to tune it.

**The data model.**

Two new pieces of overlay meta-state:

- `selectedColorState`: the name of the state currently being edited, or null.
- `activeSliderDrag`: when the user is dragging a slider, this holds `{stateName, channel, max, trackX}` — the metadata needed to translate mouse motion into a value change.

When `selectedColorState` is set, the slider widget appears. When `activeSliderDrag` is set, mousemove events update the value. When the user releases the mouse, `activeSliderDrag` is cleared. Three pieces of state, three lifecycles.

**The interaction loop.**

The overlay's `init` function attaches mouse listeners to the canvas — mousedown, mousemove, mouseup. The handlers convert window-relative mouse coordinates to canvas-relative coordinates via `getBoundingClientRect`, then pass those to the color editor module.

The color editor does hit-testing manually: it knows its own panel position, knows where each state row sits, and knows where the slider thumbs are. On a mousedown, it walks through the rows in order, checks if the click hit any of them, sets `selectedColorState` if so. Then it checks the sliders (only if a state is already selected). If a slider is hit, it sets `activeSliderDrag` and applies the click's x-position as the new value immediately (so a single click on the slider track jumps the thumb there, without requiring a drag).

On mousemove, if there's an active drag, the new mouse x is converted to a value via `(canvasX - trackX) / SLIDER_TRACK_WIDTH`, clamped to [0, 1], multiplied by the channel's max, rounded to an integer. The value is then written into the channel of the current HSL representation of the state's color, and the result is converted back to hex and stored as `world.states[name].render.color`.

This last step is the architectural decision worth pinning down: **the editor mutates `world.states[name].render.color` directly.** That's a mutation of state-definition data, which is supposed to be authored once and read-only at runtime. The deliberate choice: color is a presentation property, not a gameplay property — no condition or system reads it, only the renderer. So mutating it during play doesn't affect determinism, doesn't change behavior, doesn't break replays (if we had them). It's the same category of action as a hypothetical "force fighter into state X" dev tool — useful, deliberate, scoped to development.

**The color conversion.**

H/S/L is the editing model because it maps naturally to how a designer thinks about color: "make it slightly darker" is a Lightness change; "shift it toward orange" is a Hue change. The state definition stores hex, so the editor converts hex → HSL when displaying sliders and HSL → hex when writing back.

The conversion functions live in `format.js` alongside the other formatting helpers. They're pure functions of their inputs, return new values, hold no state. The same module exports `fmt`, `signed`, `bit` (the formatting helpers used across all three panels) and the color conversion pair.

**Persistence.**

The editor's changes are runtime-only. They live in memory; they don't save to disk. If you tune a state's color and refresh the page, the original `states.js` value comes back. To make a tuning persistent, you read the hex from the editor and edit `states.js` by hand.

This was a deliberate scope decision. Building a "save palette" feature would require either DOM-level file APIs (which the engine doesn't otherwise use) or a server endpoint (which the engine doesn't have). The simpler model — tune in-engine, copy out by hand if you like it — fits the rest of the project's static-data philosophy.

**The slider precision tradeoff.**

The slider tracks are 140 pixels wide. For H (range 0-360), each pixel of drag covers about 2.6 degrees of hue. For S and L (range 0-100), each pixel covers about 0.7 of a unit. That means H is harder to fine-tune than S or L — sometimes you have to drag, release, look at the hex, drag again. The alternative was a wider panel (more pixels, finer control) or a non-slider input (numeric input field, scroll-wheel adjustment). The current design favors compactness; precision is acceptable for exploration but not exact.

---

### The file structure

The overlay grew from two files to six during these expansions. The split:

```
src/debug/
  overlayState.js    Shared meta-state (flag, history, selection, drag).
  format.js          Formatting helpers + color conversion.
  liveStats.js       The original per-frame panel (top-left).
  history.js         The 20-frame history panel (right side).
  colorEditor.js     The color editor panel (below live stats).
  overlay.js         Entry point: wires keyboard + mouse, dispatches panels.
```

This split was deliberate. It would have been possible to keep everything in `overlay.js` — the entire overlay is ~500 lines combined, which is small enough to live in one file. The reason to split: each panel is a separate concern. The live stats panel knows nothing about the history panel; the history panel knows nothing about the color editor. Each module owns its own constants, its own draw functions, its own hit-testing. Adding a new panel later (a transition log, a hitbox visualizer, a frame-stepping freeze mode) means adding a new file — not modifying an existing 500-line one.

The entry point `overlay.js` is just orchestration. It imports the panels, wires up event listeners, and calls each panel's draw function during render. About 80 lines. Easy to scan; easy to add to.

`format.js` was extracted because it's shared. The live stats panel uses `fmt` and `signed` and `bit`. The history panel uses `fmt1` and `signed` and `bit`. The color editor uses `hexToHSL` and `hslToHex`. Putting them in one shared module avoids each panel re-implementing them, and avoids circular imports between panels.

`overlayState.js` is the single source of truth for all overlay meta-state. Every panel imports from it. No panel holds its own state.

---

### What's load-bearing

A few choices in this phase will matter as the engine grows.

**The overlay is a pure function of state, plus mouse-driven mutations.** The history is built from per-frame snapshots; the live stats are derived from the current World; the color editor reads from `world.states[name].render.color`. The mouse handlers are the only writes, and they only touch presentation data (color) or meta-state. No game logic is affected by anything the overlay does.

**Mouse input is canvas-local, separate from gameplay input.** The mousedown/mousemove/mouseup listeners are attached to the canvas (or to the window for mouseup), use `getBoundingClientRect` for coordinate conversion, and never touch the input buffer or game state. Same architectural principle as the keyboard toggle: meta-tools have meta-input.

**Color is per-state, never per-fighter.** This is the choice from Phase 6, reaffirmed by the color editor: a state declares its color, and any fighter in that state renders in that color. Future per-character color schemes would need a different mechanism (a character-stat color palette that the renderer combines with the state's color), but for today, the model is: one fighter, many states, one color per state.

**History is always recorded, even when hidden.** This costs about 12 KB of memory (20 snapshots of ~50 numbers each) — negligible. The behavior it enables (retroactive inspection) is exactly what frame history is for.

**The overlay is in its own folder.** This keeps `render/` for game rendering and `debug/` for developer rendering. Two different audiences (player vs developer), two different rendering standards (clean visuals vs dense information), two folders. When hitboxes eventually need to be drawn during development, they go in a new `debug/hitboxes.js` file — not in `renderer.js`.

**Per-panel state lives on `overlayState`, not on the panels.** This is what makes the overlay reload-friendly and audit-friendly: every piece of mutable state has one home. If the history were on `history.js` as a module variable, it would still work, but the convention of "all overlay state in overlayState.js" would erode. Keeping it centralized makes the architecture inspectable.

---

### What this unlocks

The Phase 10 architecture has obvious expansion paths.

**Sub-toggles for sub-panels.** Right now, backtick toggles the whole overlay on or off. As more panels are added, you'll want per-panel toggles — a key to show/hide just the history, a key to show/hide just the color editor. Each addition is one new field on `overlayState` and one new keydown handler in `overlay.js`. The pattern is already there.

**Game-space visualization.** The overlay currently only draws in screen space. Adding game-space drawings means new functions called during the main render path. A velocity vector emanating from the fighter, a ghost of the previous frame's position, the swept collision path, a grounded indicator at the fighter's feet — all of these are screen-space-and-world-space hybrid drawings. They belong in a new `debug/worldOverlay.js` module called during `render(world, ctx)`, not during `drawOverlay(world, ctx)`. The `overlayState.enabled` flag gates them; everything else is just more drawing.

**Hitbox visualization.** When combat phases arrive, hitboxes will be the most important debug visualization in the engine. The pattern follows directly from the color editor: hitboxes are state data (declared on a state's `physics` modifier), the overlay reads them, draws translucent shapes in game space. The system that performs hit detection reads the same data. The overlay's job is just to visualize what already exists.

**A freeze-frame / single-step mode.** Press a key, the game pauses. Press another, single-step one tick. The main.js loop checks `overlayState.paused` and skips the tick call when true. The overlay shows a "PAUSED" indicator. Single-stepping calls `tick()` directly once and re-renders. The architecture supports this — the loop already separates ticking from rendering, so suppressing the tick is one conditional.

**Per-state authoring beyond color.** The color editor sets the precedent that state data can be edited interactively. The same UI shape could expose any state property: gravity multiplier, friction multiplier, fall-speed cap, duration. A "tune state physics" panel would have the same architecture (state list with current values, sliders to adjust). The mutations would change game behavior — different from color editing — but the substrate handles it the same way.

**Replay history.** The 20-frame history is the foundation of a replay system. If you increase the history to thousands of frames, capture also the input snapshots used, and add a "rewind" mode that tics from a saved World forward with recorded inputs, you have a replay tool. The architecture wouldn't fight that; the data is already there in compact form. Combat phases will benefit from this enormously.

---

### Where Phase 10 leaves the engine

A complete, expressive movement system with twelve states. A multi-panel debug overlay that exposes nearly every aspect of the engine's runtime. Per-state color authoring that lets you tune the visual identity of every state from inside the running game. An expanded input contract ready for both combat states and gamepad listening.

The substrate stays small. The state machine interpreter is unchanged since Phase 5. The physics primitives have had two additions across Phases 7 and 8 (asymmetric cap, terminal velocity) and are otherwise unchanged. The collision primitives have had a structural shift in Phase 8 (solids vs platforms split, snap-only-perpendicular rule) and one tiny expansion in Phase 9 (the `wantsThroughPlatforms` predicate). Nothing has needed to be rewritten. Each phase has added; none has restructured.

The next phases will introduce combat. The patterns are all in place: state data declares physics modifiers (including hitbox/hurtbox shape, vulnerable flags, etc.); systems read state data uniformly; effects mutate fighter fields at transition moments; the overlay visualizes everything the engine knows about. Every load-bearing piece of the substrate has been exercised by movement and is ready to carry combat without buckling.
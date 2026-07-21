# calileiGame.md

## A Platform Fighter Built on Emergence

This document is a retrospective and a reference. It describes what was built, why it was built that way, and how the pieces fit together as they currently exist. It is meant for the next person to touch the codebase — whether that's the original author returning months later, a new collaborator coming in fresh, or a future port to a different language and platform.

---

## 1. The Vision

The project is a 2D platform fighter in the spirit of *Super Smash Bros. Melee* — not a clone, but a study of what made Melee feel the way it did. The goal is to recreate the conditions under which deep, competitive, emergent gameplay can arise, by getting the underlying engine right before any character, move, or combat system is designed.

The first milestone was deliberately small: **one stage (a Battlefield-style layout with three soft platforms and a main floor), one fully realized fighter, and a complete movement system.** No attacks, no hitboxes, no damage — just a character that can move with the expressiveness of a platform fighter, and an engine general enough that attacks, projectiles, additional characters, and advanced techniques could be layered on top later without changing the foundation. That milestone is complete, and the layering-on-top has begun.

What this document captures is the engine after thirteen phases of work — ten of movement, three of combat (Phase 13 is half-shipped; its second half, 13b, is pending). The character can idle, walk, dash, run, dash-stop, dash-back, jump (with adjustable height via the jump-squat exit), double-jump, fall, fast-fall (with a tunable commit window), crouch, drop through platforms (with a tap-to-drop window that doesn't auto-commit to fast-fall), slide along walls, and air-dodge on a committed trajectory. Dash-dancing, walk-off-edge into momentum-preserving fall, jump-cancel-walking, edge-cancel-landing, wavedashing, and wavelanding all emerge from primitive interactions without being explicitly coded.

On top of the movement substrate sits the first combat loop: a ten-move light-attack family (jab, three ground tilts, dash attack, five aerials), hurtboxes, a hit-detection stage, a Melee-faithful knockback formula, damage accumulation, and dynamic hitstun — exercised against a second fighter spawned as a dummy target. Attack → damage → stronger knockback → longer flight: the core loop of a fighting game exists.

The engine also now runs in two places: standalone (this repo, open `index.html`) and embedded in the Calilei site as a desktop-window file type. The embed vendors this repo's `src/` byte-identical and composes it from the outside; nothing in the engine changed to support it. See §6's "Where it runs" and §8.16.

---

## 2. The Inspiration: Why Melee

Most fighting games are **animation-driven**. An animator decides a move takes 30 frames, the hitbox is active on frames 8 through 12, and the character's position is whatever the animation dictates.

Melee is closer to **physics-driven**. Every character is a point mass moving through a 2D plane with velocity, gravity, friction, and momentum. Animations are layered on top of states, but the physics keep running underneath. This single architectural decision is the source of everything else interesting about the game.

When a Melee player wavedashes, they are not executing a special move. They are air-dodging into the ground at an angle, while horizontal momentum is preserved across the state transition, and the landing state cancels the air-dodge animation. Nobody designed wavedashing. The developers designed air dodges, ground collision, and momentum preservation — and wavedashing fell out as a consequence.

The same is true of dash dancing, L-cancelling, platform cancelling, edge cancelling, moonwalking, and dozens of other techniques that define competitive Melee. None of them were features. All of them were consequences.

This is the goal the project is designed toward: **an engine general enough that techniques nobody imagined will emerge from the interaction of primitive rules.** It is not a list of features. It is a substrate.

---

## 3. Design Philosophy

These are not opinions. They are the foundation of why the project exists, and the discipline that produced the current shape of the codebase.

### 3.1 Physics-first, not animation-first

Position is determined by velocity. Velocity is determined by state-permitted forces. Animations (when they exist) are visual representations of states, not the authority on where a character is. This is what allows momentum to carry across state transitions, which is what makes emergent techniques possible.

In the current engine, this principle shows up in concrete ways:

- Walking off the edge of a platform produces a fall that preserves walking velocity. No code says "carry velocity into the fall" — the velocity is already in the fighter, the new state doesn't zero it, the next frame's physics integrates it.
- Dashing off the edge of a platform produces an aerial dash arc, because the dash velocity (2.8 px/frame) is above the air-drift cap (2.0 px/frame), and the air-drift system was carefully designed to NOT yank velocity back when it's above the cap.
- Jump-cancelling out of Walk lands you in JumpSquat with vx preserved, then in Fall mid-air with vx preserved, then back on the ground with vx still preserved unless friction takes it.
- A hit doesn't move anyone directly. `applyHitReaction` writes a launch velocity and physics integrates it, which is why knockback, gravity, and air drift compose into combo trajectories instead of canned launch animations.

### 3.2 Single source of truth

There is exactly one object that holds mutable game state: the **World**. Every value that matters across frames lives on the World. Nothing else stores game state — not the renderer, not the input handler, not any system. If a value can be derived from the World, it is derived fresh each frame and never cached.

The keyboard module is the one exception, and it's principled — it holds OS-level keyboard state, not game state. Game logic never sees inside it; it only sees the snapshots `getCurrentInput()` produces. Those snapshots cross the boundary into the game world through `inputSystem`, and from that point on, everything game-relevant is in the World. (The embedded build has its own held-keys Set in the site's `desktopGame.js`, playing exactly the same principled role — a second snapshot producer, same boundary, same contract. See §8.16.)

### 3.3 Decoupled logic

Each module knows only what it must know to do its job. Physics operates on bodies (`{x, y, vx, vy, grounded}`), not fighters. Collision operates on line segments and rectangles, not stages. The state machine operates on state definitions, not on the specific states a fighter happens to use. Dependencies flow strictly downward — from `main.js` through systems to core primitives — and never sideways or upward.

This shows up in the import graph: every file in `core/` could be lifted out and reused in a completely different game without modification. Every file in `systems/` reads and writes the World using primitives from `core/`. No system imports another system.

### 3.4 Data over code

Anything tunable is data, not code. Character stats are JSON-shaped JS objects. State definitions are JSON-shaped objects. Stage geometry is JSON-shaped. Code is the engine that interprets data; data is what gets edited when balancing or expanding the game.

There is no `if (character === 'fighterA') { ... }` anywhere in the codebase. Adding a new character is one file in `data/characters/`. Adding a new state is one entry in `states.js`. Adding a new condition or effect is one entry in the appropriate registry.

### 3.5 Modularity through composition

`main.js` is the only file that knows about every other file. It composes the engine by importing modules and wiring them together. Every other file exports primitives — pure functions, factory functions, data objects — and imports only what it directly depends on. The shape of the import graph is a tree, not a web.

### 3.6 Build the substrate, not the feature

This is the principle that distinguishes this codebase from a typical platform fighter project. When a new technique or behavior is desired, the first question is whether the primitives that would produce it already exist. If they do, the technique is data, not code. If they don't, the primitives are generalized.

Wavedashing should not exist as a function called `wavedash()`. It should exist because air dodges, ground collision, and momentum preservation all already exist and compose to produce it. The discipline of refusing to write code that special-cases a technique is what keeps the engine emergent.

### 3.7 Determinism is a habit, not a feature

No `Math.random()` in game logic. No `Date.now()` or `performance.now()` inside `tick`. Game logic counts frames, not milliseconds. Numeric operations route through `fixedMath` so a future swap to integer math (for bit-exact replays or rollback netcode) doesn't require touching every callsite.

The fixed-timestep accumulator in the composition root — the standalone build's `main.js`, or the site's `desktopGame.js` when embedded — is the boundary: it converts wall-clock time into a count of ticks, and from that point on, nothing in the game world reads time directly. The same World plus the same inputs produces the same next World, every time, in either host.

### 3.8 Logic reads as portable conditionals

The codebase is written with a future port in mind — to Unreal C++ or Blueprints. Game logic reads as plain conditionals: `if (input.jumpPressed && state.canCancel) transitionTo('JumpSquat')`. JavaScript idioms that wouldn't translate cleanly — closures over loops in hot paths, dynamic property lookup in hot paths, prototype-chain tricks — stay out of game logic. They're acceptable in `main.js` and the rendering layer; they're avoided everywhere else.

---

## 4. Architectural Philosophy

These are the rules the codebase is built on. They are how the project actually behaves, not aspirations.

**One World, one tick, one source of truth.** All mutable state lives on the `World` object. Nothing else stores state across frames.

**`tick(world, inputsByFighter) → world` is the game.** Every other function exists to serve, observe, or set up that call. Rendering reads the World. Input handlers capture keystrokes and hand them in — one snapshot per fighter, positionally indexed. The game loop calls tick 60 times per second. The architecture has no other shape.

**A state is data, not a module.** When a new action state is added — Idle, Walk, Dash, Squat, LightNeutralAir, Hitstun — an entry is added to a data file. No `idle.js`, `walk.js`, `dash.js` files exist. The state machine in `core/stateMachine.js` is a generic interpreter; states are configurations it interprets.

**Core knows nothing about the game.** `physics.js` operates on bodies, not fighters. `collision.js` operates on line segments and rectangles, not stages. `stateMachine.js` operates on state definitions, not on the specific states a fighter uses. If `core/` ever imports from `data/` or `systems/`, the layering is broken.

**Decoupled by default.** Systems communicate by reading and writing the World. They do not call into each other. The state system never imports the physics system; both read the same World, both write their own fields, the order in `tick.js` determines who sees what.

**Easy to add, easy to delete.** A new character is one file. A new state is one entry. A new system is one file plus one line in `tick.js`. The drop-through feature in Phase 9 was implemented by adding twelve lines to `collisionSystem.js` and no other changes. If adding something requires touching five files, the architecture has leaked.

**Load-bearing infrastructure has a high bar for change.** When the temptation arises to edit a shared primitive — the state machine, the physics integrator, the collision resolver — to support a specific feature, the question is: *would this change still be in the codebase if the specific feature were deleted?* If the answer is "no, it'd be deleted with it," the change belongs in the feature's data file, not in the primitive.

---

## 5. The Core Idea, In One Line

> **The game is a function: `tick(world, inputsByFighter) → world`.**

The World is the noun: a snapshot of everything that exists right now — the stage, the fighters, the frame counter, the state definitions, any active interactions.

Tick is the verb: the function that transforms one World into the next World given the inputs that occurred this frame.

Everything else is plumbing. Rendering reads the World but never writes to it. Input handlers capture keystrokes but don't change game state — they hand inputs to tick, which decides what those inputs mean. Loading, drawing, listening, looping — all of it is scaffolding around that one core function.

If the architecture is right, the following are all possible without any work:

- Serialize the World to JSON, reload it later, and resume the exact same game.
- Replay a match by re-running tick with the same initial World and recorded inputs.
- Run the game headless (no renderer) by just calling tick in a loop.
- Swap the renderer entirely — Canvas to Three.js to Unreal — without touching tick.
- Host the whole game inside a different page, a different loop, a different input source — without touching anything.

These are not implemented as features. They are simply not blocked by the architecture. The last one has since been cashed in: the Calilei site's embedded build (§8.16) is exactly "a different composition root calls the same tick," and it required zero engine changes.

---

## 6. The Tech Stack

**Vanilla JavaScript. No build step. No framework.** The entire project runs by opening `index.html` in a browser. There is no transpilation, no bundler, no package manager required for the engine itself. Refresh the page to see changes.

**HTML5 Canvas 2D for rendering.** Canvas is immediate-mode — every frame, the canvas is cleared and redrawn entirely from the current World. This matches the architecture exactly: the renderer is a pure function of state, holds no references, caches nothing. A DOM-based renderer would create a second source of truth that could drift from the World; Canvas does not.

**ES modules.** Each file is a module with explicit imports and exports. `main.js` is loaded with `<script type="module">`. This gives file-by-file modularity without any build tooling.

**Fixed timestep, 60Hz.** The game loop runs at locked 60 frames per second, regardless of display refresh rate. A 144Hz monitor renders the same game at 60 ticks per second, just sampled more often for display. A 30Hz device falls behind one tick per display frame and catches up via the accumulator. The "spiral of death" — where a slow tick causes catch-up ticks that are also slow — is prevented by a `MAX_PENDING_FRAMES` cap that drops accumulated time rather than freezing the page.

**Determinism-friendly habits from day one.** No `Math.random()`. No reading wall-clock time in `tick`. All numeric operations go through `fixedMath` helpers. Float math is used today, but every operation is a function call rather than an inline operator, so swapping to fixed-point arithmetic later doesn't require touching every callsite.

### 6.1 Where it runs: two composition roots

The engine has no main of its own — `src/**` exports primitives, and a composition root assembles them. There are now two.

**Standalone (this repo).** `index.html` + `main.js`. main.js creates the World, spawns the fighters, owns the fixed-timestep accumulator, samples the keyboard, calls tick and render, and draws the debug overlay. Open the page, play the game. This is the development surface.

**Embedded (the Calilei site).** The site vendors a byte-identical copy of `src/` and hosts the game as a desktop-window file type — `desktopGame.js` in the site repo — which plays main.js's role inside a window the site's desktop panel owns: same World creation, same accumulator constants, same tick and render calls. On top of that it adds site-shaped behavior the engine knows nothing about: the game runs only while its window surface holds DOM focus (pause on blur, minimize, or scrolling the desktop away), and a paired inspector window replaces the debug overlay's text panels with live DOM.

**The vendor rule.** The embedded copy is synced by dumb-copying `src/` from this repo, and is **never edited site-side**. Anything embed-shaped lives in the site's `desktopGame.js`. This repo is the only place engine code changes. The full embed contract — what the site imports, what it deliberately doesn't, and what engine work must respect to keep the embed working — is §8.16.

---

## 7. The Phases (As Built)

The project has been built in phases, each with a verifiable result, each depending on the previous. The phases as originally planned and the phases as built diverged in places — what follows is what actually happened.

### Phase 1: The Empty Loop

A canvas was rendered with a fixed-timestep accumulator at 60Hz and a spiral-of-death cap. `tick(world, inputs)` was called and mutated the World in place. Six files: `index.html`, `styles.css`, `main.js`, `world/world.js`, `world/tick.js`, `render/renderer.js`. Nothing visible on the screen except a dark canvas.

The conventions that locked in here: 960×540 canvas, Y-down coordinate system, the `tick(world, inputs)` signature, World mutation rather than replacement. Three of the four still hold exactly; the signature widened once, in Phase 13, to `tick(world, inputsByFighter)` when a second fighter needed its own input stream.

### Phase 2: The Stage

A pure-data Battlefield was added: `data/stages/battlefield.js`. Originally a list of platforms with `{x1, y1, x2, y2, dropThrough}` shape. The renderer drew them as white lines. This file would be restructured significantly in Phase 8.

### Phase 3: Physics and Collision Primitives

Five new files: `core/fixedMath.js` (numeric helpers), `core/physics.js` (gravity, friction, integration), `core/collision.js` (sweep tests), `entities/fighter.js` (the fighter shape), and `data/characters/fighterA.js` (default stats). Two new systems: `physicsSystem.js` and `collisionSystem.js`. A fighter was spawned, fell, hit the floor, and stopped. The body shape was committed: 30px wide, 60px tall, anchored at bottom-center (feet at `fighter.y`).

### Phase 4: Input

Three new files: `input/keyboard.js`, `core/inputBuffer.js`, `systems/inputSystem.js`. The input buffer was implemented as a rolling array of snapshots, `buf[0]` being the freshest. Window-level keydown/keyup listeners maintained a held-keys Set; `getCurrentInput()` built a fresh snapshot on every call. The snapshot shape was "gamepad-flavored" so a future gamepad module could produce the same shape, and it claimed its slots up front — sticks, c-stick (zeroed until a producer exists), six buttons, analog shield depth. That up-front claim paid off in Phase 12: every input slot combat needed was already in the contract.

The console hook `window.world = world` was added here, making the World inspectable from DevTools.

### Phase 5: The State Machine

The substantial phase. Five new files: `core/stateMachine.js` (generic interpreter), `core/conditions.js` (registry of named transition conditions), `core/effects.js` (registry of named transition effects), `data/states/states.js` (the state definitions), `systems/stateSystem.js` (per-frame state evaluation).

Five states were defined: Idle, Walk, JumpSquat (3-frame), Fall, Land (4-frame). The tick order was finalized as **input → state → physics → collision**, and that order has not changed since. A critical off-by-one was fixed in `durationElapsed`: the check is `stateFrame + 1 >= duration`, guarded by `duration > 0`, so duration counts the number of frames the state is active, not an upper-bound on `stateFrame`.

Emergences observed here: walking off an edge automatically falls (via `notGrounded` priority in Walk's transitions), landing with held direction transitions through Land to Walk, jump-cancel-walking preserves vx because the JumpSquat's physics modifier doesn't apply friction.

### Phase 6: Squat and Double Jump

Two new states: Squat (with friction:1.0 and horizontalMode:'none') and AirJump (a dedicated state, not a re-entered Fall — preferred for clarity over reuse). New conditions: `crouchInput`, `notCrouchInput`, `canAirJump` (a compound check using `wasPressedWithin('jump', 3)` and `airJumpsUsed < maxAirJumps`). New effect: `applyAirJumpImpulse` (overwrites vy and increments counter) and `resetAirJumps` (fires on Fall|AirJump → Land).

A bug was caught and fixed: `canAirJump` initially used the same 5-frame window as `jumpPressed`, which meant the original ground-jump press would auto-promote to an air-jump on the very first Fall frame. The fix was to use a separate, shorter `AIRJUMP_BUFFER_FRAMES = 3` constant for `canAirJump`.

The renderer learned to read `state.render.color` to support per-state color overrides.

### Phase 7: The Dash Family

Four new states: Dash (10-frame committed burst), DashBack (explicit separate state for the user's preference of clarity), Run (sustained after Dash ends), DashStop (4-frame brake). A new horizontal mode `'dash'` was added that ignores `stickX` and reads `fighter.facing * dashSpeed` — direction is committed via effects (`commitFacingFromSlam`), not stickX-tracked.

New conditions: `stickSlammed` (rising edge from neutral to non-zero), `stickReverseFromFacing` (sign(stickX) === -facing).

A critical physics primitive was added: when `addHorizontalVelocity` is called with vx already above the cap, the cap behavior is asymmetric. Same-direction accel past the cap is a no-op (you don't keep accelerating outward), but opposite-direction accel applies normally (you can always decelerate). This is what makes dash-off-edge preserve dash speed into the air rather than yanking the fighter back to the air-drift cap.

### Phase 8: Walls, Fast Fall, and the Stage Restructure

The stage was restructured significantly. The old "platforms with `dropThrough`" model was replaced with two collections: `solids` (axis-aligned rectangles, collide on all four sides) and `platforms` (one-way horizontal lines). Battlefield's main floor became a solid rectangle reaching down to the blast zone; the three soft platforms became one-way lines.

A new collision primitive was added: `sweepPointIntoSolid`, returning `{x, y, side: 'top'|'bottom'|'left'|'right'}`. The response system in `collisionSystem.js` learned per-side behaviors: top hit lands, bottom hit head-bumps, left/right hit walls. A subtle but important fix landed: the snap was changed to **only snap the perpendicular axis**, so a fighter sliding down a wall doesn't get pinned at the y of first contact. The same rule applies to platform tops (snap y, leave x alone) so corner landings preserve horizontal motion.

Fast fall was added: state `FastFall` with `gravity: 0` (constant velocity), and a transition from Fall/AirJump on `fastFallTriggered`. The condition originally checked `stickY > 0 AND vy >= 0` — the second clause is what makes fast-fall a commit at apex rather than a mid-ascent option. Terminal velocity was added: `fallSpeedMax: 6.0` on Fall and AirJump, `fallSpeedMax: 9.0` on FastFall.

### Phase 9: Drop-Through

A single feature with a single rule: a fighter passes through soft platforms whenever `stickY > 0`, unless the current state opts out via `physics.respectPlatforms: true`. The rule is applied at two collision sites:

- The platform sweep skips entirely for ignoring fighters (so falling onto a platform from above with down held passes through).
- The still-on-surface check treats platforms as non-surfaces for ignoring fighters (so standing on a platform with down held un-grounds the fighter).

This was twelve lines added to `collisionSystem.js` and zero changes anywhere else. The `respectPlatforms` flag was placed on state data rather than the fighter — state-level placement is the right home for "what the fighter is currently doing"; fighter-level would be the right home for "what's true about the fighter independent of action." Drop-through respect is action-shaped (an attack should suppress it; the character itself shouldn't).

A second sub-change was made on the same phase: `fastFallTriggered` was rewritten to distinguish a "fresh press" (a recent neutral in the input buffer) from a "sustained hold" (no neutral for N consecutive frames). The split gives the player a tap-down window where they can drop through a platform without also committing to fast-fall. Two constants control the windows: `FAST_FALL_FRESH_WINDOW = 3` and `FAST_FALL_COMMIT_FRAMES = 6`. The result is: a 2-5 frame tap drops the fighter through without fast-fall; a 6+ frame hold also fast-falls.

### Phase 10: The Debug Overlay

Phase 10 added in-engine visibility without changing any gameplay. The engine ticks identically with the overlay enabled, disabled, or with the user dragging sliders around inside it. What this phase added is observability and, in the expansions authored during the same session, interactive authoring — see what the engine is doing every frame, watch state propagate across recent history, and tune visual properties in real time without editing source files.

The **press-to-record history panel** lives on the right side of the canvas. Pressing backslash (`\`) starts a 20-frame capture: each frame, `recordFrameIfRecording(world)` pushes a compact snapshot — frame number, state, state frame, position, velocity, grounded, facing, air jumps, and every input field — into `overlayState.recordedHistory`. When 20 frames have been captured, recording stops and the data freezes for inspection. Pressing backslash again discards the current capture and starts a fresh one from that moment. A status line at the top of the panel shows the current state: a gray hint when no recording exists yet, a red "● RECORDING N/20" while filling, a green "✓ captured" confirmation once complete. The recording survives overlay toggle-off and toggle-on, so the workflow "record → hide overlay to keep playing → reshow to inspect" works. The press-to-record model replaced an earlier continuous-history design — the continuous version was unreadable because every row shifted every frame, making analysis impossible. A frozen snapshot you can study at leisure is the actually useful tool. The font is 8px monospace to fit all columns in one row each; the user explicitly accepted that tradeoff in exchange for completeness.

The **color editor** sits below the live-stats panel. It lists every state with a swatch and hex code; clicking a state's row selects it; H/S/L sliders appear and let you tune the color in real time. Dragging a slider mutates `world.states[name].render.color` directly. This is the first piece of the overlay that mutates the World — but the mutation is scoped to presentation data (only the renderer reads color, no condition or system does), so it doesn't affect gameplay or determinism. Changes are runtime-only and don't persist across page reloads; if you tune a color you want to keep, you copy the hex from the overlay into `states.js` by hand. The slider widget uses canvas-drawn UI with mouse hit-testing — mousedown/mousemove/mouseup listeners attached to the canvas, coordinates converted via `getBoundingClientRect`. The mouse handlers are separate from the gameplay input pipeline, matching the same "meta-tools have meta-input" principle as the keyboard toggle and the record key.

The color editor's existence prompted a coupled data change: every state in `states.js` now declares its own `render: { color: '#xxxxxx' }`. Before, states without a color fell back to the character's default red. After, every state authors its own — so the colors are all in one location, which is what makes the editor's "list every state with its color" view meaningful. The starting palette is hand-tuned with family coherence (red tones for grounded-rest states, orange tones for the dash family, warmer reds for airborne, darker red for FastFall's commitment).

The final file layout in `src/debug/`:

- `overlayState.js` — shared meta-state (overlay flag, recorded history, recording progress, selected color state, drag state).
- `format.js` — formatting helpers (number padding, signed integers, bit display) and hex/HSL conversion.
- `liveStats.js` — the original per-frame panel.
- `history.js` — the press-to-record history panel plus `recordFrameIfRecording` and the trigger logic.
- `colorEditor.js` — the color editor panel and its mouse handlers.
- `overlay.js` — entry point that wires keyboard (toggle + record) and mouse listeners and dispatches to the panels.

Six files. The split is deliberate: each panel is a separate concern with its own constants, draw functions, and hit-testing. Adding future panels (a transition log, hitbox visualizer, freeze-frame mode) means adding new files, not modifying existing ones. The entry point is ~100 lines of orchestration.

Phase 10 didn't touch the state machine, the systems, the registries, the fighter shape, the World shape, or any of `core/`. It added six files in `src/debug/`, updated two fields in `keyboard.js`, added a render block to six states in `states.js`, and made three small changes to `main.js`. The substrate absorbed the entire expansion without protest — which is the validation the architecture was waiting for.

### Phase 11: Air-Dodge

One new airborne action: shield in the air enters a 20-frame committed-trajectory state — `gravity: 0`, `friction: 0`, `horizontalMode: 'none'`, with the entry effect `applyAirDodge` capturing the stick at the transition moment, normalizing the 2D vector (so cardinals and diagonals reach the same magnitude), and writing a locked velocity. That single addition unlocked wavedashing and wavelanding without either being named in code: air-dodge into the ground composes with the perpendicular-only snap and Land's friction physics to produce the slide.

The phase gave the state-level opt-out pattern its first real users — `respectPlatforms: true` on AirDodge (structural: it's what makes wavelanding *onto platforms* possible) and on Land (a feel decision: it widens the platform-stay window from a frame-perfect ~1 frame to a reactive ~5) — and added `intangible: true` on AirDodge as a placeholder awaiting a combat consumer. `resetAirJumps` broadened into the composite `resetAirActions`; `length2D` joined fixedMath as the meaningful operation (one future fixed-point swap site instead of scattered sqrt calls). The interpreter, physics, collision, and input systems were untouched. Full story: `phase11Retrospective.md`.

### Phase 12: The Light-Attack Substrate

Ten attack states across five sub-phases — jab, three ground tilts, dash attack, five aerials — the combat skeleton without the contact. The load-bearing data-shape decisions, made once on the first hitbox and propagated to all ten: hitboxes as a **list** (even at length 1), **center-anchored** geometry mirrored by facing at the consult site, and **inclusive `[first, last]`** active windows.

One new input primitive: `pressIndex`, which finds a press's rising edge in the buffer and lets conditions read the stick *at the frame of the press* rather than the frame the state machine evaluates — the substrate that makes directional attacks read the player's intent, and that smash-vs-tilt detection and DI will reuse. Mid-phase, attack tunables migrated off state-data onto `character.attacks[stateName]`: the state declares the action's shape, the character declares its tuning, and a missing character entry fails loudly rather than silently inheriting a "default" that has no semantic meaning.

The phase also *deleted* a latent Phase-4 bug: air mode was committing facing to stick direction every frame (a copy-paste from walk mode), which made back-airs unreachable. Removing one line restored Melee-canonical decoupled air facing — you can drift backward while facing forward. The bug had been inert for eight phases because no consumer cared until aerial back-attacks became the first thing to read air facing. No interpreter changes, no physics additions, no new tick stages: combat composed against the engine instead of reshaping it. Full story: `phase12Retrospective.md`.

### Phase 13a: Hit Detection

The phase that turned the skeleton into combat, in five verified steps: a **second fighter** (fighterB, a spread of fighterA spawned as a dummy and fed a frozen `NEUTRAL_SNAPSHOT`), **hurtboxes** (character-keyed, per-state with a `default` fallback — the first real consumer of `intangible`), the **`hitDetectionSystem`** (a fifth tick stage after collision — the engine's first cross-fighter system), **knockback** (`core/knockback.js`, a pure Melee-faithful launch formula, plus the `damage` percent accumulator and a universal `hitTaken` transition inserted first in every state), and **dynamic hitstun** (per-hit duration via the `pendingHitstunFrames` runtime field and a `hitstunFinished` condition).

The tick signature changed to `tick(world, inputsByFighter)` — a positional array, with input routing owned by the composition root and `inputSystem` reduced to a positional dispatcher. The step-1 discovery: the engine was already almost entirely N-fighter-clean; every system iterated fighters correctly from the day it was written. The core loop of a fighting game — attack → damage → stronger knockback → longer flight — now exists against the dummy. Hitlag, DI, and the array-of-effects interpreter extension are deferred to **Phase 13b**. Full story: `phase13Retrospective.md`.

### The port (alongside Phase 13a)

Between combat steps, the game stopped being only a standalone page: the Calilei site began embedding it as a desktop-window file type, vendoring `src/` byte-identical and composing it from a second root. Nothing in the engine changed to support this — which is the point, and the strongest validation yet of §5's claim that everything outside `tick` is plumbing. The overview is in §6; the contract is §8.16.

---

## 8. The Architecture (In Depth)

### 8.1 Folder Structure

```
/index.html                      single page with the canvas element
/styles.css                      dark background, canvas centered
/src
  main.js                        entry point, composition, game loop

  /core                          universal primitives, no game knowledge
    fixedMath.js                 numeric helpers, swap-ready for fixed-point
    stateMachine.js              generic FSM interpreter
    inputBuffer.js               rolling window of recent inputs; NEUTRAL_SNAPSHOT
    physics.js                   pure functions on bodies
    collision.js                 sweep tests (platform line, solid rect)
    knockback.js                 pure knockback-velocity computation (Phase 13)
    conditions.js                registry of named transition conditions
    effects.js                   registry of named transition effects

  /world                         the container that holds everything
    world.js                     createWorld, the World shape
    tick.js                      the per-frame orchestrator

  /entities                      things that exist in the World
    fighter.js                   createFighter factory, fighter shape

  /systems                       per-frame logic that operates on the World
    inputSystem.js               positional dispatch: inputsByFighter[i] → fighters[i]
    stateSystem.js               run state machine for each fighter
    physicsSystem.js             apply gravity, friction, integrate
    collisionSystem.js           resolve fighter vs stage
    hitDetectionSystem.js        resolve attacker hitboxes vs victim hurtboxes (Phase 13)

  /data                          pure data, no logic
    /states
      states.js                  all action states as one data object
    /characters
      fighterA.js                character config (body + stats + attacks + hurtboxes)
      fighterB.js                the Phase 13 dummy — a spread of fighterA
    /stages
      battlefield.js             solids and platforms

  /input                         raw input → normalized input events
    keyboard.js                  keyboard listeners, current snapshot

  /render                        isolated; reads World, never writes
    renderer.js                  draws World to canvas each frame

  /debug                         meta-tools, separate from gameplay
    overlay.js                   debug HUD entry point, own keyboard listener
    overlayState.js              shared meta-state for the overlay panels
    format.js                    number/hex formatting helpers
    liveStats.js                 per-frame stats panel
    history.js                   press-to-record history panel
    colorEditor.js               live state-color editor
    hitboxes.js                  world-space hitbox draw (Phase 12)
    hurtboxes.js                 world-space hurtbox draw (Phase 13)
```

31 files total. None larger than ~200 lines. Most are much smaller.

### 8.2 The Dependency Graph

```
main.js
  ├── world/world.js, world/tick.js
  ├── render/renderer.js
  ├── debug/overlay.js → debug/{overlayState, format, liveStats,
  │                              history, colorEditor, hitboxes, hurtboxes}.js
  ├── input/keyboard.js
  ├── data/stages/battlefield.js
  ├── data/characters/fighterA.js, fighterB.js
  ├── data/states/states.js
  ├── entities/fighter.js
  └── core/inputBuffer.js          (NEUTRAL_SNAPSHOT for the dummy)

tick.js
  ├── systems/inputSystem.js
  ├── systems/stateSystem.js → core/stateMachine.js
  ├── systems/physicsSystem.js → core/physics.js
  ├── systems/collisionSystem.js → core/collision.js
  └── systems/hitDetectionSystem.js   (no imports — helpers inline, see §8.12)

core/stateMachine.js → core/conditions.js, core/effects.js
core/conditions.js → core/inputBuffer.js, core/fixedMath.js
core/effects.js → core/fixedMath.js, core/inputBuffer.js, core/knockback.js
core/physics.js → core/fixedMath.js
core/collision.js → core/fixedMath.js
core/knockback.js → (no imports; pure)

data/characters/fighterB.js → fighterA.js   (a spread — the one data-to-data
                                             import; ends with Phase 14c)
data/* → (no other imports of logic; pure data)
```

Arrows point downward only. Nothing in `core` knows about `systems`. Nothing in `data` knows about anything (fighterB's spread of fighterA excepted, and that edge is scheduled to die when fighterB becomes a real character). `main.js` is the only file that touches every layer.

### 8.3 The World

The World is a flat data container. The current shape:

```js
{
  frame:    number,           // monotonic tick counter
  stage:    { solids, platforms, blastZones },
  states:   { Idle, Walk, ... },  // reference to state data
  fighters: [ Fighter, ... ],
}
```

`stage` is a reference to the loaded stage data. `states` is a reference to the state-definition data. These are placed on the World so systems don't need to import them directly — they read them through the World, which keeps system files agnostic about which stage or which state set is loaded.

`fighters` is an array. The current build has two: `fighters[0]` is the human-controlled fighter, `fighters[1]` is the Phase 13 dummy (fighterB, fed a frozen neutral snapshot). Which input source feeds which fighter is decided in the composition root, not here — the World doesn't know a dummy from a player. The array supports N without any changes; Phase 13's step-1 finding was that every system already iterated it correctly.

`frame` increments by 1 at the top of every `tick` call. It's used by the debug overlay and is available to game logic if needed (no code currently reads it for gameplay, by design — game logic should count `stateFrame`, not global frames).

### 8.4 The Fighter

A fighter is a flat collection of properties. No nested state, no internal classes hiding behavior. Each system reads whichever properties it needs.

```js
{
  x:               number,      // position, bottom-center anchor
  y:               number,
  vx:              number,      // velocity per frame
  vy:              number,
  grounded:        boolean,
  facing:          1 | -1,      // +1 = right, -1 = left
  actionState:     string,      // key into world.states
  stateFrame:      number,      // frames in current state, 0-indexed
  airJumpsUsed:    number,
  airDodgesUsed:   number,      // Phase 11
  pendingHit:      object|null, // Phase 13 — hit event awaiting consumption
  hitConnected:    Set,         // Phase 13 — victims this attack has already hit
  damage:          number,      // Phase 13 — the percent accumulator
  pendingHitstunFrames: number, // Phase 13 — Hitstun's dynamic duration
  inputBuffer:     [snapshot, snapshot, ...],
  config:          { name, body, physics, color, attacks, hurtboxes },  // reference
}
```

The character config is a reference, not a copy. Multiple fighters could share the same config and they would all read the same stats — character config is treated as immutable runtime data. (fighterB currently *does* share most of fighterA's config by spread; that sharing is deliberate and temporary — see the load-bearing decisions.)

Notably absent: no `isAttacking` boolean, no `canJump` flag. Those would be derivable from `actionState` and `stateFrame`, and **one source of truth on the fighter** means a question answerable by looking up the current state is never duplicated in a separate field. The Phase 13 fields look like exceptions to this rule but are its confirmation: `pendingHitstunFrames` exists precisely because a per-hit duration is *not* derivable from state data — it's runtime information created by the hit itself. `pendingHit` is a moment-in-time event awaiting consumption; `damage` persists across every state; `hitConnected` is per-attack bookkeeping owned by the hit-detection system. The rule is unchanged — derive what's derivable, store only what isn't.

### 8.5 The Three Data Layers

As the engine matured, three distinct layers of data emerged. Understanding which layer owns a value is the most important question when adding a new feature.

**Character data (immutable, authored).** Lives in `data/characters/*.js`. Authored once per character; never mutated at runtime. Stats like walkSpeed, jumpForce, gravity, dashSpeed, fastFallSpeed, weight. Body dimensions. Color. And — since Phase 12/13 — two sub-tables keyed by state name: `attacks` (per-attack duration, hitbox geometry, damage, angle, knockback parameters, hitstun) and `hurtboxes` (per-state defensive geometry with a `default` fallback).

**State data (immutable, authored).** Lives in `data/states/states.js`. Authored once per state; never mutated at runtime. Physics modifiers (gravity multiplier, friction multiplier, horizontal mode, fall-speed cap, respect-platforms flag, intangible flag), transitions, optional effects, optional render overrides — and, for movement states only, duration.

**Fighter runtime (mutable, written every frame).** Lives on the fighter object on the World. Position, velocity, grounded flag, action state, state frame counter, air jumps and air dodges used, the pending-hit fields, the damage accumulator, input buffer.

**The shape-vs-tuning split (Phase 12).** Attack states divide their data between two layers on purpose: the *state* declares the action's shape (its physics behavior, its transitions, its identity), while the *character* declares its tuning (`character.attacks[stateName]` — timing, hitbox geometry, damage, knockback). The same state name reached by two different fighters produces the same action shape with each fighter's own numbers. There is deliberately no state-data fallback for attack tuning: "Falcon's jab" isn't "the default jab with Falcon tweaks," and a missing character entry hangs the state at undefined duration — a loud bug fixed in five seconds, preferred over a silent wrong default. Consumers reach the tuning via optional-chaining lookup (`durationElapsed` consults `f.config.attacks?.[s.name]?.duration` before `s.duration`); the same migration pattern is ready for movement durations when characters need to diverge there too. The full decision tree lives in `dataModel.md`.

The principle for choosing a layer when adding new data:

- **What the fighter is currently doing** → state data. Example: "during this state, the fighter ignores platforms." That's on the state.
- **What's true about the fighter that persists across actions** → fighter runtime. Example: "the fighter has used 1 of 2 air jumps." That's on the fighter.
- **What's intrinsic to the character regardless of state or runtime** → character data. Example: "this character's jump force is 8 px/frame." That's on the character.
- **And the Phase 12 addendum: would two characters ever want different values for this?** If yes, it belongs on the character even when it's keyed by state name. Hitbox geometry answered yes; hurtbox geometry answered yes ("different fighters will be different sizes"); movement durations will eventually answer yes.

The cost of choosing wrong:

- A persistent fighter trait on state data → state forking (combinatorial explosion).
- An action-specific rule on the fighter → paired enter/exit effects, easy to leave the fighter stuck if you miss one.
- A runtime counter on character data → can't mutate, doesn't work.

### 8.6 The Tick

```js
export function tick(world, inputsByFighter) {
  world.frame += 1;
  inputSystem(world, inputsByFighter);
  stateSystem(world);
  physicsSystem(world);
  collisionSystem(world);
  hitDetectionSystem(world);
}
```

Five systems, fixed order, never reordered, never conditional. Each system reads the World, possibly calls into core primitives, and writes results back to the World. Systems do not call into each other.

`inputsByFighter` is a positional array: `inputsByFighter[i]` feeds `fighters[i]`. The composition root builds it (human snapshot for `[0]`, `NEUTRAL_SNAPSHOT` for the dummy at `[1]`); `inputSystem` is a pure positional dispatcher and knows nothing about input sources.

The order is meaningful:

- **input runs first** so the buffer holds the freshest snapshot when state and physics consult it.
- **state evaluates transitions** against that snapshot and updates `actionState` before physics reads it. Putting state before physics means a press-on-frame-N gets a physics consequence on frame N, not frame N+1.
- **physics applies the state's modifiers** and integrates velocity. After this, position reflects what the fighter would be if no collision existed.
- **collision resolves landings, walls, and walk-offs.** After this, position reflects reality. Collision is also where `grounded` is set or cleared.
- **hitDetection runs last** (Phase 13), testing hitbox-vs-hurtbox overlap against final resolved positions — running before collision would test pre-clamp positions and produce false results at platform edges. A hit writes `pendingHit` on the victim, which the victim's state machine consumes on the *next* tick. The 1-frame lag is deliberate and invisible; resolving hits mid-tick would introduce ordering dependencies between fighters.

### 8.7 The State Machine

The state machine in `core/stateMachine.js` is a generic interpreter. Given a state definition and a fighter, it walks the transition rules in priority order, finds the first one whose condition fires, applies the transition (with any effect), and returns. If no condition fires, it advances `stateFrame` by 1.

**Transitions are priority-ordered.** First match wins. The order of entries in `state.transitions` is significant. For example, Walk's transitions:

```
notGrounded     →  Fall
jumpPressed     →  JumpSquat
crouchInput     →  Squat
stickSlammed    →  Dash             (effect: commitFacingFromSlam)
noHorizontalInput → Idle
```

Order matters because multiple conditions can be true on the same frame. Walking off a soft platform with down held → `notGrounded` fires before `crouchInput`, so the fighter falls (and `wantsThroughPlatforms` then continues the drop-through).

**Transitions do not chain.** When a transition fires on frame N, the new state's transitions are NOT also checked on frame N. The new state's first transition check happens on frame N+1. This is a deliberate constraint — it makes ordering predictable and prevents infinite loops.

**`durationElapsed` is special.** It's the one condition that knows about timing. `duration > 0 && stateFrame + 1 >= duration` — the +1 is what makes "JumpSquat duration 3" mean "JumpSquat lasts exactly 3 frames" rather than "JumpSquat exits when stateFrame hits 3" (which would be 4 frames active). Since Phase 12 it consults the character first: `f.config.attacks?.[s.name]?.duration ?? s.duration` — attack timing is character tuning, movement timing is (for now) universal state data.

**Dynamic durations live on the fighter, not the state (Phase 13).** Hitstun's length varies per hit, so it can't be authored on state data. The pattern: an effect writes a runtime field (`pendingHitstunFrames`), and a sibling condition gates the exit (`hitstunFinished`: `stateFrame >= pendingHitstunFrames`). `durationElapsed` keeps its authored-duration semantics untouched; dynamic timing gets its own named condition. Hitlag will reuse this exact shape in 13b.

**Universal transitions are authored, not interpreted (Phase 13).** Every one of the 24 states carries `{ when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' }` as its **first** transition — above even `notGrounded`. The alternative was interpreter magic (auto-check `pendingHit` before consulting per-state transitions); explicit-in-data won because a reader of `states.js` should see that a hit can happen, and per-state override stays possible. Hitstun's own `hitTaken` self-transition is what makes re-hits work for free: fresh `applyHitReaction`, fresh `stateFrame`, fresh launch — combos without combo code.

**Conditions and effects are named, not function-valued.** State definitions reference conditions by string (`{ when: 'canAirJump', to: 'AirJump' }`), and the state machine resolves those names through `core/conditions.js` and `core/effects.js`. This is why state definitions can be pure data — the data references functions by name, not by JavaScript reference.

**Adding a state is one entry in `states.js`.** Adding a condition is one entry in `conditions.js`. Adding an effect is one entry in `effects.js`. None of these changes touch the state machine interpreter.

### 8.8 The Registries

There are two registries that the state machine consults.

**`core/conditions.js`** exports an object whose values are `(fighter, state) → boolean` functions. Each entry is a named condition. Current entries, twenty in all: the movement set (`jumpPressed`, `durationElapsed`, `grounded`, `notGrounded`, `horizontalInput`, `noHorizontalInput`, `crouchInput`, `notCrouchInput`, `canAirJump`, `canAirDodge`, `stickSlammed`, `stickReverseFromFacing`, `fastFallTriggered`), the light-attack family (`lightAttackPressed` plus its directional variants `…Up`, `…Down`, `…Side` for ground and `…Forward`, `…Back` for air — the aerial pair reads press-frame stick relative to facing and commits nothing), and the combat pair (`hitTaken`, `hitstunFinished`). Conditions read the fighter's input buffer, vy, grounded flag, facing, runtime fields, etc.

**`core/effects.js`** exports an object whose values are `(fighter) → void` functions. Each entry is a named effect. Current entries, eight in all: `applyJumpImpulse`, `applyAirJumpImpulse`, `resetAirActions` (the Phase 11 composite that zeros both air counters — scheduled to decompose into atomic resets when the array-of-effects extension lands in 13b), `commitFacingFromSlam`, `commitFacingFromLightAttackPress`, `applyFastFall`, `applyAirDodge`, and `applyHitReaction` (the Phase 13 composite: compute knockback, write launch velocity, accumulate damage, set hitstun frames, clear the pending hit — in that order, because the formula must read pre-hit damage). Effects mutate fighter fields at the moment a transition fires.

The two registries are the substrate for the state machine, and Phases 11–13 confirmed the prediction that they're where growth lands: combat added six conditions and three effects and changed the interpreter not at all. The interpreter's one pending change — an array of effects per transition, ~6 lines — waits for hitlag in 13b, the first consumer that genuinely composes multiple atomic effects on one transition.

### 8.9 The Physics System

Physics has two responsibilities:

- **Apply gravity** (only if airborne), scaled by the state's gravity multiplier, capped at the state's `fallSpeedMax` if defined. Gravity is not applied while grounded.
- **Drive horizontal motion** via one of four "horizontal modes" declared on the state:
  - `none` — apply friction. Used by Idle, Squat, JumpSquat, Land, DashStop.
  - `walk` — set vx directly to `stickX * walkSpeed`. Used by Walk.
  - `air` — accelerate vx by `stickX * airAccel`, asymmetric-capped at `airSpeedMax`. Used by Fall, AirJump, FastFall.
  - `dash` — set vx directly to `facing * dashSpeed`. Used by Dash, DashBack, Run.

Then integrate: `x += vx; y += vy`.

The asymmetric cap in air mode is load-bearing: when vx is already above the cap (e.g., from a dash-off-edge), additional outward acceleration is a no-op, but inward deceleration applies normally. This is what allows dash velocity to carry into the air without being yanked back to the air-drift cap.

**Air mode does not touch facing.** Walk mode commits facing to stick direction (you face the way you walk); air mode deliberately doesn't (you can drift backward while facing forward). The two modes look similar enough that a copy-pasted facing-commit line lived in air mode from Phase 4 to Phase 12, inert until aerial back-attacks became the first consumer of stable air facing — at which point B-air was unreachable and the line was deleted. The divergence is Melee-canonical, keyboard-accessible back-airs depend on it, and future moonwalk-style mechanics will too. A comment in `physicsSystem.js` guards against anyone "fixing" the inconsistency by re-adding the line.

### 8.10 The Collision System

Collision has three responsibilities, in order:

**1. Sweep solids.** Each solid is an axis-aligned rectangle with `{top, bottom, left, right}`. The sweep tests the line segment from `(xPrev, yPrev)` to `(xNow, yNow)` against each side of the rectangle. The "from outside" check uses non-strict inequality (so a fighter at exactly the wall edge is treated as on the edge, not inside) to handle wall-slide cases. The "perpendicular range" check uses strict inequality for left/right sides (so a fighter standing on top of a solid at its corner doesn't trigger a wall hit when walking).

Side-specific responses:

- **top:** snap y to top, vy = 0, grounded = true. The fighter has landed.
- **bottom:** snap y to bottom, vy = 0, grounded unchanged. Head bump — the fighter stays airborne and starts falling.
- **left/right:** snap x to wall, vx = 0, grounded unchanged. The fighter is stopped horizontally but can continue falling.

**Only the perpendicular axis snaps.** This is essential for wall slides: on the second frame of wall contact, the sweep fires at t=0 (xPrev is already at the wall) with hitY = yPrev. If we snapped y too, every frame would yank the fighter back to start-of-frame y and they'd never accumulate vertical motion. Snapping only x lets them slide. The same rule applies to top/bottom hits — preserving x lets diagonal landings continue any horizontal momentum into the surface.

**2. Sweep platforms.** Platforms are one-way horizontal lines with `{y, x1, x2}`. The sweep fires only when the motion path crosses the line from above to below. The platform sweep is skipped entirely when the fighter "wants through platforms" (see below).

**3. Walk-off detection.** If the fighter was grounded last frame, didn't land on anything this frame, and isn't standing on any surface anymore, clear `grounded`. The state machine will see `notGrounded` next frame and transition to Fall.

**The `wantsThroughPlatforms` predicate.** A small function in `collisionSystem.js`:

```js
function wantsThroughPlatforms(fighter, state) {
  if (state.physics.respectPlatforms === true) return false;
  const now = fighter.inputBuffer[0];
  if (!now || now.stickY <= 0) return false;
  return true;
}
```

When true, the platform sweep is skipped AND the still-on-surface check ignores platforms. This is the entire drop-through mechanism. The `respectPlatforms: true` opt-out, speculative when this predicate was written, now has twelve users: AirDodge (structural — it's what makes wavelanding onto platforms possible), Land (a tuned skill-window choice), and all ten attack states (a mid-swing fighter shouldn't drop through the platform under them). Hitstun deliberately sets it `false` — a launched fighter keeps normal drop-through rules.

Collision is also the stage hit detection depends on: `hitDetectionSystem` runs immediately after it (§8.12) so that overlap tests read final, resolved positions rather than pre-clamp ones.

### 8.11 The Input System

Inputs flow through a four-stage pipeline:

**Keyboard listener** (`input/keyboard.js`). Maintains a Set of currently-held key codes via `keydown`/`keyup` listeners. Uses `event.code` (physical key) not `event.key` (layout-mapped character) so behavior is layout-independent. A `blur` listener clears the held set so alt-tab doesn't leave keys stuck. This module is standalone-only: the embedded build replaces it with focus-scoped listeners in the site's `desktopGame.js` that produce the same snapshot shape (§8.16).

**Input snapshot.** Built fresh from the held-keys Set on each `getCurrentInput()` call. The contract claims its slots up front: `{stickX, stickY, cStickX, cStickY, jump, lightattack, heavyattack, lightspecial, heavyspecial, grab, shield, shieldDepth}`. Sticks are -1 / 0 / +1; the c-stick slots are zeroed until a producer exists; `shieldDepth` is the analog slot (1.0 or 0.0 from a keyboard). Claiming slots before producers exist is deliberate — Phase 12's entire attack input surface was already in the contract from Phase 4, and the c-stick's presence shaped two Phase 12 design decisions before the input itself exists. `NEUTRAL_SNAPSHOT` (in `core/inputBuffer.js`) is the frozen all-slots-at-rest instance of the same contract, fed to the dummy.

**Input system** (`systems/inputSystem.js`). A positional dispatcher: `inputsByFighter[i]` is pushed onto the front of `fighters[i]`'s `inputBuffer`. Which source produces which snapshot is the composition root's decision; the system knows nothing about keyboards or dummies. The buffer is fixed-size (12 entries); older entries fall off the end.

**Buffer queries** (`core/inputBuffer.js`). Two primitives with different shapes: `wasPressedWithin(buffer, key, frames)` answers "did the input happen" (rising-edge detection in a window), and `pressIndex(buffer, key, frames)` — Phase 12 — answers "find it and look around it," returning the buffer position of the rising edge so conditions can read *the stick at the frame of the press*. The press carries its own context across the buffered frames between the player's commitment and the state machine's evaluation. Directional attacks are its first consumer; smash-vs-tilt detection and DI are its future ones.

**Conditions** (`core/conditions.js`). Read the buffer to answer questions: `jumpPressed` looks for a rising edge within 5 frames; `canAirJump` uses a shorter 3-frame window plus a counter check; `fastFallTriggered` uses two windows to distinguish fresh presses from sustained holds; the light-attack family pairs a press window with `pressIndex` stick reads. The window-sizing reasoning lives in `stateMachine.md`.

The pipeline is one-way: the Set is mirrored into snapshots, snapshots are pushed into the buffer, conditions query the buffer. Nothing flows backward.

### 8.12 Hit Detection and Knockback

`systems/hitDetectionSystem.js` (Phase 13) is the engine's first cross-fighter system — every other system iterates fighters independently against the stage. It runs last in the tick and does one job: find hitbox-on-hurtbox overlaps and record them.

The loop, per attacker: reset `hitConnected` if a new attack just started (`stateFrame === 0` and the current state has hitboxes); collect the attacker's active hitboxes (from `config.attacks[actionState].hitboxes`, filtered by `stateFrame` against each box's inclusive `active: [first, last]` window); then for each victim that isn't the attacker, isn't in an `intangible` state, and isn't already in `hitConnected` — world-space-transform each hitbox and each hurtbox (center-anchored offsets, x mirrored by the owner's facing) and AABB-test every pair. First overlap wins: write `pendingHit`, add the victim to `hitConnected`, break. Author-side hitbox order is therefore a priority order, which is exactly what sweetspot/sourspot authoring will want in Phase 14b.

Two shapes here are load-bearing:

**`pendingHit` is a self-contained snapshot**, not a reference into the live hitbox object: `{attackerIndex, attackerFacing, damage, angle, baseKnockback, knockbackGrowth, hitstun}`, all copied at hit time. Character config stays read-only; the hit event owns its own lifetime (the attacker can leave the attack state before the victim's state machine consumes the hit, and the data stays valid); and `attackerFacing` frozen at contact means a pivoting attacker can't distort a launch that already happened.

**`hitConnected` is hit-detection-internal.** It's never read by any condition, so its lifecycle belongs to the system that owns it — reset inline at attack start, not via effects on twenty attack-entry transitions. Compare `airJumpsUsed`, which *is* read by a condition and therefore must be reset through the effect registry where the state machine can see it. The rule: a field's owner is whoever needs to observe it.

The AABB and transform helpers live inline in this file rather than in a shared geometry module — deliberately. Grab (Phase 17) and projectiles (Phase 18) will each own their own contact-resolution flow with different result semantics; abstracting now would force a shape on systems whose needs aren't known yet.

`core/knockback.js` is the other half: `computeKnockback(hit, victimDamage, victimWeight) → {vx, vy}`, a pure function with no imports. The formula is a Melee-faithful approximation — post-hit percent and move damage build a damage component, weight scales it (`200 / (weight + 100)`), knockback growth and base knockback finish the magnitude, and `VELOCITY_SCALE` (0.08) converts Melee's abstract knockback units into pixel/frame velocity. Angle is authored in degrees, attacker-facing-relative, converted to world space with the Y-down flip. The tuning ladder: one move feels wrong → its `attacks` entry; one character feels wrong → their `weight`; *everything* feels wrong → `VELOCITY_SCALE`. Reaching for the global knob to fix a local problem is the tempting mistake.

Consumption closes the loop on the next tick: the victim's universal `hitTaken` transition fires, `applyHitReaction` computes and applies the launch, accumulates damage, sets `pendingHitstunFrames`, and clears `pendingHit`.

### 8.13 The Renderer

`render/renderer.js` is a pure function of state. Every frame, the canvas is cleared and redrawn entirely from the current World. It holds no references between frames, caches nothing, and never mutates anything.

It draws:

- **Background.** Solid fill of the canvas.
- **Solids.** Filled gray rectangles with a thin white outline.
- **Platforms.** Thin white horizontal lines.
- **Fighters.** Filled rectangles, color = `state.render.color || fighter.config.color`. Anchored at bottom-center (so `fighter.y` is the feet).

The renderer reads `world.states[fighter.actionState]` to look up the per-state render override (e.g., the dark red of FastFall). This is the only coupling between the renderer and the state data, and it's read-only.

### 8.14 The Debug Layer

`src/debug/` is isolated from the rest of the engine — eight files, each a self-contained panel or helper, orchestrated by `overlay.js` (which installs its own backtick keydown listener, deliberately separate from the gameplay keyboard module: a toggle press is not a game input, doesn't go through the input buffer, and can't affect determinism).

The panels: `liveStats.js` (per-frame readout — now including per-fighter damage and pending-hit rows), `history.js` (the press-to-record capture), `colorEditor.js` (live state-color tuning), and the world-space draws that Phase 10 predicted would "extend the overlay rather than introduce new draw paths" — which is exactly what happened: `hitboxes.js` (Phase 12, red, reading `config.attacks`) and `hurtboxes.js` (Phase 13, green, drawn under the red, skipping `intangible` states). `format.js` holds the shared number formatters; `overlayState.js` holds the shared meta-state.

Production rendering knows nothing about combat — the renderer draws no boxes, no damage. Combat visualization is diagnostic output until real attack animations exist, and it lives entirely on this layer.

The embedded build splits this layer in half (§8.16): the world-space box draws are imported and kept (they can only live on the game canvas; backtick still toggles them, focus-scoped), while the text panels are *not* imported — a paired inspector window rebuilds their content as live DOM in the site's visual language, reusing `format.js` so the numbers read identically. The overlay's window-level input wiring (`initOverlayInput`) is standalone-only.

### 8.15 The fixedMath Layer

`core/fixedMath.js` wraps arithmetic in function calls: `fm.add(a, b)`, `fm.sub(a, b)`, `fm.mul(a, b)`, `fm.div(a, b)`, `fm.abs(n)`, `fm.sign(n)`, `fm.min(a, b)`, `fm.max(a, b)`, `fm.clamp(n, lo, hi)` — and, since Phase 11, `fm.length2D(x, y)`. length2D was added as the *meaningful operation* rather than exposing a raw sqrt: it's what physics math actually wants (air-dodge normalization was the first consumer), and a future fixed-point implementation (integer Newton's method or a LUT) has one swap site instead of scattered sqrt calls.

Today these are thin wrappers around float operations. The reason they exist as functions rather than inline operators is that a future port to fixed-point integer math (for bit-exact replays, rollback netcode, or deterministic cross-platform play) would require changing only `fixedMath.js`. Every callsite that uses `fm.mul(a, b)` continues to work without modification.

Counters and indices that don't need fixed-point semantics (`stateFrame`, `airJumpsUsed`, buffer indices, loop counters) use plain JS arithmetic. The discipline is: anything that participates in physics simulation routes through `fixedMath`; anything that's a count or an index doesn't.

### 8.16 The Embedded Build (The Contract)

The Calilei site hosts the game as a desktop-window file type. `desktopGame.js` (site repo) is an **alternate composition root**: it plays main.js's role — create the World, own the fixed-timestep accumulator, build `inputsByFighter`, call tick, call render — inside a window the site's desktop panel owns, paired with an inspector window that shows the running match as live DOM. The engine doesn't know it's embedded; the embed knows the engine only through its public exports.

**What the embed imports** (the same set main.js composes from): `createWorld`, `tick`, `render`, `createFighter`, the stage, both characters, `states`, `NEUTRAL_SNAPSHOT`, and from the debug layer the world-space draws (`drawHitboxes`, `drawHurtboxes`) plus the `format.js` number helpers.

**What it deliberately does not import:** the game's `main.js` (self-executing — it sits unused in the vendored tree), `input/keyboard.js` (window-level listeners have no place inside a page full of other interactive surfaces), and `debug/overlay.js` / `colorEditor.js` (window-level input wiring; the inspector window replaces the text panels outright).

**Two snapshot producers, one contract.** The embed builds input snapshots from its own held-keys Set, fed by *element-scoped* listeners on the game window's focusable surface — the game hears the keyboard only while its surface holds DOM focus, and browser focus is the input-exclusivity mechanism. The produced object matches `getCurrentInput()`'s shape field-for-field. This is the practical consequence for engine work: **the snapshot contract is a two-producer API.** Adding a field to it means updating `keyboard.js`, `NEUTRAL_SNAPSHOT`, and the site's `buildSnapshot` together.

**Clock parity is structural.** The embed copies the standalone loop's constants (60Hz, the same spiral-of-death cap) and consumes the same rAF timestamps, so the embedded game ticks exactly like the standalone one. Its one addition is liveness: the loop only runs while the surface is focused, and resume clears the accumulator — pause never produces a catch-up burst.

**What engine work must respect to keep the embed alive:**

- The vendor rule, restated from §6: the vendored copy is never edited. If a change seems needed there, it belongs either in this repo (engine behavior) or in `desktopGame.js` (embed behavior).
- Modules must stay side-effect-free at import time. The embed imports engine modules à la carte; a module that installs listeners or touches the DOM on import breaks the à-la-carte property. (`main.js` is the one self-executing file, and it's excluded by name.)
- Window-level listeners are standalone-only territory. Anything that must hear input in the embed goes through the snapshot contract or lives site-side.
- A new fighter runtime field doesn't appear in the embed's inspector automatically — its row is added by hand in `desktopGame.js`. Worth remembering when a new field seems invisible in the site: the engine is fine, the inspector just hasn't learned the field.

---

## 9. Load-Bearing Design Decisions

These are the decisions that, if reversed, would cascade across the codebase. They are flagged for future contributors who might be tempted to "improve" them without understanding the consequences.

**The fighter's position anchor is bottom-center.** `fighter.y` is the feet. Top of the body is `fighter.y - height`. This was committed in Phase 3 and is now load-bearing for collision (which checks if `fighter.y` matches `solid.top`) and rendering (which draws from `y - height` to `y`). Changing the anchor would touch every system.

**The Y-down convention.** Smaller y is up. Jumping means negative vy. `solid.top` is the smaller y; `solid.bottom` is the larger. This matches Canvas's coordinate system and is consistent across the codebase. The naming is unambiguous (`top` and `bottom`, not `y1` and `y2`) precisely because Y-down is counterintuitive.

**The tick order: input → state → physics → collision.** Changing it would change frame semantics. Input first means state sees fresh input. State before physics means a press on frame N produces a physics consequence on frame N. Collision last means it can correct positions physics pushed past surfaces.

**State transitions do not chain.** A new state's transitions are not re-checked on the same frame as the transition. This makes ordering predictable and prevents infinite loops. Adding chaining would change the timing of many emergent behaviors.

**`durationElapsed`'s `+1` semantics.** `stateFrame + 1 >= duration` is the correct check, gated by `duration > 0`. This means duration counts the number of frames the state is active, not an upper bound on `stateFrame`. Many state durations were tuned to this convention; changing it would re-time every fixed-duration state.

**The asymmetric air-drift cap.** When vx is above the cap, only opposite-direction acceleration applies. This is what makes dash-off-edge feel right and would silently break that emergence if removed.

**Wall snap preserves vertical motion (snap only the perpendicular axis).** Discovered as a bug in Phase 8. The simpler "snap both axes" reads correctly for the first frame of contact but produces a stuck-at-y bug on subsequent frames. The current rule is "snap only perpendicular, preserve parallel" for all four sides of solids and for platform tops.

**The two fast-fall windows.** `FAST_FALL_FRESH_WINDOW = 3` is the structural maximum that prevents drop-through carryover from leaking into the fresh path. Raising it would re-introduce the bug where holding down on a platform instantly fast-falls after drop-through. `FAST_FALL_COMMIT_FRAMES = 6` is purely a feel tuning knob.

**`respectPlatforms` lives on state data, not on the fighter.** The action determines whether platforms are respected. Moving it to the fighter would require paired enter/exit effects on every state that should opt in (e.g., attacks), with easy-to-miss exit paths leaving the fighter stuck.

**Solids have non-strict "from outside" checks but strict perpendicular range checks for left/right.** This is what lets a fighter walking on the top of a solid at its corner not trigger a phantom wall hit, while still allowing wall snapping to work for fighters who are pressed against the wall.

**No `Math.random()` and no wall-clock time in tick.** Today this is a habit; tomorrow it's the foundation for deterministic replays. Breaking it once is invisible; breaking it consistently makes determinism unrecoverable.

**`window.world = world` is the console hook.** The user can inspect the game state from DevTools without any debugging infrastructure. This has been load-bearing for every bug investigation across phases 5-9.

**The tick signature is positional.** `inputsByFighter[i]` feeds `fighters[i]`, and the composition root — not the input system, not the fighter — decides who feeds whom. The rejected alternative (an `inputSource` enum on the fighter, dispatched inside inputSystem) would have taught the input system about source types. When P2 becomes real, the change is one entry in the root's array.

**Attack tuning lives on the character, with no state-data fallback.** `character.attacks[stateName]` is the source; a missing entry hangs the state at undefined duration — a loud, five-second bug preferred over a silent shared default that would make two characters' same-named attacks identical by accident. Movement durations still live on state data; the migration pattern is established for when they need to diverge.

**Hitbox and hurtbox conventions.** Lists even at length 1 (multi-hit and per-limb drop in with zero authoring migration), center-anchored `shape.x/y` mirrored by facing at the consult site, inclusive `[first, last]` active windows. All three were named explicitly on the first hitbox because they bake into every future one.

**Air facing is decoupled from air drift.** The facing-commit line deleted from air mode in Phase 12 must stay deleted — back-airs, drift-away spacing, and future moonwalk mechanics all depend on facing staying put while drifting. The walk/air asymmetry is intent, not inconsistency.

**`pendingHit` is a self-contained snapshot, including `attackerFacing`.** Copied at contact, never a reference into live config, valid regardless of what the attacker does between hit-write and hit-consume. Changing this to a live lookup would let a pivoting attacker retroactively redirect a launch.

**`hitConnected`'s lifecycle is internal to hitDetectionSystem.** No condition reads it, so no effect resets it. Moving its reset into the effect registry would spread twenty identical effect wirings across attack transitions for zero observability gain.

**`hitTaken` is the first transition of every state.** Above `notGrounded`, in all 24 states, explicitly authored. Hit reactions preempt everything; the redundant entries (e.g., on intangible AirDodge) are harmless and defensive. If a state must ever ignore hits, it does so by *not listing* the transition — visible in the data, not hidden in the interpreter.

**`NEUTRAL_SNAPSHOT` is one frozen object.** The dummy's "input source" is a single immutable instance of the snapshot contract, shared by reference across every tick and both composition roots. Mutating it would corrupt every consumer at once; that's what `Object.freeze` is for.

**The vendor rule.** The site's embedded copy of `src/` is byte-identical and never edited site-side; sync is a dumb copy, forever. The moment the vendored tree diverges, there are two engines, and every doc in this folder describes neither.

---

## 10. What This Architecture Enables Next

The forward inventory lives in `secondHalfPlan.md` — phase-by-phase pressures, migrations, and substrate questions through Phase 20. What follows is the shape of it, plus the two predictions from the movement era that have since been tested.

**The tested predictions.** "A second fighter is a new file and one extra spawn call" — confirmed in Phase 13 step 1, almost to the letter; the only surprise was how little surprised. "Attacks require new files but the existing files do not change" — largely confirmed: attacks arrived as data (states + character tuning), hit detection as one new system, and the interpreter never changed. The predicted `attackStates.js` split didn't happen (states stayed in one file — a state is data, data lives in the data file), and the fighter grew hit-fields rather than a stocks field (stocks wait for Phase 19).

**Phase 13b** finishes combat's foundation: hitlag (the freeze-both-fighters frames — the first consumer that genuinely needs the array-of-effects interpreter extension, ~6 lines, after which `resetAirActions` decomposes back into atomic resets) and DI (the victim biasing their launch — a `pressIndex` consumer reading the stick around the hit moment).

**Phase 14** is combat depth: a Tumble state (uncapped post-hitstun fall, so spikes stay fast after hitstun ends instead of snapping to Fall's terminal velocity), per-aerial landing lag and L-cancel (14a), multi-hit and sweetspot/sourspot authoring (14b — the `hitboxes` list and first-overlap-wins priority are already shaped for it), and fighterB's real moveset (14c — the moment the fighterA spread dies and `character.attacks` keys first diverge between characters).

**Phases 15–18** each bend the substrate further: dodges and frame-windowed invulnerability (15, building on `intangible`), edge mechanics (15.5), shield as the first runtime resource (16), grab as the first fighter-couples-fighter mechanism (17), projectiles as the first non-fighter entity type (18). Hit detection's pattern — a system writes a pending field, the state machine consumes it next tick — is the template each will adapt to its own result semantics.

**Phase 19** (KO / respawn / stocks) is the consumer that finally resets `damage`, and **Phase 20** (gamepad) is the payoff for the snapshot contract's up-front slot claims: the c-stick and analog shield fields have been waiting in the contract since Phase 4, zeroed, with two Phase 12 design decisions already shaped around them.

**Advanced techniques** keep the same policy they've had from the start: wavedashing and wavelanding already emerged rather than being designed; L-cancelling, platform cancelling, and moonwalking are expected to fall out of primitives the same way. They will not be designed. They will be discovered.

**Online play** is a longer story but the substrate is already friendly. Determinism is baked in. The World is a flat data structure that can be serialized. The tick function is pure (modulo World mutation). Rollback netcode is principally about storing past Worlds and re-ticking from them; the engine doesn't fight that pattern.

**A port to Unreal** becomes a translation exercise. The World is a struct. Systems are functions. State definitions are data assets. Conditions and effects are function pointers in tables. The discipline of writing logic as portable conditionals means most of it transfers line-for-line into C++ or Blueprints. The fixedMath layer is the one place where the port would meaningfully diverge — switching to fixed-point integer math during the port, rather than later in JS. The embedded build was a small dress rehearsal for this: the engine composed cleanly under a foreign host without modification.

---

## 11. The Discipline

The hardest part of this project will not be writing code. It will be holding the line.

When a bug appears in physics, the temptation will be to add a special case in the physics system. **Resist.** The fix belongs in the state's physics modifier, or in a new transition rule, or in the input buffer query — not in the physics primitives.

When a new technique is desired, the temptation will be to add a `wavedash` flag and a `if (wavedashing) { ... }` block. **Resist.** If the technique cannot emerge from existing primitives, the primitives are wrong, and the right fix is to generalize the primitives, not to special-case the technique.

When state grows complex, the temptation will be to split states across multiple files. **Resist.** A state is data. Data belongs in data files. Logic for interpreting data belongs in the interpreter.

When a renderer wants to remember where a fighter was last frame, the temptation will be to cache it on the renderer. **Resist.** Add it to the World, or recompute it from the World. The renderer holds no state.

When something can be done with a fighter-level flag OR a state-level flag, the temptation will be to pick whichever is easier in the moment. **Pause.** Ask whether the rule is "what the fighter is doing" or "what's true about the fighter independent of action." The first goes on the state. The second goes on the fighter. Choosing wrong is recoverable but expensive.

When a new feature seems to need a new substrate piece, the temptation will be to build it. **Read the existing primitives first.** Phase 12 twice discovered that an anticipated piece wasn't needed — a dash-attack pivot effect dissolved after two minutes in `physicsSystem.js`, because facing-commit discipline plus dash-mode-reads-facing already did the work. Ten minutes of investigation is the cheapest substrate there is, and it's how the freebies get found.

When a consumer behaves unexpectedly, **suspect the substrate beneath it, not just the consumer.** The air-facing bug sat inert for eight phases; the first consumer that cared surfaced it in one play session. Substrate bugs are latent until consumers exist — copy-paste between similar-looking handlers is their most common source, and "the new feature is broken" is sometimes "the old foundation was always broken and nothing had noticed."

These disciplines are what make the architecture work. The architecture is only as strong as the willingness to honor it.

---

## 12. Summary

A 2D platform fighter in vanilla JavaScript, no build step, rendered on HTML5 Canvas, structured around a single source of truth (the World) and a single transformation function (`tick`). The engine is decomposed into core primitives that know nothing about the game, systems that bridge primitives with game data, pure data files that define states and characters and stages, and a debug layer that exposes everything to the developer. It runs from two composition roots: standalone in this repo, and embedded in the Calilei site over a vendored, never-edited copy of `src/`.

The inspiration is *Super Smash Bros. Melee*, where physics-first design and a generic state machine produced gameplay depth nobody designed. The philosophy is to build the substrate, not the features, and to let depth emerge from the interaction of primitive rules.

Thirteen phases in, the philosophy has been tested twice over. Ten phases of movement produced one fully expressive fighter — walk, dash, run, jump, double-jump, fast-fall, drop-through, wall-slide, air-dodge — with wavedashing and a family of cancels falling out of primitives for free. Three phases of combat produced a ten-move light-attack family, hurtboxes, cross-fighter hit detection, Melee-faithful knockback, damage, and dynamic hitstun against a second fighter — while changing the state-machine interpreter not at all, adding one tick stage, and deleting exactly one line of physics. The core loop of a fighting game exists.

The next stages — hitlag and DI (13b), tumble and L-cancel and real character variation (14), dodges, shield, grab, projectiles, stocks, a gamepad — are not blocked by the architecture. They are layered additions to a substrate that was built to receive them, and the substrate's track record at receiving is no longer a promise. It's a pattern.

This document is the reference.

# predevPlan.md

## A Platform Fighter Built on Emergence

---

## 1. The Vision

We are building a 2D platform fighter in the spirit of *Super Smash Bros. Melee* — not as a clone, but as a study in what made Melee feel the way it did. The goal is to recreate the conditions under which deep, competitive, emergent gameplay can arise, by getting the underlying engine right before any character or move is designed.

The end target for this initial architecture is small and deliberate: **one stage (a Battlefield-style layout with three platforms), one fully realized fighter, and a complete movement system.** No attacks. No hitboxes. No damage. Just a character that can move with the full expressiveness of a platform fighter — and an engine general enough that attacks, projectiles, additional characters, and advanced techniques can be layered on top later without changing the foundation.

This document defines what we are building, why we are building it this way, and the precise sequence of phases we will follow to get there.

---

## 2. The Inspiration: Why Melee Works

Most fighting games are **animation-driven**. An animator decides a move takes 30 frames, the hitbox is active on frames 8 through 12, and the character's position is whatever the animation dictates.

Melee is closer to **physics-driven**. Every character is a point mass moving through a 2D plane with velocity, gravity, friction, and momentum. Animations are layered on top of states, but the physics keep running underneath. This single architectural decision is the source of everything else interesting about the game.

When a Melee player wavedashes, they are not executing a special move. They are air-dodging into the ground at an angle, while horizontal momentum is preserved across the state transition, and the landing state cancels the air-dodge animation. Nobody designed wavedashing. The developers designed air dodges, ground collision, and momentum preservation — and wavedashing fell out as a consequence.

The same is true of dash dancing, L-cancelling, platform cancelling, edge cancelling, moonwalking, and dozens of other techniques that define competitive Melee. None of them were features. All of them were consequences.

This is the goal we are designing toward: **an engine general enough that techniques we never imagined will emerge from the interaction of primitive rules.** We are not building a list of features. We are building a substrate.

---

## 3. The Philosophy

Five principles guide every architectural decision in this project.

### 3.1 Physics-first, not animation-first

Position is determined by velocity. Velocity is determined by state-permitted forces. Animations are visual representations of states, not the authority on where a character is. This is what allows momentum to carry across state transitions, which is what makes emergent techniques possible.

### 3.2 Single source of truth

There is exactly one object that holds mutable game state: the **World**. Every value that matters across frames lives on the World. Nothing else stores game state — not the renderer, not the input handler, not any system. If a value can be derived from the World, it is derived fresh each frame and never cached.

### 3.3 Decoupled logic

Each module knows only what it must know to do its job. Physics operates on bodies, not fighters. Collision operates on line segments, not stages. The state machine operates on state definitions, not on the specific states a fighter happens to use. Dependencies flow strictly downward — from `main.js` through systems to core primitives — and never sideways or upward.

### 3.4 Data over code

Anything tunable is data, not code. Character stats are JSON. State definitions are JSON. Stage geometry is JSON. Code is the engine that interprets data; data is what gets edited when balancing or expanding the game. We never want to see `if (character === "fighterA") { ... }` anywhere in the codebase.

### 3.5 Modularity through composition

`main.js` is the only file that knows about every other file. It composes the engine by importing modules and wiring them together. Every other file exports primitives — pure functions, factory functions, data objects — and imports only what it directly depends on. The shape of the import graph is a tree, not a web.

---

## 4. The Core Idea, In One Line

> **The game is a function: `tick(world, inputs) → world`.**

The World is the noun: a snapshot of everything that exists right now — the stage, the fighters, the frame counter, any active hit interactions.

Tick is the verb: the function that transforms one World into the next World given the inputs that occurred this frame.

Everything else is plumbing. Rendering reads the World but never writes to it. Input handlers capture keystrokes but don't change game state — they hand inputs to tick, which decides what those inputs mean. Loading, drawing, listening, looping — all of it is scaffolding around that one core function.

If our architecture is right, we should be able to:
- Serialize the World to JSON, reload it later, and resume the exact same game.
- Replay a match by re-running tick with the same initial World and recorded inputs.
- Run the game headless (no renderer) by just calling tick in a loop.
- Swap the renderer entirely — Canvas to Three.js to Unreal — without touching tick.

If any of those would be hard, something has leaked outside the World or outside tick.

---

## 5. The Tech Stack

**Vanilla JavaScript. No build step. No framework.** The entire project runs by opening `index.html` in a browser. There is no transpilation, no bundler, no package manager required for the engine itself. Refresh the page to see changes.

**HTML5 Canvas 2D for rendering.** Canvas is immediate-mode — every frame, we clear the canvas and redraw everything from the current World. This matches the architecture exactly: the renderer is a pure function of state, holds no references, caches nothing. CSS would create a second source of truth in the DOM that could drift from the World; Canvas does not.

**ES modules.** Each file is a module with explicit imports and exports. `main.js` is loaded with `<script type="module">`. This gives us the file-by-file modularity we want without any build tooling.

**Logic written as portable conditionals.** Code reads as plain conditional statements wherever possible — `if (input.jumpPressed && state.canJump) ...` — so that the same logic can later be translated into Unreal C++ or Blueprints with minimal mental overhead. We avoid JavaScript idioms that would not port cleanly.

**Determinism-friendly habits from day one.** Fixed timestep (60 frames per second, locked). No `Math.random()` in game logic. No reading wall-clock time. All numeric operations go through `fixedMath` helpers, so we can swap to fixed-point arithmetic later if we need bit-exact determinism for rollback netcode. We do not have to commit to bit-exact determinism now, but the structure will not fight us if we want it later.

---

## 6. The Architecture

### 6.1 Folder structure

```
/index.html                         ← single page with the canvas element
/styles.css                         ← dark background, canvas centered
/src
  main.js                           ← entry point, composition, game loop

  /core                             ← universal primitives, no game knowledge
    fixedMath.js                    ← numeric helpers, swap-ready for fixed-point
    stateMachine.js                 ← generic FSM interpreter
    inputBuffer.js                  ← rolling window of recent inputs
    physics.js                      ← pure functions on bodies
    collision.js                    ← AABB and line-segment intersection

  /world                            ← the container that holds everything
    world.js                        ← createWorld, the World shape
    tick.js                         ← the per-frame orchestrator

  /entities                         ← things that exist in the World
    fighter.js                      ← createFighter factory, fighter shape

  /systems                          ← per-frame logic that operates on the World
    inputSystem.js                  ← push raw inputs into fighter buffers
    stateSystem.js                  ← run state machine for each fighter
    physicsSystem.js                ← apply gravity, friction, integrate
    collisionSystem.js              ← resolve fighter vs stage

  /data                             ← pure data, no logic
    /states
      movementStates.js             ← all movement states as one data object
    /characters
      fighterA.js                   ← character config (stats + state set)
    /stages
      battlefield.js                ← platform geometry

  /input                            ← raw input → normalized input events
    keyboard.js                     ← keyboard listeners, current snapshot

  /render                           ← isolated; reads World, never writes
    renderer.js                     ← draws World to canvas each frame
    debugDraw.js                    ← ECB, hurtboxes, state names, vectors
```

### 6.2 The dependency graph

```
main.js
  ├── world/world.js, world/tick.js
  ├── render/renderer.js → render/debugDraw.js
  ├── input/keyboard.js
  ├── data/stages/battlefield.js
  ├── data/characters/fighterA.js
  └── entities/fighter.js

tick.js
  ├── systems/inputSystem.js
  ├── systems/stateSystem.js → core/stateMachine.js, data/states/movementStates.js
  ├── systems/physicsSystem.js → core/physics.js
  └── systems/collisionSystem.js → core/collision.js

core/* — depend only on fixedMath.js (and nothing else)
data/* — pure data, no imports of logic
```

Arrows point downward only. Nothing in `core` knows about `systems`. Nothing in `data` knows about anything. `main.js` is the only file that touches multiple layers.

### 6.3 What each layer is for

**`main.js`** wires the engine together. Imports modules, creates the initial World, starts the `requestAnimationFrame` loop. The only file that knows about everything.

**`/world`** defines the World shape and the per-frame transformation. `tick.js` calls systems in a strict order: input → state → physics → collision. Order never changes frame-to-frame; this is what "deterministic" means in practice.

**`/core`** holds universal primitives. Physics knows about bodies (`{x, y, vx, vy, mass}`), not fighters. Collision knows about line segments and points, not stages. The state machine knows about state definitions and input buffers, not what any specific state does. These modules could be lifted into a completely different game.

**`/systems`** bridges core primitives with World data. Each system is a per-frame function that reads the World, calls into core primitives, and writes results back to the World. Systems are where the engine becomes a game.

**`/data`** holds pure data with no logic. State definitions, character configs, stage geometry. When we balance the game or add content, we edit data files. The interpreting code does not change.

**`/entities`** defines the shape of game objects. `fighter.js` exports `createFighter(config, x, y)` and declares what fields a fighter has. No logic about what fighters do — just what they are.

**`/input`** captures raw keyboard events and exposes a normalized input snapshot. Shaped so that gamepads can be added later without changing anything downstream. Inputs include analog stick magnitude (binary for keyboard, true analog for gamepad).

**`/render`** reads the World and draws it. Never mutates anything. Includes a debug overlay (`debugDraw.js`) that visualizes ECBs, hurtboxes, hitboxes, state names, velocity vectors, and grounded flags. The debug overlay is how we validate the engine.

---

## 7. How a Frame Flows

Every frame, in strict order:

1. **inputSystem** — Push the current input snapshot into each fighter's input buffer.
2. **stateSystem** — For each fighter, run the state machine: read current state, evaluate transition rules against the input buffer, transition if a rule fires. If no transition, advance the state frame counter.
3. **physicsSystem** — For each fighter, read the current state's physics modifiers (gravity, friction, control authority), apply them. Integrate velocity into position.
4. **collisionSystem** — Resolve fighter-vs-stage collisions. Snap to platforms, set grounded flags, handle platform drop-through.
5. **render** — Draw the World to the canvas. Not part of tick; runs after.

Order matters and never changes. Inputs are read at the start of the frame so that state and physics both see the same inputs. Collision runs last among the systems so it can correct positions that physics may have pushed into platforms.

---

## 8. The Fighter, Conceptually

A fighter is a flat collection of properties — no nested state, no internal classes hiding behavior. The state machine, physics, and collision systems each read whichever properties they need.

A fighter has:
- **Body**: `x, y, vx, vy, grounded, facing`
- **State**: `actionState` (a string ID), `stateFrame` (integer counter)
- **Input**: `inputBuffer` (rolling array of recent input snapshots)
- **Config reference**: a pointer to the character's JSON config (stats and state set)
- **Match data**: `damage`, `stocksRemaining` (zero and full for this phase — used later)

Notably absent: no `isAttacking` boolean, no `canJump` flag, no `hitstunFrames` counter as separate fields. All of those are derivable from `actionState` and `stateFrame`. **One source of truth on the fighter** — if a question can be answered by looking up the current state, we never duplicate the answer in a separate field.

---

## 9. How Action States Work

Action states are pure data. Each state defines:
- **Duration**: how many frames it lasts (or `Infinity` for states like Idle)
- **Physics modifiers**: gravity behavior, horizontal control authority, friction
- **Transitions**: a list of conditions that trigger moves to other states
- **OnEnter effects** (optional): one-shot effects like "set vy to -jumpForce"
- **OnComplete target** (optional): the state to transition to when duration ends

The state machine in `core/stateMachine.js` is a generic interpreter. It reads the fighter's current state ID, looks up that state's definition, walks the transition rules in priority order, and returns the next state ID. The state machine never grows when we add new states — it grows only when we add new *kinds* of transition rules.

Transition conditions are **named** rather than function-valued. A rule says `{ to: 'Walk', condition: 'stickXNonZero' }`, and the state machine maintains a registry mapping condition names to evaluator functions. This keeps state definitions as pure data, and centralizes the logic for "what does each condition mean" in one place.

This is the same principle as a previous DOM-builder approach: we do not write one module per state. **A state is data, not logic.** The interpreter is the logic.

---

## 10. What Emerges From This Architecture

Even before any attacks exist, this architecture produces depth:

- **Dash dancing** — A `Dash` state with a cancel window into the opposite `Dash` falls out from the transition rules.
- **Short hop vs full hop** — A single conditional on `JumpSquat`'s exit ("was jump still held?") yields two distinct jump heights.
- **Fast falling** — A flag set during `Fall` modifies gravity. One flag, doubles the expressive range of every aerial.
- **Platform drop-through** — One conditional in collision: "if grounded on a drop-through platform and holding down, skip collision this frame."
- **Momentum preservation** — Falls out automatically because physics does not zero velocity on state change. Walking into a jump preserves walking velocity.
- **Edge run-offs** — Falls out because running plus collision plus falling already exist. We do not program "run off platform"; it happens.
- **Tip-toe walk speed control** — Falls out because walk velocity scales with stick magnitude (analog input). One multiplication, fine-grained control.

When attacks are added later, the same emergence will appear: wavedashing, L-cancelling, edge cancelling, and techniques we have not yet imagined will arise because the primitives are general.

---

## 11. The Ten Phases

Each phase depends only on what came before. Each ends with a verifiable, testable result. We do not move to the next phase until the current one works.

### Phase 1: Skeleton (The Empty Loop)

**Goal:** Canvas renders, game loop runs at 60fps, nothing else.

**Modules created:** `index.html`, `styles.css`, `main.js`, `world/world.js`, `world/tick.js`, `render/renderer.js`.

**Behavior:** `tick` is a stub that just increments the frame counter. `render` clears the canvas. `main.js` wires them together with `requestAnimationFrame`.

**Verify:** Log `world.frame` once per second. It should climb by ~60.

---

### Phase 2: The Stage

**Goal:** Battlefield is drawn on screen. Pure visual — no collision yet.

**Modules created:** `data/stages/battlefield.js`. Updated: `renderer.js`.

**Behavior:** Stage data exports a main platform (line segment, solid) and three platforms (line segments, drop-through), plus blast zone coordinates. Renderer strokes them as white lines.

**Verify:** Four white lines appear on the canvas in a Battlefield layout.

---

### Phase 3: A Body That Falls

**Goal:** A rectangle appears, gravity pulls it down, it lands on the main platform.

**Modules created:** `core/fixedMath.js`, `core/physics.js`, `core/collision.js`, `entities/fighter.js`, `data/characters/fighterA.js`, `systems/physicsSystem.js`, `systems/collisionSystem.js`. Updated: `tick.js`, `renderer.js`.

**Behavior:** Physics applies gravity to airborne bodies and friction to grounded ones, then integrates velocity into position. Collision checks if the body crossed a platform from above and snaps it. `tick` calls physics then collision.

**Verify:** A rectangle spawns in the air, falls, lands on the main platform, stops. Spawn above each of the four platforms and confirm landing on each.

---

### Phase 4: Input

**Goal:** Keyboard inputs are captured and buffered. Nothing yet responds to them.

**Modules created:** `input/keyboard.js`, `core/inputBuffer.js`, `systems/inputSystem.js`. Updated: `tick.js`, `main.js`.

**Behavior:** Keyboard listeners maintain a current input snapshot shaped like a gamepad (`{ stickX, stickY, jump, attack, shield }`). Input system pushes the snapshot onto each fighter's rolling buffer. Buffer exposes query helpers (`wasPressedWithin`, `getStickHistory`).

**Verify:** Press keys, log `fighter.inputBuffer[0]`, confirm inputs appear and transitions are captured.

---

### Phase 5: The State Machine With Two States

**Goal:** Fighter starts in `Idle`. Press left/right, transitions to `Walk` and moves. Release, returns to `Idle`. The engine becomes a real state machine.

**Modules created:** `data/states/movementStates.js`, `core/stateMachine.js`, `systems/stateSystem.js`. Updated: `physicsSystem.js`, `fighterA.js`, `tick.js`.

**Behavior:** Two states defined as data (Idle, Walk) with transition rules. State machine interprets them generically. Physics reads the state's modifiers — Walk sets `vx = walkSpeed × stickX × facing`, Idle applies friction. `tick` order is now input → state → physics → collision.

**Verify:** Press right, fighter walks right. Release, stops. Press left, faces left and walks left.

---

### Phase 6: Vertical Movement — Jump, Fall, Land

**Goal:** Press jump, fighter crouches briefly, leaves ground, arcs through air, lands with brief lag.

**States added:** `JumpSquat`, `Jump`, `Fall`, `Land`.

**Modules updated:** `movementStates.js`, `stateMachine.js` (duration-based and event-based transitions), `collisionSystem.js` (sets `justLanded` flag), `stateSystem.js` (runs onEnter effects), `physicsSystem.js` (air drift via acceleration toward target speed), `fighterA.js` (adds jump and gravity stats).

**Behavior:** JumpSquat lasts a fixed number of frames, then auto-transitions to Jump. Jump's onEnter sets `vy = -jumpForce` (or `-shortHopForce` if jump was released during JumpSquat). Fall begins when `vy` becomes positive. Land begins on ground collision, lasts a few frames, returns to Idle.

**Verify:** Press jump from idle → brief crouch, liftoff, arc, land. Press jump from walking → momentum preserved through the jump. Tap jump vs hold jump → distinct short hop and full hop heights.

---

### Phase 7: Horizontal Expression — Dash, Run, Turn, DashStop

**Goal:** Slamming the stick produces a dash. Holding produces a run. Releasing brakes. Slamming opposite during the dash window produces a dash dance.

**States added:** `Dash`, `Run`, `DashStop`, `Turn`.

**Modules updated:** `movementStates.js`, `inputBuffer.js` (adds `wasStickSlammed` helper), `stateMachine.js` (registers new named conditions), `fighterA.js` (adds dash, run, turn stats).

**Behavior:** Dash is a fixed-duration state with high horizontal velocity. While in Dash, slamming the opposite direction transitions to Dash (flipped) — this is dash dancing. After Dash duration, if the stick is still held, transitions to Run. Release stick from Run → DashStop → Idle.

**Verify:** Tap right hard → dash burst. Hold right → dash flows into run. Release → brake. Tap right, then left, then right rapidly → dash dance. Dash dancing should work without us having designed it as a feature.

---

### Phase 8: Aerial Completeness — Double Jump, Fast Fall, Air Control

**Goal:** Full aerial expression. Mid-air jump, down-tap to fast fall, stick to drift in the air.

**States added:** `DoubleJump`.

**Modules updated:** `movementStates.js`, `fighter.js` (adds `jumpsRemaining`), `physicsSystem.js` (reads `fastFalling` flag, uses `fastFallSpeed` when set).

**Behavior:** From Jump or Fall, pressing jump while `jumpsRemaining > 0` transitions to DoubleJump (which decrements `jumpsRemaining` and sets upward velocity). Landing resets `jumpsRemaining`. During any aerial state, tapping down hard sets `fastFalling = true`; physics uses fast-fall gravity until landing clears the flag.

**Verify:** Jump, then jump again mid-air → double jump. Jump, tap down at apex → fast fall. Jump while holding left → drift left in the air with proper acceleration curve.

---

### Phase 9: Vertical Completeness — Crouch, Platform Drop-Through

**Goal:** Hold down to crouch. Hold down on a soft platform to drop through.

**States added:** `Crouch`.

**Modules updated:** `movementStates.js`, `collisionSystem.js` (skips collision for one frame on drop-through platforms when the fighter is crouching and tapping down).

**Behavior:** Idle → Crouch when down is held. Crouch → Idle when down is released. If crouching on a drop-through platform and down is tapped, skip collision for one frame and the fighter falls through. The main platform never drops through.

**Verify:** Stand on main platform, press down → crouch, no drop. Stand on a top platform, press down → drop through to the platform or stage below.

---

### Phase 10: The Debug Overlay

**Goal:** See into the engine. Validate everything works.

**Modules created:** `render/debugDraw.js`. Updated: `renderer.js`, `keyboard.js` (toggle key).

**Behavior:** Per-frame overlay shows for each fighter: ECB (collision diamond) outlined in green; current action state name and frame counter as text; velocity vector as a short line; grounded indicator as a colored dot; optional input buffer visualization. A toggle key (e.g., backtick) flips `world.debug`.

**Verify:** Toggle debug on. Confirm every state name is visible, velocity vectors point in expected directions, ECB tracks the fighter, grounded flag flips correctly during jumps and landings.

---

## 12. What We Have After Phase 10

One fighter on a Battlefield-style stage with full movement expression:
- Idle, walk, dash, run, dash stop, turn, crouch
- Jump squat, jump (short hop and full hop), double jump, fall, fast fall, land
- Platform drop-through
- Dash dancing falls out for free
- Momentum preservation falls out for free
- Air drift with proper acceleration curve
- Tip-toe walk speed control from analog stick magnitude

A debug overlay that exposes the entire internal state of the engine for validation.

A codebase of roughly 15–18 files, each with a single clear responsibility, none larger than it should be, with a dependency graph that flows strictly downward.

---

## 13. What This Architecture Enables Next

**A second fighter** is a new JSON config and one extra spawn call in `main.js`. No architecture changes. The state machine handles N fighters from the day it was written.

**Attacks** require one new state file (`attackStates.js`), one new core module (`hitDetection.js`), one new system (`hitSystem.js`), and additions to the fighter shape (damage, stocks). The existing 15 files do not change. The state machine does not need to know attacks exist — it just reads whichever state set the character config references.

**Projectiles** become a new entity type with hitboxes but no input buffer. They live in `world.projectiles` and are ticked by a dedicated system.

**Advanced techniques** — wavedashing, L-cancelling, edge cancelling, moonwalking, platform cancelling — will emerge from the interaction of states and physics, just as they did in Melee. We will not design them. We will discover them.

**A port to Unreal** becomes a translation exercise rather than a rewrite. The World is a struct. Systems are functions. State definitions are data assets. The discipline of writing logic as portable conditionals means most of it transfers line-for-line into C++ or Blueprints.

---

## 14. The Discipline

The hardest part of this project will not be writing code. It will be holding the line.

When a bug appears in jump physics, the temptation will be to add a special case in the physics system. **Resist.** The fix belongs in the state's physics modifier, or in a new transition rule, or in the input buffer query — not in the physics code.

When a new technique is desired, the temptation will be to add a "wavedash" flag and a `if (wavedashing) { ... }` block. **Resist.** If the technique cannot emerge from existing primitives, the primitives are wrong, and the right fix is to generalize the primitives, not to special-case the technique.

When state grows complex, the temptation will be to split states across multiple files. **Resist.** A state is data. Data belongs in data files. Logic for interpreting data belongs in the interpreter.

When a renderer wants to remember where a fighter was last frame, the temptation will be to cache it on the renderer. **Resist.** Add it to the World, or recompute it from the World. The renderer holds no state.

These disciplines are what make the architecture work. The architecture is only as strong as our willingness to honor it.

---

## 15. Summary

We are building a 2D platform fighter in vanilla JavaScript, with no build step, rendered on HTML5 Canvas, structured around a single source of truth (the World) and a single transformation function (`tick`). The engine is decomposed into core primitives that know nothing about the game, systems that bridge primitives with game data, and pure data files that define stages, characters, and states.

Our inspiration is *Super Smash Bros. Melee*, where physics and state machine generality produced gameplay depth nobody designed. Our philosophy is to build the substrate, not the features, and to let depth emerge from the interaction of primitive rules.

We will execute this in ten phases, beginning with an empty game loop and ending with one fully expressive fighter on a Battlefield-style stage. We will not write a line of attack code until movement is right.

This document is the plan.

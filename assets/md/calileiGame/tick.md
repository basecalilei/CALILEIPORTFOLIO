# tick.md

The spine of the engine. This document covers the World (the single mutable container that holds the game), the `tick(world, inputsByFighter)` function (the per-frame transformation that *is* the game), the order systems run in, and the game-loop boundary — the code that turns wall-clock time into game frames, which now exists in two composition roots: the standalone build's `main.js` and the Calilei site's `desktopGame.js`.

Read this before any work that touches `world.js`, `tick.js`, or `main.js`, and before adding a new system. Other deep-dive docs (state machine, physics, collision, input) assume the contract this document defines.

---

## 1. The World

The World is a flat data container. Every value that matters across frames lives on it. The renderer reads it. Systems read and write it. Nothing else stores game state across frames.

```js
{
  frame:    number,                       // monotonic tick counter
  stage:    { solids, platforms, blastZones },
  states:   { Idle, Walk, Dash, ... },    // reference to state data
  fighters: [ Fighter, ... ],
}
```

Field-by-field:

**`frame`** — integer, starts at 0, increments by 1 at the top of every `tick` call. Used by the debug overlay. Game logic doesn't read it (see §7).

**`stage`** — a reference to the stage data object (currently `battlefield`). Holds `solids` (axis-aligned rectangles with `top/bottom/left/right`), `platforms` (one-way lines with `y/x1/x2`), and `blastZones` (the off-stage bounds, currently informational). The reference is set once in `createWorld` and never reassigned during a run.

**`states`** — a reference to the state-definition table (the export from `data/states/states.js`). Indexed by state name: `world.states['Idle']` gives Idle's definition. Like `stage`, this is set once and never reassigned. It's on the World so systems don't have to import state data directly — they read it through the World, which keeps a system file agnostic about which state set is loaded.

**`fighters`** — an array of fighter objects. Currently length 2 — `fighters[0]` is the human-controlled fighter, `fighters[1]` the Phase 13 dummy — and the array supports N from day one. Every system that operates on fighters iterates this array. Order is arbitrary to every system; the one thing positional about it is the input contract: `inputsByFighter[i]` feeds `fighters[i]`, and the composition root decides who feeds whom (see §5).

### Mutability ownership

The World object itself is created once in `main()` and mutated in place forever. Object identity is stable across the whole run — `world` is the same object on frame 0 and frame 1,000,000.

Of its fields:
- `frame` is owned by `tick` and incremented exactly once per call.
- `stage` and `states` are immutable references after creation. If a system writes to them, the layering broke.
- `fighters[i]` is shared mutable state — multiple systems write to different fields of the same fighter object in one tick.

The fighter shape is documented in `dataModel.md`; for the purposes of tick orchestration, treat it as a flat object whose fields are written by different systems in a defined order.

### Notably absent

There is no `entities`, `projectiles`, `hitboxes`, or `effects` array yet. Those will be added when the systems that own them are added (see §9 for the recipe). The World grows by addition, never by restructure — the existing fields are the existing contract.

---

## 2. `tick(world, inputsByFighter) → world`

The game is this function. Every other function exists to serve it, observe its output, or set it up to be called.

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

Four things to notice.

**It returns nothing.** The signature is conceptually `tick(world, inputsByFighter) → world`, but the implementation mutates the World in place and the caller continues to use the same object. Mutation in place is idiomatic in both JS and (the eventual port to) C++, keeps allocation pressure off the hot path, and matches the project's treatment of World identity as stable.

**It takes inputs as a separate, positional parameter.** `inputsByFighter` is an array of snapshots, one per fighter, indexed to `world.fighters` — the Phase 13 widening of the original single-snapshot parameter. Snapshots are *delivered to* the World on this frame (the input system pushes `inputsByFighter[i]` onto `fighters[i]`'s buffer); they aren't *part of* the World between frames. The buffer is. Who produces which snapshot — keyboard for the human, `NEUTRAL_SNAPSHOT` for the dummy — is the composition root's decision; tick and the systems are source-agnostic. See §5 for why this distinction matters.

**It increments `frame` first.** Frame 1 is the first frame any system sees. Frame 0 is the initial state — the spawn position, the Idle action state, an empty input buffer — before any tick has run. This means `frame > 0` inside any system, which is a useful invariant if anything ever needs it.

**The order of system calls is fixed.** Never reordered, never conditional. §3 explains why.

---

## 3. The tick order

```
input → state → physics → collision → hitDetection
```

This order is load-bearing. Each pairwise adjacency exists for a reason, and reversing any pair would change frame semantics in a visible way.

### Why input first

The input system writes the current snapshot to each fighter's buffer. Every downstream system that queries inputs (the state machine's conditions, the physics system's `stickX` read, the collision system's `wantsThroughPlatforms` predicate) reads `inputBuffer[0]`. Running input first means `inputBuffer[0]` is the freshest snapshot when those reads happen.

If input ran last, every condition and predicate would see one-frame-stale input. Pressing jump on frame N would queue for frame N+1. Across a chain of state transitions, the lag would compound and emergent techniques would shift in feel.

### Why state before physics

The state machine evaluates transitions against the freshest input snapshot and updates `actionState` accordingly. Physics then reads the *new* state's modifiers (gravity multiplier, friction multiplier, horizontal mode) and applies them on the same frame.

This is what makes a jump press on frame N produce a physics consequence on frame N — not frame N+1. The press is in the buffer (input ran first), the state machine sees it and transitions to JumpSquat (state ran second), and on the same tick physics applies JumpSquat's modifiers. The 1-frame lag that would otherwise exist between input and consequence doesn't.

Reversing this pair would silently re-time every state transition by one frame. The jump-squat exit window, the dash-back commit, the fast-fall windows — all of these are tuned with the assumption that input-driven transitions are reflected in physics on the same tick.

### Why collision after physics

Physics moves the fighter to a position that may have penetrated a surface. Collision corrects it. If collision ran before physics, the corrections would apply to last frame's penetration, not this frame's — and the order of "where the fighter is at end-of-frame" would be wrong by one tick of velocity.

Collision is also where `grounded` is cleared by the walk-off check. If physics ran after, gravity would be applied to a fighter that was supposed to be grounded but technically wasn't yet, and the first frame of every walk-off would have an inappropriate gravity pulse.

Collision gets the final word on `x`, `y`, `vx`, `vy`, and `grounded`. Whatever it leaves on the fighter is what the renderer draws and what the next frame's input/state systems read.

### Why hitDetection last (Phase 13)

`hitDetectionSystem` moves nobody — it only observes geometry and records contacts. It runs after collision so its overlap tests read **final, resolved positions**. Run before collision, it would test pre-clamp positions and produce false results exactly where precision matters most: at platform edges and wall contacts, where collision moves fighters after physics.

Its output is a write, not a transition: a landed hit writes `pendingHit` onto the victim, and the victim's state machine consumes it on the **next** tick (the universal `hitTaken` transition fires first in every state's list). The 1-frame lag is deliberate. Resolving hits mid-tick would mean the state system's result depends on fighter iteration order — attacker-before-victim and victim-before-attacker would produce different frames. The pending-field pattern keeps every fighter's state evaluation independent within a tick, at the cost of one invisible frame between contact and reaction.

---

## 4. The mutation discipline

Every system follows the same shape: iterate `world.fighters`, read the fields it needs, write the fields it owns. Systems do not call each other. Systems do not import each other. The only thing they share is the World, and the order in `tick.js` determines who sees what.

This is the substrate for everything else in the architecture. If you find yourself wanting one system to call into another, the problem is almost always a missing World field — the value you want to share should live on the World, written by one system and read by the next.

A consequence: two systems can both write to the same fighter field (`vx` is written by physics in walk mode and zeroed by collision on a wall hit) and there's no conflict, because the tick order resolves it. Physics wrote first; collision wrote last; collision's value is what's left at end-of-frame. The pattern is "the last writer in tick order wins for that frame," and it's safe because the order is fixed and known.

The pattern also works *across* ticks: `hitDetectionSystem` writes `pendingHit` at the end of tick N, and `stateSystem` consumes it at the start of tick N+1. Same mechanism — one system writes a World field, another reads it, no direct call — just spanning the tick boundary. This is the template for every future cross-fighter interaction (grab, projectiles).

---

## 5. Why `inputsByFighter` is a parameter

The signature `tick(world, inputsByFighter)` rather than `tick(world)` is a small but deliberate choice. Each input snapshot is *frame-local* — it represents a sampling of an input source at one instant in real time, gets delivered to the simulation, and is then absorbed into a buffer.

If the snapshots lived on the World, they would be the only fields that mean something different on this frame than they did last frame for non-simulation reasons. Whether a `world.currentInputs` is "still valid" depends on whether the game loop has re-sampled its sources since the last tick — and that's a game-loop concern, not a game-state concern.

Keeping it as a parameter draws the boundary clearly:
- The World is the simulation. It evolves by deterministic rules.
- The input array is the *driver* of that simulation, sampled from the outside world and handed in.
- Once `inputSystem` runs, the inputs are part of the simulation (they're in the buffers). Before that, they aren't.

The array is positional — `inputsByFighter[i]` feeds `fighters[i]` — and the composition root builds it. That's the Phase 13 decision about *routing ownership*: "who feeds whom" is a composition concern, not a simulation concern. The rejected alternative (an `inputSource` tag on each fighter, dispatched inside `inputSystem`) would have taught a system about source types; instead `inputSystem` is a dumb positional dispatcher, and swapping the dummy for a second player, an AI, or a replay stream is a one-line change in the root.

This also makes `tick(world, inputsByFighter) → world` a pure-ish function from the caller's point of view: given a World and the frame's snapshots, the next World is determined. That's the shape that rollback netcode and deterministic replay both want.

---

## 6. System contracts

What each system reads and writes on the fighter. Fields not listed are not touched. The renderer and overlay are downstream of the tick and read everything; they appear here for completeness.

| System               | Reads                                                                | Writes                                                |
|----------------------|----------------------------------------------------------------------|-------------------------------------------------------|
| `inputSystem`        | `inputsByFighter[i]`                                                 | `inputBuffer[0]` (pushes, evicts oldest)              |
| `stateSystem`        | `actionState`, `stateFrame`, `inputBuffer`, `grounded`, `vx`, `vy`, `facing`, `airJumpsUsed`, `airDodgesUsed`, `pendingHit`, `pendingHitstunFrames`, `damage`, `world.states`, `config.attacks`, `config.physics` | `actionState`, `stateFrame`, plus whatever effects mutate (`vx`, `vy`, `facing`, `airJumpsUsed`, `airDodgesUsed`, `damage`, `pendingHitstunFrames`, `pendingHit` → null)    |
| `physicsSystem`      | `actionState`, `grounded`, `vx`, `vy`, `inputBuffer[0]`, `facing`, `config.physics`, `world.states[...].physics` | `vx`, `vy`, `x`, `y`, `facing` (walk mode only)       |
| `collisionSystem`    | `x`, `y`, `vx`, `vy`, `grounded`, `actionState`, `inputBuffer[0]`, `world.stage`, `world.states[...].physics.respectPlatforms` | `x`, `y`, `vx`, `vy`, `grounded`                       |
| `hitDetectionSystem` | both fighters' `x`, `y`, `facing`, `actionState`, `stateFrame`, `config.attacks`, `config.hurtboxes`, `world.states[...].physics.intangible` | victim's `pendingHit`, attacker's `hitConnected`       |

A few things worth flagging from this table:

**`facing` is written by both `stateSystem` (via commit effects) and `physicsSystem` (in walk mode only).** State writes facing on commit transitions (`commitFacingFromSlam` for the dash family, `commitFacingFromLightAttackPress` for side/forward attacks); physics rewrites it every frame in walk mode to track stickX. Air mode deliberately does **not** touch facing — a facing-commit line lived there from Phase 4 to Phase 12 as a latent copy-paste bug and was deleted when it made back-airs unreachable. Direction is sometimes a discrete commit (slam, attack press) and sometimes a continuous follow (walk); in the air it's commit-only.

**`stateSystem` mutates physics fields through effects.** When `applyJumpImpulse` fires on the JumpSquat → Fall transition, it writes `vy`. That happens inside the state phase, before physics runs. Physics then sees that vy and integrates it. This is the path by which input → state transition → impulse → physical consequence completes in one tick. `applyHitReaction` is the biggest such effect: it writes `vx`, `vy`, `damage`, `pendingHitstunFrames`, and clears `pendingHit`, all at the moment the `hitTaken` transition fires.

**`physicsSystem` writes `x` and `y` (via `integrate`), then `collisionSystem` overwrites them when a hit fires.** Physics is the "tentative" position writer; collision is the corrective one. Between physics and collision, a fighter can briefly be inside a wall — the renderer doesn't run mid-tick, so this is never observed.

**`hitDetectionSystem` writes across fighters.** It's the one system whose writes land on a *different* fighter than the one being iterated (the victim's `pendingHit`) — the engine's only cross-fighter data flow, mediated entirely through World fields like everything else. `hitConnected` is its private scratchpad: written and reset here, read by no condition, invisible to the state machine on purpose.

**Nothing writes `frame` except `tick` itself.** Nothing writes `stage` or `states` after `createWorld`. Nothing writes `config` after `createFighter` (the fighter holds a reference to character data, which is immutable).

---

## 7. `stateFrame` and `frame` — two counters, different jobs

The fighter has `stateFrame`. The World has `frame`. They serve different purposes and don't share semantics.

**`stateFrame`** counts how many frames the fighter has been in its current action state. The state machine resets it to 0 when a transition fires and increments it by 1 on every frame no transition fires. It's the counter that conditions like `durationElapsed` read (`stateFrame + 1 >= duration`, where duration comes from `config.attacks[state].duration` for attacks or `state.duration` for movement states) and that `hitstunFinished` compares against the per-hit `pendingHitstunFrames`. It's how the engine knows "JumpSquat has lasted 3 frames, exit." Game logic counts in `stateFrame`. Frame data is expressed in `stateFrame`. Animation timing, when animations exist, will be driven by `stateFrame`.

**`frame`** is the global tick counter. It exists for the debug overlay (which shows "Frame: 14,221" to let you correlate live observation with the 20-frame history panel) and for any future external observers — replay tooling, performance instrumentation, telemetry. Game logic doesn't read it. There is no condition that fires on `frame % 60 === 0` and there should not be. Anything that wants to fire on a schedule fires on a `stateFrame` count, gated by a state.

The discipline: if you're writing a condition or effect that reads `world.frame`, stop. The right value is almost certainly `stateFrame`, and if it isn't, the rule probably wants to live somewhere other than the state machine.

---

## 8. The game loop — two of them, one contract

`tick` is called by a game loop whose job is to translate real wall-clock time into a fixed sequence of frames, regardless of monitor refresh rate. There are two such loops — the standalone build's in `main.js`, and the embedded build's in the site's `desktopGame.js` — and they are deliberately near-identical.

### The standalone loop (`main.js`)

```js
let lastTime = performance.now();
let accumulator = 0;

function loop(now) {
  const elapsed = now - lastTime;
  lastTime = now;
  accumulator += elapsed;

  const maxAccum = MS_PER_FRAME * MAX_PENDING_FRAMES;
  if (accumulator > maxAccum) accumulator = maxAccum;

  const inputsByFighter = [getCurrentInput(), NEUTRAL_SNAPSHOT];

  while (accumulator >= MS_PER_FRAME) {
    tick(world, inputsByFighter);
    accumulator -= MS_PER_FRAME;
  }

  render(world, ctx);
  drawOverlay(world, ctx);
  requestAnimationFrame(loop);
}
```

This is the only place wall-clock time enters the program. `performance.now()` is allowed here; it is not allowed inside any system that `tick` calls into.

**Fixed-timestep accumulator.** `tick` runs at exactly 60Hz, defined by `MS_PER_FRAME = 1000 / 60`. The accumulator pattern decouples tick frequency from rAF frequency: a 144Hz monitor calls `loop` 144 times per second but only ticks 60 times per second, with rAF calls in between just re-rendering the World. A 30Hz tab (e.g., backgrounded) calls `loop` 30 times per second but accumulates enough time to tick twice per call. In all cases, sim speed is identical.

**Spiral-of-death cap.** `MAX_PENDING_FRAMES = 5` is the cap on how many ticks can be queued in one rAF call. Without it, a tab returning from being backgrounded for two seconds would try to catch up with 120 ticks in one rAF call, freezing the page. The cap accepts a brief time skip over an unresponsive page. The correct tradeoff.

**Inputs sampled once per rAF.** The `inputsByFighter` array is built before the `while` loop, and the same snapshots feed every tick in that loop. If two ticks happen in one rAF call (a slightly delayed frame), they see the same input. Sub-frame input precision would require sampling between ticks and queueing — out of scope for human input on a 60Hz target. The dummy's slot is `NEUTRAL_SNAPSHOT`, the engine's frozen all-at-rest instance of the snapshot contract.

**Render is decoupled from tick.** Rendering happens once per rAF, regardless of how many ticks ran. On a 144Hz monitor in normal conditions, render runs ~144 times per second on a World that updates 60 times per second — the same World gets drawn ~2.4 times per update on average. This is correct: rendering reads, never writes, and the canvas refreshes at the display's pace while the simulation advances at its own.

### The embedded loop (`desktopGame.js`, site repo)

The Calilei site's desktop-window host runs its own loop as an alternate composition root. Everything above holds by construction: it copies the same clock constants (`TARGET_FPS`, `MS_PER_FRAME`, `MAX_PENDING_FRAMES`), consumes the same vsync-aligned rAF timestamps, builds the same positional `[buildSnapshot(), NEUTRAL_SNAPSHOT]` array (from its own focus-scoped listeners — see `input.md`), and drains the accumulator identically. Smoothness and sim-speed parity with the standalone build are structural, not tuned.

What it adds is **liveness** — a concern the engine doesn't have. The embedded loop only runs while the game window's surface holds DOM focus; blur, minimize, and scrolling the desktop away all stop the loop with the last frame left painted. On resume, the accumulator is **cleared**: a resumed game continues from where it paused rather than replaying a catch-up burst of every missed frame. (The standalone build gets the equivalent for free — a backgrounded tab stops receiving rAF callbacks, and the cap eats the backlog on return.) It also repaints its inspector window after each render, replacing the overlay's text panels; the engine neither knows nor cares.

**What this means for determinism.** Inside `tick`, no system ever reads `performance.now()`, `Date.now()`, or `Math.random()`. Whichever loop is running handles all wall-clock translation; once `tick` is called, the only inputs are the World and the snapshots, and the only outputs are mutations to the World. Replay, rollback, and bit-exact reproduction all rely on this boundary holding — in both hosts.

---

## 9. Recipe: adding a new system

Adding a system is a five-step change. Most steps are one line.

1. **Create the file.** `src/systems/yourSystem.js`. Export a single function `yourSystem(world)` (or `yourSystem(world, inputs)` if it needs the snapshot directly, like `inputSystem` does). Inside, iterate `world.fighters` and operate on each one. Import primitives from `core/` as needed.

2. **Decide what World fields it reads and writes.** If it needs a new field on the fighter or the World, add it — preferably in the existing factory (`createFighter`, `createWorld`) so every fighter and every world is created with the field present. If the field belongs on state data instead, add it to the appropriate state definitions in `data/states/states.js` (see `dataModel.md` for the choice between fighter and state).

3. **Pick its slot in the tick order.** The order is input → state → physics → collision → hitDetection. New systems slot in based on what they need to see and what should see them.
   - Anything that *produces a state transition input* (a new kind of event the state machine should react to) runs before `stateSystem` — unless it needs resolved positions, in which case it runs late and writes a pending field the state machine consumes next tick, like `hitDetectionSystem` does. Cross-fighter interactions (grab, projectile contact) will follow the hitDetection template.
   - Anything that *consumes a finalized state* (a renderer's input, an animation update, an audio cue) runs after the last system. Often this isn't a tick-phase system at all — it's downstream of tick entirely (renderer, overlay).
   - Anything that *operates on a separate entity type* (projectiles) usually runs as its own block within tick, often between state and physics so its own state transitions can drive its physics on the same frame.

4. **Wire it into `tick.js`.** Import the function. Add it to the `tick` body in the correct order slot. That's one import line and one call line.

5. **Verify in the overlay.** Whatever fields the system writes should be visible in the live stats panel or addable to it. If a transition or behavior is changing, watch the history panel for the frame where it fires. The overlay is the primary test instrument for a new system. (If the field should also be visible in the site's embedded inspector, that's a hand-added row in `desktopGame.js` — the inspector doesn't discover fields automatically.)

If adding the system requires changes anywhere else — to `physics.js`, `collision.js`, `stateMachine.js` — the system probably wasn't well-bounded. Pause and ask whether the change belongs in one of those primitives or whether the system is doing the wrong thing.

---

## 10. Load-bearing decisions

The decisions that, if reversed, would silently cascade.

**The tick order: input → state → physics → collision → hitDetection.** Changing it would re-time frame semantics across the entire engine. See §3 for the per-pair rationale.

**`tick` mutates the World in place.** The World's object identity is stable across all frames. Code that compares World references (the `window.world` console hook, future debug tooling, future rollback storage) relies on this.

**`frame` increments at the top of `tick`, before any system runs.** Frame 1 is the first frame any system sees. Frame 0 is pre-tick initial state. If anything ever cares about "the first frame a fighter exists," that frame is 1, not 0.

**Inputs are a positional parameter, not a World field.** Drawing the boundary clearly between simulation state and the frame's input drivers is what keeps the simulation deterministic and each loop's responsibility for input sampling localized. And the *positional* part is its own decision: `inputsByFighter[i]` → `fighters[i]`, routing owned by the composition root, `inputSystem` a dumb dispatcher. Both roots build the same array shape.

**`pendingHit` is consumed next-tick, by design.** Hit reactions go through the state machine (the universal `hitTaken` transition), not through direct mutation inside `hitDetectionSystem`. The 1-frame lag keeps fighter state evaluation order-independent within a tick. Collapsing it — reacting to hits inside the detection pass — would make frame results depend on fighter iteration order.

**Systems do not import each other.** All communication is through World fields. The order in `tick.js` is the entire coordination mechanism. A direct call from one system into another bypasses the order discipline and is the seed of every architectural breakdown.

**The renderer is downstream of `tick`, not part of it.** Render reads, never writes. Adding a render call inside tick (or anything that allocates DOM/canvas work inside tick) would couple sim speed to render cost. Don't.

**`window.world = world` in `main.js`.** Load-bearing for every bug investigation. The user inspects `world.fighters[0].actionState`, `world.fighters[0].inputBuffer[0]`, etc. from DevTools without needing any debug infrastructure inside the simulation. Don't remove it.

**`MAX_PENDING_FRAMES = 5`.** The cap that prevents catch-up spirals when a tab returns from being backgrounded. Removing the cap would make the page freezable by any system pause. Raising it would mean longer catch-up bursts after stalls. Five frames (~83ms) is the comfortable upper bound for "instantaneous catch-up without visible lag spike." The embedded loop copies the same constant — clock parity between hosts is part of the contract.

**Resume clears the accumulator (embedded loop).** Pause means pause: a game refocused after a minute doesn't replay a burst of catch-up frames, it continues. If the standalone build ever gains explicit pause, it should adopt the same rule.

---

## 11. When to revisit this doc

Update this document when:

- A new system is added (the contracts table grows).
- A new top-level World field is added (the World shape section grows).
- The tick order changes (don't, but if you do, the rationale in §3 must be rewritten).
- Either game loop's structure changes (e.g., separating render from rAF, adding a fixed-tick worker, changing the input-sampling cadence, changing the liveness rules in `desktopGame.js`).
- A new composition root appears (a third host means a third loop bound by the same contract).
- A new entity type joins the World (projectiles), in which case it appears here and gets its own deep-dive.

The doc is the contract. If the code does something this doc doesn't describe, one of them is wrong.

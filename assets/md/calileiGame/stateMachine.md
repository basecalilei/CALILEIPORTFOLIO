# stateMachine.md

The state machine is the engine's central abstraction for "what is this fighter doing right now and what can it do next." It runs once per fighter per tick, between input and physics. It is also the area where most work lands — Phases 12 and 13 added ten attack states, a Hitstun state, eight conditions, and three effects here while changing the interpreter zero times. Every future action (a grab, a shield, a recovery move) is a new state, often with new conditions and new effects.

This document covers the interpreter in `core/stateMachine.js`, the state shape defined in `data/states/states.js`, the conditions registry in `core/conditions.js`, the effects registry in `core/effects.js`, and the rules that hold the four together. It also gives end-to-end recipes for adding states, conditions, and effects.

Read this before any work that touches state behavior, transition logic, or input-driven action changes. The conventions here are unusually load-bearing — small misunderstandings about frame timing or evaluation order produce bugs that look like physics bugs.

---

## 1. The shape

The state machine has four pieces:

- **The interpreter** (`core/stateMachine.js`) — one function, `transition(fighter, states)`. Generic. Knows nothing about specific states, conditions, or effects.
- **The state data** (`data/states/states.js`) — one entry per action. Pure data.
- **The conditions registry** (`core/conditions.js`) — named functions `(fighter, state) → boolean`.
- **The effects registry** (`core/effects.js`) — named functions `(fighter) → void`.

The data references the registries by string name. The interpreter resolves the names to functions and calls them. Adding a state, condition, or effect touches one of these files — never the interpreter.

---

## 2. The state definition

```js
Walk: {
  name: 'Walk',
  duration: 0,
  physics: { gravity: 1.0, friction: 0, horizontalMode: 'walk' },
  transitions: [
    { when: 'hitTaken',          to: 'Hitstun', effect: 'applyHitReaction' },
    { when: 'notGrounded',       to: 'Fall' },
    { when: 'jumpPressed',       to: 'JumpSquat' },
    { when: 'lightAttackPressedUp',   to: 'LightUpGround' },
    { when: 'lightAttackPressedDown', to: 'LightDownGround' },
    { when: 'lightAttackPressedSide', to: 'LightSideGround', effect: 'commitFacingFromLightAttackPress' },
    { when: 'lightAttackPressed',     to: 'LightNeutralGround' },
    { when: 'crouchInput',       to: 'Squat' },
    { when: 'stickSlammed',      to: 'Dash', effect: 'commitFacingFromSlam' },
    { when: 'noHorizontalInput', to: 'Idle' },
  ],
  render: { color: '#e06060' },
}
```

The key is the action name (`Walk`). The fighter's `actionState` holds this key as a string. The value is the definition.

**`name`** — A copy of the key, present so error messages and the debug overlay can read it without a lookup. The interpreter doesn't use it; it's authoring discipline. Keep it in sync with the key.

**`duration`** — Number of frames the state is active before `durationElapsed` can fire. `0` means "no automatic exit; the state ends only via other conditions." Walk, Idle, Run, Squat, Fall, AirJump, FastFall all have `duration: 0` — they're held until something else transitions them out. JumpSquat (3), Land (4), Dash (10), DashBack (10), DashStop (4), AirDodge (20) have fixed durations authored here. **Attack states are the exception:** their durations live on `character.attacks[stateName].duration` (character tuning, not state shape — see `dataModel.md`), and `durationElapsed` consults the character first. **Hitstun is the other exception:** it has no authored duration at all — its exit is the dynamic `hitstunFinished` condition reading a per-hit runtime field. See §5 for the exact frame semantics of all three.

**`physics`** — The state's physics modifiers. Read by `physicsSystem` every tick the fighter is in this state. `gravity` and `friction` are multipliers on the character's base values. `horizontalMode` is one of `'none' | 'walk' | 'air' | 'dash'`. `fallSpeedMax` (optional) caps downward velocity for airborne states. `respectPlatforms` (optional) opts out of drop-through — twelve states use it (AirDodge, Land, all ten attacks). `intangible` (optional) removes the fighter from hit detection and hurtbox rendering — AirDodge is the current user. Details belong to `physics.md` and `collision.md`; the state machine itself doesn't read this field.

Note what's *not* here: hitbox geometry, damage, knockback values, hitstun. Attack tuning is character data (`config.attacks[stateName]`), consumed by `hitDetectionSystem` and `durationElapsed` — the state entry for an attack declares only its shape (physics, transitions, color).

**`transitions`** — A priority-ordered list of exit conditions. Each entry is `{ when, to, effect? }`. `when` is a condition name resolved through the conditions registry. `to` is the destination state's key. `effect` (optional) is an effect name resolved through the effects registry. Order is significant — see §4.

**`onEnter`** — Documented in the architecture as an optional effect that fires at the moment of state entry, regardless of which transition led there. **The interpreter does not currently honor this field.** The current data does not use it. Every state-entry effect is attached to a transition instead, which lets it fire only when the entry came from a specific source (and gives it access to the buffer state at the moment of that transition). If a future state needs an entry effect that should run identically regardless of source, wiring `onEnter` into the interpreter is a four-line change — fire `state.onEnter` after the actionState assignment. Until then, the field is documented-but-inert.

**`render.color`** — Optional. Per-state color override read by `renderer.js`. Falls back to `fighter.config.color` when absent. The state machine doesn't read this either; it lives on the state definition because the visual identity of an action is part of the action.

A state definition is pure data. It can be diffed, serialized, hot-reloaded, and shared. Nothing on a state changes at runtime — it's a reference, not a copy.

---

## 3. The interpreter

```js
export function transition(fighter, states) {
  const state = states[fighter.actionState];
  if (!state) { throw new Error(...); }

  for (const t of state.transitions) {
    const cond = conditions[t.when];
    if (!cond) { throw new Error(...); }

    if (cond(fighter, state)) {
      if (t.effect) {
        const eff = effects[t.effect];
        if (!eff) { throw new Error(...); }
        eff(fighter);
      }
      fighter.actionState = t.to;
      fighter.stateFrame = 0;
      return;
    }
  }

  fighter.stateFrame += 1;
}
```

The whole thing. Thirty lines including error handling.

What it does, prose:

1. Look up the current state by name.
2. Walk the transitions list in order.
3. For each transition, look up its condition and call it with `(fighter, state)`.
4. If the condition returns true: look up the effect (if any) and call it with `(fighter)`. Then change `actionState` to the destination and reset `stateFrame` to 0. Return.
5. If no condition matched, increment `stateFrame` by 1.

What the interpreter never does: chain transitions, evaluate multiple transitions on the same frame, special-case a state by name, hold any state of its own, read inputs directly, mutate physics fields directly.

### Effects fire before the state assignment

The order inside the matching block is exact: `eff(fighter)` runs first, then `actionState = t.to`. This means an effect can read `fighter.actionState` and will see the *source* state name, not the destination. It can also read `fighter.stateFrame` and see the source state's frame count. It can read `fighter.inputBuffer` and see the input that triggered the transition.

This is what makes `commitFacingFromSlam` work cleanly: at the moment it fires, the buffer reflects the stick slam that the `stickSlammed` condition just matched on. The effect reads `buf[0].stickX`, takes its sign, and writes it to `fighter.facing`. The destination state (Dash, DashBack) then reads `facing` in its physics mode and produces motion in that direction.

If effects ran after the assignment, they'd see the new state with `stateFrame: 0` and have no context for what just happened. They'd also have to re-derive the trigger condition's data — and they can't, because `actionState` doesn't carry that information.

### No-chain rule

When a transition fires, the function returns immediately. The new state's transitions are *not* evaluated on the same tick. The new state's first transition check happens on the next call to `transition`, one frame later.

This is load-bearing:

- It prevents infinite loops. Without the return, a pair of states whose transition conditions always match each other (A → B, B → A) would loop forever inside one tick.
- It guarantees every state gets at least one frame of physics. A state entered on tick N has its physics modifiers applied during the same tick's `physicsSystem` call. Without the no-chain rule, a state that immediately transitioned out would never apply its physics.
- It makes transition timing predictable. The frame at which a state's transitions evaluate is exactly the tick after entry, every time.
- It matches how Melee's state machine behaves.

The implication for design: if you want a chain like A → B → C to happen quickly, design B with a `duration: 1` and a `durationElapsed` transition to C. That gives B exactly one frame of existence (and one frame of its physics) before becoming C. If you want A → C with B as a transient effect that never has its own physics tick, B shouldn't be a state at all — fold the work into a transition effect on A → C.

---

## 4. Transition priority

The transitions list is evaluated top to bottom; the first matching condition wins. Multiple conditions can be true on the same frame, and order determines which transition fires.

Walk's transitions:

```js
transitions: [
  { when: 'hitTaken',          to: 'Hitstun', effect: 'applyHitReaction' },
  { when: 'notGrounded',       to: 'Fall' },
  { when: 'jumpPressed',       to: 'JumpSquat' },
  { when: 'lightAttackPressedUp',   to: 'LightUpGround' },
  { when: 'lightAttackPressedDown', to: 'LightDownGround' },
  { when: 'lightAttackPressedSide', to: 'LightSideGround', effect: 'commitFacingFromLightAttackPress' },
  { when: 'lightAttackPressed',     to: 'LightNeutralGround' },
  { when: 'crouchInput',       to: 'Squat' },
  { when: 'stickSlammed',      to: 'Dash', effect: 'commitFacingFromSlam' },
  { when: 'noHorizontalInput', to: 'Idle' },
]
```

`hitTaken` is first — in this state and in all 24. Getting hit preempts everything, including going airborne: a fighter walking off an edge on the same frame a hit lands enters Hitstun, not Fall. This entry is the universal transition (see below).

`notGrounded` is next. Walking off the edge of a platform clears `grounded` in collision. On the next tick, `notGrounded` is true. If `jumpPressed` is also true (the player pressed jump in the same frame they walked off), `notGrounded` still wins — once airborne, the action is Fall, not JumpSquat. The jump press will be reconsidered as `canAirJump` once the fighter is in Fall.

`jumpPressed` before `crouchInput`. Both can be true if the player holds down on the stick and presses jump. The discrete intent (a button press) wins over the sustained state (a held stick).

**The attack ladder: directional variants before the neutral fallback.** `lightAttackPressedUp/Down/Side` are all narrower reads of the same press that `lightAttackPressed` matches broadly. If neutral came first, it would always win and the tilts would be unreachable. Specific-before-general isn't just style here — it's what makes the directional attacks exist. The same press with up held fires `…Up`; with no direction held, it falls through three variants to the neutral jab.

`stickSlammed` before `noHorizontalInput`. These are mutually exclusive in practice (stickSlammed requires `now.stickX !== 0`, noHorizontalInput requires `now.stickX === 0`), so the order doesn't fire-vs-not-fire matter — but the ordering reads correctly as "specific intent first, default last."

`noHorizontalInput → Idle` is the fallback. Walk is held only as long as the stick is held; releasing it returns to Idle.

The general principle: **hit reactions before everything, then specific transitions before default transitions, discrete inputs before sustained inputs, exits-to-airborne before ground actions, directional attack variants before the neutral attack.** Reading any state's transition list top-to-bottom should read like "the most important reason to leave first, the most default reason last."

### The universal `hitTaken` transition (Phase 13)

Every state's first transition is `{ when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' }` — all 24 states, inserted mechanically via a regex pass. This is a *pattern*, not an interpreter feature: the alternative (the interpreter auto-checking `pendingHit` before consulting per-state transitions) was rejected because explicit-in-data means a reader of `states.js` sees that a hit can happen, and a per-state override remains possible — a future armor state ignores hits by *changing or omitting its entry*, visibly, rather than by fighting hidden interpreter magic.

Two entries are worth noticing. Hitstun itself lists `hitTaken → Hitstun` as a self-transition: a hit landing during hitstun re-fires `applyHitReaction`, overwriting the launch and the timer, and the interpreter's transition mechanics reset `stateFrame` — re-hits and combos work with zero combo code. And states like AirDodge carry the entry redundantly (their `intangible` flag prevents `pendingHit` from ever being written) — harmless, defensive, and cheaper than remembering which states are exempt.

Future universal transitions (grab-taken, hazard-taken) should follow the same wiring pattern.

### Dash, DashBack, Run share transitions with one substitution

```js
Dash: {
  transitions: [
    { when: 'notGrounded',            to: 'Fall' },
    { when: 'jumpPressed',            to: 'JumpSquat' },
    { when: 'crouchInput',            to: 'Squat' },
    { when: 'stickReverseFromFacing', to: 'DashBack', effect: 'commitFacingFromSlam' },
    { when: 'noHorizontalInput',      to: 'DashStop' },
    { when: 'durationElapsed',        to: 'Run' },
  ],
}

DashBack: {
  // identical to Dash except stickReverseFromFacing targets Dash (a re-reverse goes back to forward Dash)
}

Run: {
  // identical to Dash except there's no durationElapsed (Run is duration: 0, held indefinitely)
}
```

The three "moving forward on the ground" states share most of their transition list. The variation is small and meaningful: Dash and DashBack are timed bursts that fall into Run after their duration; Run is the indefinite state held until the player changes direction or releases. The repetition is deliberate — every state's transitions are listed explicitly, so reading any single state's definition tells you everything about how it can exit. There's no inheritance mechanism, and adding one would be the wrong move (it would couple state definitions to each other and break the "a state is data, not a module" rule).

When you find yourself copy-pasting the same five transitions into a new state, ask whether the destinations and effects are *actually identical* to an existing state. If they are, the new state is probably already covered by an existing one with a different physics modifier. If they're meaningfully different — even by one entry — the copy-paste is correct and meaningful, not a refactoring opportunity.

---

## 5. Frame timing and `durationElapsed`

`stateFrame` counts how long the fighter has been in the current state. It is `0` on entry and increments by 1 on every tick where no transition fires (see §3, last line of the interpreter).

`durationElapsed` is the condition that reads the duration and fires when the count is reached. Since Phase 12 it consults the character's attack table before the state's own field:

```js
durationElapsed: (f, s) => {
  const attackDuration = f.config.attacks?.[s.name]?.duration;
  const duration = attackDuration ?? s.duration;
  return duration > 0 && f.stateFrame + 1 >= duration;
},
```

For movement states, `config.attacks` has no entry and the state's authored `duration` applies — the original semantics, unchanged. For attack states, the character's number wins, and there is deliberately no state-side fallback authored for attacks: a missing `attacks` entry means `duration` resolves to the state's (absent) field, the state hangs, and the bug is loud. That's the intended failure mode — see `dataModel.md` on character-as-source.

The `+1` is what makes "duration: N" mean "the state is active for exactly N ticks." Walking through JumpSquat with `duration: 3`:

| Tick | actionState   | stateFrame before transition | Condition check         | Result                     |
|------|---------------|------------------------------|-------------------------|----------------------------|
| K    | JumpSquat (just entered) | 0                | `0 + 1 = 1 >= 3` false  | no transition; stateFrame → 1 |
| K+1  | JumpSquat     | 1                            | `1 + 1 = 2 >= 3` false  | no transition; stateFrame → 2 |
| K+2  | JumpSquat     | 2                            | `2 + 1 = 3 >= 3` true   | fire JumpSquat → Fall, applyJumpImpulse |

JumpSquat occupies ticks K, K+1, K+2 — three ticks of physics with the JumpSquat modifiers (gravity: 0, friction: 0, horizontalMode: 'none'). On tick K+3, the fighter is in Fall with `stateFrame: 0` and the upward velocity from `applyJumpImpulse` already applied.

If `durationElapsed` were `stateFrame >= duration` without the `+1`, JumpSquat would be active for four ticks. Every fixed-duration state in the engine is tuned to the current semantics: changing the formula would re-time JumpSquat, Land, Dash, DashBack, DashStop, and every future fixed-duration state.

**`duration: 0` is special.** The condition's `duration > 0` guard is what makes `durationElapsed` never fire for non-timed states. Walk, Idle, Fall, Run — they all have `duration: 0` and rely entirely on other conditions for exits. You can list `durationElapsed` in a `duration: 0` state's transitions; it just never fires. The current data doesn't do this (it's clearer to omit), but it's not a bug if it appears.

**Dynamic durations get their own condition, not an extended `durationElapsed` (Phase 13).** Hitstun's length varies per hit, so no authored duration can express it. The pattern: `applyHitReaction` writes the per-hit value to a fighter-runtime field (`pendingHitstunFrames`), and a sibling condition gates the exit —

```js
hitstunFinished: (fighter) =>
  fighter.stateFrame >= fighter.pendingHitstunFrames,
```

`durationElapsed` reads authored data ("this state's fixed lifetime has elapsed"); `hitstunFinished` reads runtime data ("this hit's dynamic lifetime has elapsed"). Different semantics, different names — extending `durationElapsed` to also check runtime fields would have muddied the one condition every fixed-duration state depends on. Note the comparison is `>=` with no `+1`: a `pendingHitstunFrames` of 0 (the defensive `?? 0` case for an attack authored without hitstun) exits on the first evaluation rather than paralyzing the fighter. Hitlag will reuse this exact pattern in 13b.

**State data and `stateFrame` are different layers.** State data describes what the duration *means*; `stateFrame` is where the count currently is. Two fighters in the same state at the same tick can have different `stateFrame` values; they share the same state definition. See `dataModel.md` §6 (the worked `stateFrame` example) for why this is on the fighter rather than on state data.

---

## 6. The conditions registry

A condition is `(fighter, state) → boolean`. Most conditions read fighter fields and the fighter's input buffer. A few read state data (only `durationElapsed` currently does). Condition signatures use `_s` to mark the state parameter as unused when it's only there to satisfy the interface.

### Current conditions

**Fighter-field reads.** Direct reads of fighter state, no input involvement.

- `grounded` — `f.grounded`
- `notGrounded` — `!f.grounded`

**Current-snapshot reads.** Read the freshest snapshot (`f.inputBuffer[0]`) and answer a question about it. No buffer history.

- `horizontalInput` — `stickX !== 0`
- `noHorizontalInput` — `stickX === 0`
- `crouchInput` — `stickY > 0` (Y-down: down on the stick means positive Y)
- `notCrouchInput` — `stickY <= 0`

**Buffer-history reads.** Walk the buffer looking for a pattern.

- `jumpPressed` — uses `wasPressedWithin(buffer, 'jump', 5)`. True if jump went false → true within the last 5 snapshots. This is a rising-edge detector with a tolerance window.
- `lightAttackPressed` — `wasPressedWithin(buffer, 'lightattack', 5)`. The neutral-attack detector and the broad match the directional variants narrow.
- `stickSlammed` — true if `now.stickX !== 0` and any of the last 5 snapshots show a neutral → direction transition. The current snapshot must be non-neutral; the recent history must contain a neutral. This is the "deliberate stick slam" pattern.
- `fastFallTriggered` — combines two windows. The "fresh" path: if any of `buf[1..FRESH-1]` is neutral on stickY, the current down-press is fresh and fires. The "commit" path: if down has been held for `COMMIT` consecutive frames, fire anyway. Also requires `vy >= -5` — can't fast-fall while ascending sharply. The two windows distinguish "tapped down at apex" from "dropped through and kept holding."

**Press-context reads (Phase 12).** Find the press with `pressIndex`, then read *other fields of the snapshot at the press frame*. The press carries its own context — the stick as it was at the moment of commitment, not as it is when the state machine evaluates.

- `lightAttackPressedUp` / `…Down` — `pressIndex(buffer, 'lightattack', 5)` then `buf[idx].stickY < 0` / `> 0`.
- `lightAttackPressedSide` — same, `buf[idx].stickX !== 0`. Ground-only; pairs with the facing-commit effect.
- `lightAttackPressedForward` / `…Back` — the aerial pair: `buf[idx].stickX * f.facing > 0` / `< 0`. Direction is *relative to facing*, and no effect commits anything — aerials read facing, they never write it. The forward/back split is what makes B-air a distinct move, and it only works because air physics leaves `facing` alone (see `physics.md`).

Note the variants deliberately over-match in combination — up-forward makes both `…Up` and `…Forward` true. The source state's transition *order* resolves which attack fires (up-tilts rank above forward-tilts, matching Melee's priority), which is why the ladder ordering in §4 is load-bearing.

**Compound conditions.** Combine multiple reads.

- `canAirJump` — `wasPressedWithin(buffer, 'jump', 3)` AND `airJumpsUsed < maxAirJumps`. Uses a shorter window than `jumpPressed` because the original ground-jump press would otherwise auto-promote to an air jump on the first Fall frame.
- `canAirDodge` — `wasPressedWithin(buffer, 'shield', 3)` AND `airDodgesUsed < maxAirDodges`. Mirrors `canAirJump`'s shape. The 3-frame window forestalls the same problem for ground-shield (when ground-shield arrives in combat): a ground-shield press shouldn't auto-promote into an air-dodge on the first frame after walking off the edge.
- `stickReverseFromFacing` — `now.stickX !== 0` AND `sign(stickX) === -facing`. Reads the current snapshot and a fighter field.

**Runtime-event reads (Phase 13).** Read fighter-runtime fields that other systems write.

- `hitTaken` — `fighter.pendingHit !== null`. The simplest condition in the registry, and the bridge between the two halves of combat: `hitDetectionSystem` writes the field at the end of tick N, this condition sees it at the start of tick N+1. No input, no state data — a pure event flag.
- `hitstunFinished` — `stateFrame >= pendingHitstunFrames`. The dynamic-duration exit (see §5).

**State-aware conditions.** Read the state parameter.

- `durationElapsed` — the character-consult version shown in §5. Still the only condition using the state parameter — now to key into `config.attacks` by state name as well as to read `s.duration`.

### Why the windows are different

`JUMP_BUFFER_FRAMES = 5` and `AIRJUMP_BUFFER_FRAMES = 3` are different on purpose. If both were 5, pressing jump on the ground and then immediately walking off the edge would consume the press twice — once as the ground jump (correctly), and once again as an air jump on Fall's first frame (incorrectly), because the rising edge is still within the 5-frame window. The shorter air-jump window means the original ground-jump press has fallen out of the air-jump scan window before Fall has a chance to fire `canAirJump`. The same buffer entry doesn't double-fire.

`AIRDODGE_BUFFER_FRAMES = 3` is set to the same value for the same reason: a future ground-shield press should not carry into the first airborne frame and auto-promote into an air-dodge. The shield button doesn't currently have a ground consumer, so the bug doesn't manifest today, but the window is set conservatively for when ground-shield arrives.

`FAST_FALL_FRESH_WINDOW = 3` is the structural maximum, not a feel knob. The drop-through case puts the original down-press at `buf[2]` (Fall's first transition check happens 2 frames after the press). Any `FRESH > 3` would scan past the press and see the pre-press neutral, misclassifying drop-through carryover as a fresh apex press and firing fast-fall the moment vy crosses zero. `FAST_FALL_COMMIT_FRAMES = 6` is the feel knob — how many frames of sustained down the player must hold before the carryover commits.

### The condition patterns

When adding a new condition, classify it into one of these patterns first.

**Field read.** A direct read of a fighter field, optionally negated. Use this when the condition is "is the fighter in physical state X." `grounded`, `notGrounded`.

**Current-snapshot read.** Read `buf[0]` and answer a single-frame question. Use this for "is the player currently holding X." `horizontalInput`, `crouchInput`. Always guard against `!now` — the buffer can be empty on tick 0 of a fresh fighter.

**Rising-edge with window.** Use `wasPressedWithin(buffer, key, frames)`. Walks the buffer newest-to-oldest, returns true if `key` went false → true within `frames` frames. Use this for discrete actions: button presses, fresh stick taps. `jumpPressed`, `canAirJump`.

**Neutral-to-direction with window.** Walk the buffer looking for a frame where stickX is non-zero and the *next-older* frame is zero. `stickSlammed` is the canonical example. Use this for "deliberate input that started recently." Require `now.stickX !== 0` first as a fast-path rejection.

**Press-context read.** `pressIndex(buffer, key, frames)` to locate the rising edge, then read other fields of `buf[idx]`. Use this whenever a condition needs the input state *at the moment of the press* rather than at evaluation time — directional attacks are the canonical example; smash-vs-tilt detection and DI will be next. Always check `idx !== -1` before indexing.

**Sustained-hold counter.** Loop the most recent N frames and return true only if all of them satisfy a predicate. The fast-fall commit path is this pattern. Use this for "the player has clearly committed by holding for N consecutive frames."

**Runtime-event read.** A direct read of a fighter-runtime field that another system or effect wrote — `hitTaken` reads `pendingHit`, `hitstunFinished` reads `pendingHitstunFrames`. Use this when the trigger isn't input at all but a recorded event or a dynamic threshold. The field's writer defines the semantics; the condition just observes.

**Compound.** Combine any of the above with `&&`. Most non-trivial conditions are compound — `canAirJump` and `canAirDodge` are both a rising edge AND a counter check; `fastFallTriggered` is a stick read AND (fresh window OR commit window) AND a velocity check.

The discipline: a new condition should never grow into a multi-paragraph block of branching logic. If it wants to, the condition is doing two jobs — split it. The state machine matches conditions individually; you can list both in a state's transitions and let priority sort them.

---

## 7. The effects registry

An effect is `(fighter) → void`. Effects fire once at the moment a transition resolves, never on a per-frame basis. They mutate fighter fields. They do not read state data (they're not passed the state).

### Current effects

**Impulse effects.** Set velocity from character config.

- `applyJumpImpulse` — `vy = -jumpForce`. Negative because Y-down. Used on JumpSquat → Fall.
- `applyAirJumpImpulse` — `vy = -airJumpForce` AND `airJumpsUsed += 1`. Overwrites vy rather than adding to it: the jump should feel the same whether the player was rising, level, or falling at the moment of the air jump. Used on Fall/AirJump/FastFall → AirJump.
- `applyFastFall` — `vy = fastFallSpeed`. Snaps downward speed to the character's fast-fall target. Used on Fall/AirJump → FastFall.
- `applyAirDodge` — reads `buf[0].stickX` and `buf[0].stickY`, normalizes the vector via `fm.length2D`, scales by `airDodgeSpeed`, and writes both `vx` and `vy`. Also increments `airDodgesUsed`. For neutral input (no stick direction), sets vx and vy to 0 — an in-place dodge. Used on Fall/AirJump/FastFall → AirDodge. This is the 2D-vector analog of the input-capture pattern that `commitFacingFromSlam` instantiates in 1D.

**Counter resets.**

- `resetAirActions` — `airJumpsUsed = 0` AND `airDodgesUsed = 0`. Used on Fall/AirJump/FastFall/AirDodge → Land. Land is currently the only path from airborne back to grounded, so resetting here covers all cases. The composite reset bundles all "once-per-aerial-phase" counters into one effect because the state machine supports one effect per transition. If future states need to reset only one of the counters (or new counters with different reset semantics get added), the right move is to extend the state machine to accept an array of effects per transition rather than splitting the composite — at which point the array-effects extension also pays for itself across combat's hit-reaction transitions.

**Input-to-field commits.**

- `commitFacingFromSlam` — reads `buf[0].stickX`, takes its sign, writes to `facing`. Used on every transition into Dash and DashBack.
- `commitFacingFromLightAttackPress` — the press-context sibling: finds the attack press via `pressIndex` (scanning the whole buffer — the condition already gated the window) and commits facing from the stick *at the press frame*. Used only on ground side-attack entries; the aerial forward/back conditions deliberately have no facing commit.

**Hit reaction (Phase 13).**

- `applyHitReaction` — the composite consumer of `pendingHit`, fired by every `hitTaken` transition:

  ```js
  applyHitReaction: (fighter) => {
    const hit = fighter.pendingHit;
    if (!hit) return;  // defensive — hitTaken should have gated this

    const { vx, vy } = computeKnockback(hit, fighter.damage, fighter.config.physics.weight);
    fighter.vx = vx;
    fighter.vy = vy;
    fighter.damage += hit.damage;
    fighter.pendingHitstunFrames = hit.hitstun ?? 0;
    fighter.pendingHit = null;
  },
  ```

  The internal order is load-bearing: `computeKnockback` must run *before* `damage +=` — the Melee formula takes the victim's pre-hit percent and adds the move's damage internally; incrementing first would double-count the hit. The `?? 0` is four characters of insurance against an attack authored without a `hitstun` field (undefined would make `hitstunFinished`'s comparison permanently false — paralysis; zero means instant exit — graceful). Note it never reads the other fighter: everything it needs, including `attackerFacing`, was snapshotted into `pendingHit` at contact time. This is a composite (knockback + damage + timer + cleanup as one effect) pending the array-of-effects extension — hitlag in 13b is the expected trigger, at which point this and `resetAirActions` both decompose.

### Worked example: `commitFacingFromSlam`

This effect is worth understanding in detail because it's the canonical "freeze input into a fighter field" pattern, and the alternative would be subtly broken.

```js
commitFacingFromSlam: (fighter) => {
  const now = fighter.inputBuffer[0];
  if (!now || now.stickX === 0) return;
  fighter.facing = fm.sign(now.stickX);
}
```

The condition that fires this effect (`stickSlammed` or `stickReverseFromFacing`) has already established that `buf[0].stickX !== 0`. The defensive guard is belt-and-suspenders, not strictly required.

The effect reads `stickX` *once* and writes the sign to `facing`. From that point on, the Dash physics mode reads `facing` (not stickX) to set velocity: `vx = facing * dashSpeed`.

The alternative — having Dash physics read live `stickX` every frame — would mean the dash stops the moment the player releases the stick, because stickX would return to 0. The player would have to hold the stick throughout the entire dash. With the capture pattern, the player can slam the stick, release it, and the dash continues for its full duration.

This is also why `stickReverseFromFacing` works as a dash-back trigger. The condition compares the current stickX direction to `facing` (the captured slam direction), not to the previous stickX. Reversing means "the stick is now pointing opposite to the way I committed to dash," which is meaningful information; "the stick is now pointing opposite to where it was 2 frames ago" wouldn't be — that's just the player jostling the stick.

The pattern generalizes: any time a state needs to commit to a direction or value derived from input at the moment of entry, the right move is a capture effect on the transition into that state. The state itself reads the captured value, not the live input. `applyAirDodge` is the 2D instance of the same pattern — it captures both stickX and stickY at the moment of dodge entry and writes vx and vy from the normalized vector. The AirDodge state then preserves those values (gravity:0, friction:0, horizontalMode:'none') for the full duration; releasing the stick mid-dodge doesn't change anything because nothing's reading live input.

### What effects can read

At the moment an effect fires:

- `fighter.inputBuffer` reflects the input that triggered the transition (the input pipeline ran first in tick order).
- `fighter.actionState` still holds the *source* state name. The assignment to `t.to` hasn't happened yet.
- `fighter.stateFrame` still reflects time spent in the source state.
- `fighter.vx`, `fighter.vy`, `fighter.x`, `fighter.y`, `fighter.grounded`, `fighter.facing` are whatever they were at the end of the previous tick (physics and collision haven't run yet this tick).

An effect can read any of these. It can also read `fighter.config` for character constants. It cannot read state data (no parameter is passed), and it shouldn't read `world.states` or other globals — effects are scoped to the fighter and the moment of transition.

### What effects shouldn't do

Effects shouldn't loop, shouldn't read other fighters, shouldn't call into systems, shouldn't allocate (they fire in the hot path), and shouldn't make decisions about what state to enter — that's the transition's job. An effect that needs to decide between two destinations based on conditions wants two transitions with different conditions and the same effect, or one transition with a more specific condition.

The "shouldn't read other fighters" rule actively shaped Phase 13: `applyHitReaction` needs the attacker's facing, and the answer was not to hand effects world access — it was to snapshot `attackerFacing` into `pendingHit` at contact time, keeping the effect single-argument like every other. When a future effect seems to need another fighter, reach for the same move: have the system that observed the interaction record what the effect will need.

---

## 8. Recipe: adding a new state

Worked end-to-end. Suppose you're adding a `Shield` state: a grounded action where the fighter is stationary, can't be hit, and exits when shield is released.

1. **Add the state to `data/states/states.js`.**

   ```js
   Shield: {
     name: 'Shield',
     duration: 0,                                       // held until released
     physics: { gravity: 1.0, friction: 1.0, horizontalMode: 'none' },
     transitions: [
       { when: 'notGrounded',  to: 'Fall' },
       { when: 'shieldReleased', to: 'Idle' },
     ],
     render: { color: '#4488dd' },
   },
   ```

2. **Give it the universal `hitTaken` entry first.** Every state's transitions list starts with `{ when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' }` — including new ones, including states that seem hit-proof (redundancy is harmless; see §4). Forgetting this entry creates a state that ignores hits, silently.

3. **Add the entry transitions to states that should be able to enter Shield.** Most likely Idle, Walk, Land. Each needs a new transition entry referencing a new condition `shieldPressed`:

   ```js
   // In Idle.transitions, somewhere appropriate in priority order:
   { when: 'shieldPressed', to: 'Shield' },
   ```

   Priority placement matters. Shield is a discrete deliberate action, so it ranks alongside `jumpPressed` — high, but below `hitTaken` and `notGrounded`. The exact placement is a design decision; the principle is "specific intent before defaults."

4. **Add the conditions `shieldPressed` and `shieldReleased` to `core/conditions.js`.**

   ```js
   shieldPressed: (f, _s) =>
     wasPressedWithin(f.inputBuffer, 'shield', SHIELD_BUFFER_FRAMES),

   shieldReleased: (f, _s) => {
     const now = f.inputBuffer[0];
     return !now || !now.shield;
   },
   ```

   `shieldPressed` is a rising-edge detector — same pattern as `jumpPressed`. `shieldReleased` is a current-snapshot read — true when shield is not held.

5. **If the snapshot doesn't have a `shield` field yet, add it.** This means updating the snapshot contract in `input/keyboard.js` (where `getCurrentInput` builds the snapshot) and any place that constructs a snapshot manually for testing. The snapshot is the contract; expanding it claims a slot.

6. **No new effect needed for this example.** If Shield needed a setup action (e.g., consume some shield budget), an effect would go on the transition *into* Shield.

7. **Verify in the overlay.** Open the debug overlay (backtick). The live stats panel will show `actionState: Shield` and `stateFrame` advancing while shield is held. The history panel will show the entry transition and which condition triggered it. If `shieldReleased` fires immediately on entry, the condition or the snapshot is wrong — most likely the snapshot's `shield` field isn't being populated from the keyboard.

The state machine interpreter does not change. `core/stateMachine.js` is the same file before and after. That's the test of a well-bounded change: only data and registries grew.

---

## 9. Recipe: adding a new condition

A new condition is one entry in `core/conditions.js`. Walk through it:

1. **Classify the pattern.** Is it a field read, a current-snapshot read, a rising-edge-with-window, a neutral-to-direction, a press-context read, a sustained-hold, a runtime-event read, or compound? Pick the simplest pattern that fits.

2. **Pick the window size if applicable.** If it's a buffer-history read, the window length is a tuning knob. Cross-reference existing windows: `JUMP_BUFFER_FRAMES = 5` for forgiving inputs, `AIRJUMP_BUFFER_FRAMES = 3` for inputs that must not double-fire across state boundaries, `STICK_SLAM_FRAMES = 5` for deliberate stick intents. Smaller windows are stricter; larger windows are more forgiving but risk picking up stale inputs from earlier states.

3. **Write the function.** Signature is `(fighter, state) → boolean`. Use `_s` if state is unused. Guard against `!now` for buffer reads. Use `fm.sign` and other `fixedMath` helpers for portable arithmetic.

4. **Add the entry to the registry.** One line.

5. **Reference it from the appropriate state transitions.** Conditions are useless without states using them.

6. **Verify by triggering the condition and watching the overlay's history panel.** The frame on which the condition fires should match expectation. If it fires too early or too late, the window is wrong, the pattern is wrong, or the condition is conflating two things and should be split.

---

## 10. Recipe: adding a new effect

A new effect is one entry in `core/effects.js`. Smaller than conditions usually — most effects are 1-3 lines.

1. **Decide what fighter fields it writes.** An effect that writes one field is the default; effects that write multiple related fields (`applyAirJumpImpulse` writes `vy` and `airJumpsUsed` in one call) are fine when the fields are coupled in meaning.

2. **Decide what fighter fields it reads.** Reading `config.physics.*` for character constants is normal. Reading the input buffer is normal when capturing input into a fighter field. Reading `vx`, `vy`, `grounded`, `facing` is fine if the new value depends on the current one.

3. **Write the function.** Signature is `(fighter) → void`. No return value, no allocations.

4. **Add the entry to the registry.** One line.

5. **Reference it from a transition's `effect` field.** Effects don't fire on their own — they're attached to transitions.

6. **Verify by triggering the transition and watching the fields the effect writes in the overlay's history panel.** If the field doesn't change, the effect didn't fire (the transition didn't match) or the effect's logic is wrong.

---

## 11. Load-bearing decisions

**Effects fire before the actionState assignment.** Effects can read the source state name, source stateFrame, and the buffer that triggered the transition. Reversing the order would erase that context.

**Transitions do not chain.** The new state's transitions are not re-evaluated on the same tick. Adding chaining would re-time many emergent behaviors and would expose the engine to infinite-loop bugs.

**`durationElapsed` uses the `+1` formula.** `stateFrame + 1 >= duration` is what makes "duration: N" mean exactly N ticks active. Every fixed-duration state is tuned to this; changing the formula re-times all of them.

**`duration: 0` means "no auto-exit."** The `s.duration > 0` guard in `durationElapsed` is what prevents non-timed states from accidentally exiting at frame 0. States that should be held indefinitely set `duration: 0`; states with a fixed lifetime set a positive number.

**The state parameter exists for conditions, not effects.** Conditions are passed `(fighter, state)` so they can read state data (currently only `durationElapsed` does). Effects are passed only `(fighter)` and should never need state data — if an effect wants per-state behavior, it should be a separate effect.

**Capture inputs into fighter fields, don't read live.** `commitFacingFromSlam` is the pattern. States that need to remember an input commit at the moment of entry; physics reads the captured field. Reading live input every frame couples the action to continuous input, which is almost never the right design for discrete commits.

**Adding a condition or effect is a one-file change.** If a new condition or effect requires changes to the interpreter, the interpreter has leaked. Stop and reconsider — the change probably belongs on the data side.

**`onEnter` is documented but inert.** Be careful when reading the architecture docs that imply `onEnter` is wired up — it isn't yet. Until it is, every state-entry effect is attached to a transition. Adding `onEnter` support is a small, well-bounded change; do it deliberately the first time a state genuinely needs an entry effect that should fire regardless of source.

**Transitions in different states with identical entries are not refactoring opportunities.** Dash, DashBack, and Run share most of their transitions list. The repetition is meaningful — each state's transitions are explicit and self-contained. Adding inheritance would couple state definitions to each other and break the "a state is data" rule.

**`hitTaken` is first in every state, by authored data.** The universal transition is a wiring pattern, not an interpreter feature. Removing an entry (or reordering it below other transitions) changes that state's hit behavior — sometimes that will be the point (armor), but it must be deliberate and visible in the data.

**`durationElapsed` consults the character before the state.** `config.attacks[state].duration ?? state.duration`, with no authored state-side fallback for attacks. Adding a state-side "default" attack duration would silently mask missing character entries — the loud failure is the feature.

**Dynamic durations are runtime fields with sibling conditions.** `hitstunFinished` reads `pendingHitstunFrames`; hitlag will read its own field. Don't extend `durationElapsed` to read runtime fields — its authored-data semantics are what every fixed-duration state is tuned against.

**Directional attack variants rank above the neutral fallback.** The conditions over-match by design (up-forward satisfies two variants); transition order is the resolver. Sorting a state's attack ladder alphabetically or "cleaning it up" re-prioritizes the character's moveset.

**One effect per transition — until 13b.** `resetAirActions` and `applyHitReaction` are composites living within the constraint. The array-of-effects extension (~6 lines) lands when hitlag forces it; until then, don't add a second composite-flavored mechanism, and after it, decompose the existing two.

---

## 12. When to revisit this doc

Update when:

- A new condition or effect pattern emerges that isn't covered in §6 or §7 (e.g., a new buffer-query helper added to `inputBuffer.js`).
- The interpreter changes shape — particularly if `onEnter` is wired up, if transitions gain a new optional field, or if chaining is ever introduced (which it shouldn't be without overwhelming reason).
- The frame-timing semantics change — if `stateFrame` starts at a different value, or if the `+1` in `durationElapsed` is reconsidered, or if state entry and exit ever have separate effect slots.
- A new condition or effect is added that doesn't fit the existing patterns — the registry's pattern catalog should evolve with the registry.
- A subtle bug is found whose cause is buffer-window choice, transition ordering, or effect-vs-condition placement. Document the resolution here so the next contributor doesn't relearn it.

This doc is the contract for how the state machine behaves. If the code does something this doc doesn't describe, or this doc describes something the code doesn't do (the `onEnter` case), one of them needs to change.

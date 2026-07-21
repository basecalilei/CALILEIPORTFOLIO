# dataModel.md

The engine has three data layers that describe fighters, plus a fourth that describes stages. The single biggest preventable architectural mistake in this codebase is putting a value on the wrong layer. The cost is real: a misplaced value silently produces bugs that look like physics bugs, state-machine bugs, or input bugs, when the actual problem is that the data is in the wrong place.

Phase 12 sharpened the model with a wrinkle worth knowing up front: character data now contains **state-keyed sub-tables** (`attacks`, `hurtboxes`). Data can be *keyed by* an action while *belonging to* a character — "per-action" and "state data" are no longer synonyms. The test that decides is §6's; the migration that taught it is §2's.

This document is the decision tree. Read it before adding any new field — to a fighter, to a state, to a character config. The choice is recoverable but expensive, and "expensive" here means "you'll find the consequences months later in a system that doesn't seem related."

---

## 1. The layers at a glance

| Layer            | Lifetime                          | Mutability       | Where it lives                          | Who writes it           |
|------------------|-----------------------------------|------------------|-----------------------------------------|-------------------------|
| Character data   | Authored once per character       | Immutable        | `data/characters/<name>.js`             | Nobody, after authoring |
| State data       | Authored once per state           | Immutable        | `data/states/states.js`                 | Nobody, after authoring |
| Stage data       | Authored once per stage           | Immutable        | `data/stages/<name>.js`                 | Nobody, after authoring |
| Fighter runtime  | Created per fighter, lives forever| Mutated every frame | `entities/fighter.js` (factory)         | Multiple systems per tick |

The three immutable layers are *configuration*. The runtime layer is *state* (in the general "current condition of the simulation" sense, not the action-state sense). The four describe what the engine *can do* and what the engine *is currently doing*.

A value belongs on the layer whose lifetime matches the value's lifetime. That's the entire rule, and most of this document is just the corollaries.

---

## 2. Character data

```js
// data/characters/fighterA.js
export const fighterA = {
  name: 'Fighter A',
  body: { width: 30, height: 60 },
  physics: {
    gravity:       0.4,
    friction:      0.1,
    walkSpeed:     1.6,
    jumpForce:     8.0,
    airAccel:      0.1,
    airSpeedMax:   2.0,
    maxAirJumps:   1,
    airJumpForce:  8.0,
    dashSpeed:     2.8,
    fastFallSpeed: 9.0,
    maxAirDodges:  1,      // Phase 11
    airDodgeSpeed: 5.0,    // Phase 11
    weight:        100,    // Phase 13 — knockback formula divisor
  },
  color: '#dd5555',
  hurtboxes: {             // Phase 13 — state-keyed, with default fallback
    default: [ { shape: { x: 0, y: -30, w: 30, h: 60 } } ],
    Squat:   [ { shape: { x: 0, y: -20, w: 30, h: 40 } } ],
  },
  attacks: {               // Phase 12 — state-keyed attack tuning
    LightNeutralGround: {
      duration: 22,
      hitboxes: [{
        active: [6, 9],
        shape: { x: 35, y: -30, w: 40, h: 25 },
        damage: 4, angle: 80,
        baseKnockback: 30, knockbackGrowth: 60, hitstun: 14,
      }],
    },
    // ...one entry per attack state this character can reach
  },
};
```

**What it is.** The intrinsic identity of a character. Body dimensions, base physical constants, top-line stats, default visual identity — and, since Phases 12–13, the character's combat data: per-attack tuning and per-state defensive geometry.

**Lifetime.** Set once when the file is authored. Never modified at runtime. Multiple fighters can share a config (`createFighter(fighterA, x, y)` is called and the `config` field is a reference, not a copy) — if it were mutated, every fighter sharing it would change. fighterB currently *is* a shallow spread of fighterA, sharing `body`, `physics`, `attacks`, and `hurtboxes` by reference — deliberate and temporary until Phase 14c gives B its own moveset, and safe only because nothing mutates config.

**What belongs here.** Anything intrinsic to *who the fighter is* across every situation they could be in. Body width. Walk speed. Jump force. Gravity base rate. Friction base rate. Max number of air jumps. Dash speed. Weight. Default color. And anything that *varies per character* even when it's keyed by action — see the sub-tables below.

**What does not belong here.** Anything that depends on what the fighter is currently *doing* and is universal across characters. The terminal velocity for a normal fall (that's state data — Fall caps at 6, FastFall holds 9, both different from the character's `fastFallSpeed`). The current friction (state data multiplies the base). Whether platforms are respected (state data — depends on action).

### The state-keyed sub-tables (Phase 12–13)

`attacks` and `hurtboxes` are objects keyed by state name that live on the *character*. This looks like a contradiction of the layer rule — the data is obviously per-action — but the deciding question is not "what is it keyed by," it's **"would two characters ever want different values?"** Hitbox geometry: yes (a hypothetical Bowser's jab is not fighterA's jab). Attack durations, damage, knockback: yes. Hurtbox geometry: yes — "different fighters will be different sizes" was the articulated requirement. The state remains the *shape* of the action (its physics behavior, its transitions, its identity as "a stationary grounded swing"); the character owns *how this fighter performs it*.

**Character-as-source, no fallback.** `durationElapsed` and `hitDetectionSystem` consult `config.attacks[stateName]` with optional chaining and **no state-side default**. A character that can reach an attack state without authoring its entry hangs in that state at undefined duration — a loud, immediate, five-second bug. That's intentional: a silent shared default would make two characters' same-named attacks identical by accident, and "the default jab" has no semantic meaning. Characters must author their attack data.

**Hurtboxes get a `default` fallback; attacks don't.** The asymmetry is principled. Every state needs *some* hurtbox (a fighter is always hittable somewhere), and for most states the standing body-box is correct — `hurtboxes[actionState] ?? hurtboxes.default` expresses "override only where the pose differs" (Squat compresses). Attacks have no analogous "default attack." Fallback where a universal answer exists; loud failure where it doesn't.

**Shared conventions.** Both sub-tables use lists (even at length 1 — per-limb hurtboxes and multi-hit attacks drop in later with zero authoring migration), center-anchored `shape` geometry (`x, y` is the offset from the fighter's bottom-center anchor to the box center), and `shape.x` mirrored by `fighter.facing` at the consult site so authored data is symmetric — positive x is "forward" regardless of facing. Hitboxes add inclusive `active: [first, last]` frame windows; hurtboxes are whole-state today with the same field reserved for phased hurtboxes later. Intangibility is *not* an empty hurtbox list — it's the state-level `intangible` flag (§9), one source of truth.

**Reference semantics.** `fighter.config` is a pointer to the same object the data file exports. Reading is normal. Writing to `fighter.config.physics.walkSpeed` is a bug — it would mutate the character data itself, persisting across the run and affecting any fighter that shares the config. If a stat needs to change at runtime, the value either belongs in fighter runtime (and gets read instead of `config`), or the design is asking for something the architecture doesn't currently support.

---

## 3. State data

```js
// data/states/states.js — one entry shown
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

**What it is.** The description of one action the fighter can be in. The action's duration, its physics modifiers, its exit conditions, optional entry effects, and per-state visual overrides.

**Lifetime.** Set once when the file is authored. Never modified at runtime. Accessed by systems through `world.states[fighter.actionState]`.

**The five sub-fields.**

- **`duration`** — number of frames before `durationElapsed` can fire. `0` means "no automatic exit; the state only ends via other transitions." JumpSquat at 3 lasts exactly 3 frames. Land at 4 holds for 4. Attack states leave this field off entirely — their durations are character tuning, read from `config.attacks[stateName].duration` (see §2); Hitstun's exit is dynamic (`hitstunFinished` reads a runtime field). See `stateMachine.md` for the `+1` semantics and all three timing mechanisms.

- **`physics`** — modifiers consulted by the physics system every frame the fighter is in this state. `gravity` is a multiplier on the character's base gravity (airborne only). `friction` is a multiplier on the character's base friction. `horizontalMode` is one of `'none' | 'walk' | 'air' | 'dash'`. `fallSpeedMax` (optional) caps downward velocity. `respectPlatforms` (optional) suppresses drop-through — twelve states set it. `intangible` (optional) removes the fighter from hit detection — AirDodge sets it. Note what did *not* end up here despite early predictions: hitbox and hurtbox geometry went to character data (§2), because they vary per character.

- **`transitions`** — priority-ordered list of `{ when, to, effect? }`. The state machine evaluates these in order, top to bottom; first match wins. Order is significant — `hitTaken` is first in every state (hit reactions preempt everything), `notGrounded` is listed before `crouchInput` in Walk because walking off a platform with down held should produce a fall, not a squat-then-fall, and the directional attack variants rank above the neutral fallback so the tilts are reachable.

- **`onEnter`** (optional) — an effect that fires at the moment of entry into this state. Most states don't have one; effects more often live on the transition that targets the state, since that's where information about *how the transition happened* is available.

- **`render.color`** (optional) — visual override read by the renderer when the fighter is in this state. Falls back to `fighter.config.color` when absent.

**What belongs here.** Anything that describes *what the fighter is currently doing*. The gravity scaling for being in FastFall. The friction multiplier for being in Idle versus being in Walk. The horizontal mode for Dash. The transitions that exit JumpSquat. The opt-out flag for whether the action ignores soft platforms.

**What does not belong here.** Anything intrinsic to the character (those are multipliers OF a character value, not values themselves). Anything that needs to persist across multiple states (counters, position, velocity — those are runtime). Anything that depends on the *current input* rather than on *what the fighter is doing* (transitions name conditions, but the conditions themselves read the input buffer; the state doesn't store input). And — the Phase 12 lesson — anything per-action that would differ between characters: attack timing, hitbox geometry, damage, knockback, hurtboxes. Those are character sub-tables keyed by state name (§2), and the state entry for an attack shrinks to shape only: physics, transitions, color.

**Reference semantics.** `world.states[name]` is a pointer to the same object the data file exports. Same rule as character data: read freely, never write. A system that wanted to mutate state data has misunderstood the data model.

---

## 4. Stage data

```js
// data/stages/battlefield.js
export const battlefield = {
  solids: [
    { top: 400, bottom: 640, left: 180, right: 780 },
  ],
  platforms: [
    { y: 280, x1: 240, x2: 380 },
    { y: 280, x1: 580, x2: 720 },
    { y: 180, x1: 400, x2: 560 },
  ],
  blastZones: { left: -100, right: 1060, top: -100, bottom: 640 },
};
```

**What it is.** Level geometry, plus the kill-box bounds. Solids are axis-aligned rectangles with full per-side collision behavior. Platforms are one-way lines, landable from above and pass-through from any other direction.

**Why it's a separate layer.** A stage is not a fighter trait; it's the environment the fighter moves through. Different stages would be different files in `data/stages/`. The fighter's character config and the stage's geometry are orthogonal — any character can be loaded onto any stage. The collision system reads `world.stage`; nothing about a fighter's config or state data references stage geometry.

**Decisions about stage data live in `collision.md`** and (eventually) a `stage.md` deep-dive. For the purposes of the fighter data model, the only thing to know is: stage geometry is a fourth immutable layer with its own home, and it does not appear in the decision tree below.

---

## 5. Fighter runtime

```js
// entities/fighter.js
{
  x, y,                  // position, bottom-center anchor
  vx, vy,                // velocity per frame
  grounded,              // boolean
  facing,                // +1 right, -1 left
  actionState,           // key into world.states
  stateFrame,            // frames in current state
  airJumpsUsed,          // counter, reset on landing
  airDodgesUsed,         // counter, reset on landing (Phase 11)
  pendingHit,            // hit event awaiting consumption, or null (Phase 13)
  hitConnected,          // Set of victim indices this attack already hit (Phase 13)
  damage,                // percent accumulator (Phase 13)
  pendingHitstunFrames,  // dynamic Hitstun duration (Phase 13)
  config,                // reference to character data
  inputBuffer,           // rolling 12-snapshot buffer
}
```

**What it is.** The mutable per-instance state of one fighter. Created by `createFighter(config, x, y)` and lives for the duration of the run. Read and written by every system in `tick`.

**Lifetime.** Created at spawn. Fields are mutated every frame. The object itself is never replaced — identity is stable across the run, like the World.

**Write ownership.** Multiple systems write the fighter, each touching the fields it owns. The `tick.md` contract table lists which system writes which fields. The rule that makes overlap safe is the fixed tick order: the last writer in tick order wins for that frame. One ownership case is special enough to name: `hitConnected` is written and reset *only* by `hitDetectionSystem` — no condition reads it, no effect touches it, and its lifecycle is deliberately invisible to the state machine. The system that owns a field owns its lifecycle; compare `airJumpsUsed`, which *is* read by a condition and therefore resets through the effect registry where the state machine can see it.

**What belongs here.** Anything mutable that persists across frames. Position (`x`, `y`). Velocity (`vx`, `vy`). Whether the fighter is on a surface (`grounded`). Which direction they're facing (`facing`). What action they're in (`actionState`). How long they've been in it (`stateFrame`). Counters that span multiple states and don't reset on every transition (`airJumpsUsed`, `airDodgesUsed`, `damage`). Recorded events awaiting consumption (`pendingHit`). Dynamic thresholds created at runtime (`pendingHitstunFrames`). Input history (`inputBuffer`).

**What does not belong here.** Anything that depends only on the current action (use state data — physics modifiers, exit conditions). Anything intrinsic to the character (use character data — body, base physics, attack tuning). Anything derivable from other runtime fields without ambiguity (don't cache `isAttacking` — derive it from `actionState`; don't cache `isAirborne` — read `!grounded`).

The fighter still has no `isAttacking`, `canJump`, or any other field derivable from `actionState` plus `stateFrame`. **One source of truth on the fighter.** The Phase 13 fields pass the same test from the other side: `pendingHitstunFrames` exists precisely because a per-hit duration is *not* derivable from any authored data — it's created by the hit itself. `pendingHit` is an event with its own lifetime; `damage` persists across every state; `hitConnected` is per-attack bookkeeping. Derive what's derivable, store only what isn't — the rule didn't bend for combat, it sorted combat's fields correctly.

---

## 6. The decision tree

When adding a new value, walk these in order. The first match wins.

**Does it change during play?**

- **No** — it's configuration. Continue.
- **Yes** — it's runtime. Continue to the runtime branch.

**(Immutable branch.) Is the value intrinsic to who the character is, or specific to what an action does?**

- **Intrinsic to the character** — character data. Base physical constants, body dimensions, max counts, default colors. The value would be the same regardless of which action the fighter happens to be in.
- **Specific to an action — but would two characters want different values?** Then it's *still character data*, in a state-keyed sub-table (`attacks`, `hurtboxes`). Being keyed by action doesn't make it state data; varying by character makes it character data. This is the Phase 12 question, and it's asked *before* the next branch.
- **Specific to an action and universal across characters** — state data. Per-action modifiers, exit conditions, action-shaped opt-outs. The value depends on what the fighter is currently doing and would be the same for any character doing it.

**(Runtime branch.) Does the value persist across multiple states, or is it tied to one state?**

- **Persists across states** — fighter runtime. The counter survives transitions, or the position is continuous across actions, or the velocity carries between states.
- **Tied to one state** — almost certainly *not* a stored field. The value is probably derivable from `actionState` plus `stateFrame`, and storing it duplicates what the state machine already knows. If it genuinely needs storage that resets on every transition, consider whether it should be expressed as state data plus a counter pattern.

### Worked examples

**Gravity.** The character has `gravity: 0.4`, the base rate per frame. The state has `gravity: 1.0` (Idle, Walk, Fall) or `gravity: 0` (JumpSquat, FastFall) — a multiplier on the base. Physics computes `cfg.gravity * mods.gravity` every frame. The character declares its physical identity; the state declares its current modulation. Two layers, multiplied. Neither layer alone would be enough: a single character with the same gravity in every state would have no FastFall, and a single state's gravity number couldn't differ between heavy and light characters.

**Fast-fall speed.** The character has `fastFallSpeed: 9.0` — the target velocity its fast fall snaps to. The FastFall state has `fallSpeedMax: 9.0` — the cap that prevents further acceleration. These are *not the same value living in two places*. The character defines what the fighter's fast fall feels like; the state defines what the cap on downward velocity is while in this action. They happen to be numerically equal for fighterA, and they could diverge — a future character might have `fastFallSpeed: 11` while their FastFall state caps at `12` for headroom against external forces. The character file's authoring comment makes this distinction explicit, and it's worth understanding before adding any new per-character speed.

**Air jumps.** The character has `maxAirJumps: 1` — the intrinsic limit. The fighter has `airJumpsUsed: 0` — the runtime counter. The `canAirJump` condition reads both: `fighter.airJumpsUsed < fighter.config.maxAirJumps`. The state has *no opinion* on air jumps — it doesn't need to, because the gating is character-defined and the count is runtime-tracked. The `resetAirActions` effect fires on the airborne → Land transitions, zeroing this counter and `airDodgesUsed` together.

**Attack tuning (Phase 12).** `LightNeutralAir`'s duration, hitbox geometry, damage, angle, and knockback numbers live on `config.attacks.LightNeutralAir`, not on the state. The tell: the values are keyed by an action but a second character would author different ones. The state entry declares only the action's shape — air physics, its transitions, its color. `durationElapsed` and `hitDetectionSystem` read the character's table by the current state's name. This is the three-layer composition at full strength: state shape × character tuning × fighter runtime (`stateFrame` deciding which hitbox windows are active).

**Hurtboxes (Phase 13).** Same placement logic as attack tuning — "different fighters will be different sizes" — with one addition: a `default` entry, because unlike attacks, every state needs *some* answer and the standing body-box is usually it. Lookup: `hurtboxes[actionState] ?? hurtboxes.default`.

**`damage` (Phase 13).** Runtime, and the purest example of the lifetime rule: it persists not just across states but across *everything* — no current mechanic resets it (KO/stocks arrive in Phase 19). Written by `applyHitReaction`, read by `computeKnockback` and the debug layer.

**`pendingHitstunFrames` (Phase 13).** Runtime, because it's *created at runtime* — each hit computes it fresh. There is no authored layer that could hold "how long this particular hit stuns," which is exactly why Hitstun is the one state without an authored duration. The `hitstunFinished` condition compares it against `stateFrame`: an authored-data counter read against a runtime-data threshold.

**`respectPlatforms`.** Lives on `state.physics.respectPlatforms`. The collision system reads it through the `wantsThroughPlatforms` predicate. Why state data and not the fighter? Because the rule is "this action should not drop through platforms" — a property of the action being performed, not of the fighter as a whole. If `respectPlatforms` were a fighter field, every attack state would need a paired `onEnter` to set it true and an `onExit` to set it false. There are no `onExit` effects today, and adding them just to support this case would be inventing a mechanism to compensate for putting the data on the wrong layer. Putting it on state means it's queried in context, no setting or clearing required.

**`facing`.** Runtime. The fighter has a current direction at any moment, written by walk/air horizontal modes (continuously, to track stickX) and by the `commitFacingFromSlam` effect (discretely, at dash-initiating transitions). It can't be on character data — facing changes during play. It can't be on state data — multiple states share a facing, and facing carries across them. The fighter is the only layer with the right lifetime.

**Body dimensions.** `body.width` and `body.height` live on character data. They don't change at runtime, they don't depend on action, they're intrinsic. Even though future systems might want to read body dimensions during collision or hitbox checks, the value being read is still on `fighter.config.body` — it's not duplicated to the fighter or the state.

**`stateFrame`.** Runtime. Counts frames in the current action state. Reset to 0 by the state machine on every transition. Incremented by 1 on every frame no transition fires. This is the canonical example of a counter whose lifetime is genuinely "per state instance" — it does reset on transitions — but it's still on the fighter, because *the counter belongs to the fighter even though its semantics are state-scoped*. The state data describes what duration means; the fighter holds where the count currently is. State data is the same across all fighters in the same state at the same time; `stateFrame` differs between two fighters in the same state.

---

## 7. Wrong-layer mistakes and their symptoms

When data is on the wrong layer, the symptom rarely points back at the data. These are the patterns to recognize.

**State forking.** A runtime trait placed on state data. Now every state that should expose it has its own copy, and adding a new state means remembering to set it (with the failure mode of forgetting and getting a subtle bug). If you're about to write the same field with the same value across many state definitions, the field doesn't belong on state data — it belongs on the fighter. Counter-example: `physics.gravity: 1.0` appears on most states and that's *not* state forking, because the value would differ if the action genuinely modulated gravity (JumpSquat and FastFall do). The repetition reflects the default modulation, which is meaningful.

**Paired-effect leak.** An action-specific trait placed on the fighter. Now the trait has to be set on entry and cleared on exit, and any state that should opt in needs paired effects. The failure mode is forgetting a clear — the trait persists into the next state, producing behavior that looks like a transition bug. `respectPlatforms` on the fighter would be the textbook case. If you're about to add an `onEnter` effect that sets a fighter field and an `onExit` effect that clears it, ask whether the field should be on state data instead, where it's queried in context and nothing needs to be cleared.

**Writing to immutable layers.** A system that mutates `fighter.config.physics.walkSpeed` or `world.states['Walk'].physics.gravity`. JavaScript won't complain. The character data file's exported object will be permanently mutated for the rest of the run, and any other fighter sharing the config will inherit the change. The symptom is a value that "seems to drift over time" or "behaves differently after a long session." Reads on `config` and `world.states` are fine; writes are bugs. The discipline is to never assign to `fighter.config.*` or `world.states.*` — if a value needs to change at runtime, it belongs on the fighter.

**Derivable-but-stored.** A field on the fighter that duplicates what `actionState` and `stateFrame` already encode. `fighter.isAttacking` would be redundant — the answer is "is `actionState` one of the attack states." `fighter.isAirborne` would be redundant — the answer is `!fighter.grounded`. The symptom is a field that gets out of sync, because two writers update one (the state machine updates `actionState`) and forget the other (the duplicate boolean). The fix is to delete the duplicate and derive at the call site. Derivation is cheap; cache invalidation is not.

**Configuration that should be data.** A magic number in `physicsSystem.js` (e.g., the wall-slide threshold, the air-drift cap interpretation) that depends on the character or the state but lives in the system code. Symptom: tuning the value affects every character/state uniformly, with no way to expose it per-character or per-state. The fix is to move the value into character data or state data, and have the system read it from the fighter or the state. The principle is *anything tunable is data, not code* — and tunability is the test for whether a number is a configuration constant or an engine constant.

**The accepted oddity, not a mistake.** The flip side of the catalog above. Sometimes a small, visible oddity exists, and the "fix" would require adding a fighter field whose only consumer is the cosmetic case. Adding that field would cost paired maintenance everywhere position or grounded state mutates — collision when it snaps, future hitstun launchers, future moving platforms — and the value's only payoff is smoothing the one visual moment. The right move is often to accept the oddity. The canonical example today is the **Squat flicker**: when a fighter standing on a soft platform presses down, they transition Idle → Squat → Fall over two frames, with one frame (~17ms) of Squat color visible before Fall takes over. A fix would be a `groundedOn: 'solid' | 'platform'` field on the fighter, then Idle's transitions short-circuiting to Fall (instead of Squat) when grounded on a platform with down held. That field has one consumer, and that consumer is cosmetic; the architecture rejects it. The flicker is the visible cost of a clean data model; the alternative cost (a field with paired maintenance and one consumer) is hidden but worse. The discipline: not every oddity is a bug to fix; some are decisions to accept. If a future feature creates a non-cosmetic consumer for the same field — a state-specific behavior that depends on "what kind of surface am I on" — revisit the decision then. Until then, accept the oddity and keep the data model lean.

---

## 8. The "it feels like two layers" pattern

Sometimes a value seems to want to live on two layers at once. This is almost always a signal that the value is actually *two distinct values* that should be factored apart.

The fast-fall case is the canonical example. The character has `fastFallSpeed: 9.0`. The state has `fallSpeedMax: 9.0`. These look like the same value duplicated. They're not. One is the per-character target the `applyFastFall` effect snaps `vy` to; the other is the per-state cap that prevents acceleration past that point. They're equal today by coincidence (or by careful authoring), and they could diverge tomorrow.

The factoring trick: when a value seems to need to live on two layers, ask what each layer's *responsibility* is for that value. The character is responsible for "what does fast fall mean for this fighter." The state is responsible for "what's the cap on downward velocity while in this action." They're different questions with the same numeric answer for this character. Two values, two layers, one shared number.

Gravity is the same shape. The character's `gravity: 0.4` is "this fighter's base rate." The state's `gravity: 1.0` or `0` is "the multiplier for this action." Multiplied at the call site, never stored as a combined value. Storing `effectiveGravity` on the fighter would be the wrong move — it would either duplicate, or it would have to be recomputed on every state transition, and the recomputation is exactly what `physicsSystem` already does each frame.

When a value resists factoring — when the same number truly needs to live in one place that both the character and the state know about — the value is probably character data, and state data reads it through `fighter.config`. State data referencing character data is normal (physicsSystem composes them every frame). The reverse — character data referencing state data — never happens; a character knows nothing about which states it might be in.

---

## 9. State-level opt-outs

A specific pattern within state data deserves naming on its own: the **opt-out flag**. A boolean on `state.physics` that a consuming system checks at its consultation site to suppress a default behavior. The current canonical example is `respectPlatforms`.

The pattern's shape:

- A default behavior is established somewhere — usually in the consuming system, expressed as the "what happens when no opt-out is set" path.
- A state can opt out by setting an explicit boolean flag on its physics data.
- The consumer checks the flag with explicit boolean comparison (`=== true`), not a truthy check.
- Absence of the flag (undefined) is unambiguous "default behavior applies."

The current implementation:

```js
// in collisionSystem.js
function wantsThroughPlatforms(fighter, state) {
  if (state.physics.respectPlatforms === true) return false;
  const now = fighter.inputBuffer[0];
  if (!now || now.stickY <= 0) return false;
  return true;
}
```

The default behavior: drop-through is allowed when the player holds down. The opt-out: a state can set `respectPlatforms: true` and the drop-through path is suppressed entirely for that action. Twelve states set it: AirDodge (structural — wavelanding onto platforms requires the dodge to respect them), Land (a tuned feel decision — it widens the platform-stay window after a waveland), and all ten attack states (a mid-swing fighter shouldn't drop through the platform under them). Hitstun deliberately does *not* set it — a launched fighter keeps normal drop-through rules.

### How an opt-out differs from required state data

Regular state data (`physics.gravity: 1.0`, `physics.horizontalMode: 'walk'`) is **required**. Every state must declare these because the consuming systems need to apply something every frame. Omitting them is a bug — the dispatch table or the multiplier would have no value to use.

Opt-out flags are **optional**. Most states don't declare them and shouldn't. The default behavior is the right behavior for almost every action; the opt-out is for the exceptions. Adding a new opt-out flag is purely additive — existing states don't need to be updated to declare `respectPlatforms: false`, because the absence already means false.

The asymmetry: required fields appear on every state and *tune* behavior; opt-out flags appear only where deviation is needed and *suppress* behavior. The pattern in this section is for the latter, not the former.

### Why state-level, not fighter-level

The decision tree from §6 already gives the answer, but the opt-out pattern is where the answer is most consequential. The trait is **action-shaped, not fighter-shaped**: "this action should not be droppable through," not "this fighter should not drop through." Moving the flag to the fighter would require paired enter/exit effects on every state that should opt in — the paired-effect leak from §7. The state-data placement means the check happens in context with zero maintenance.

The general rule: if you find yourself wanting to add a boolean to the fighter that says "behavior X is disabled right now," and the disabling is per-action, the boolean belongs on state data as an opt-out flag.

### The pattern's range

`respectPlatforms` was the first instance; `intangible` is the realized second:

- **`intangible: true`** — hit detection skips the fighter entirely, and the hurtbox visualization draws nothing. AirDodge sets it (Phase 11 authored the flag as a placeholder; Phase 13 gave it both consumers). Phase 15's roll and spot dodges will extend this — likely with per-frame windows, since dodges are invulnerable for only part of their duration.

The same shape will keep appearing in combat phases and beyond:

- **`superArmor: true`** — a state where hits register but knockback is suppressed (heavy-attack startup, certain command grabs).
- **`canBeShielded: false`** — an unblockable attack.
- **`canBeGrabbed: false`** — a state immune to grab attempts.
- **`reflectable: true`** — a projectile state that bounces off shields rather than dissipating.
- **`respectWalls: false`** — a phase or teleport state that ignores wall collision.
- **`clankable: false`** — an attack that doesn't trade with other attacks.

These are extrapolations, not commitments. The point is that the *shape* is reusable: each future "this action ignores X" or "this action suppresses Y" gets one boolean on `state.physics`, with the consuming system reading it at its consultation site. No paired entry/exit effects, no fighter-side flags, no system-level switch statements.

### Conventions to honor

Three rules make opt-outs predictable.

**Explicit boolean comparison at the consultation site.** The check is `state.physics.respectPlatforms === true`, not `if (state.physics.respectPlatforms)`. A truthy check would fire on a typo (`respectPlatforms: 'yes'`) and would behave inconsistently between `false`, `undefined`, `null`, and `0`. The explicit comparison treats anything that isn't literally `true` as "default behavior applies." It also makes the data shape self-documenting — a future contributor reading state data sees `respectPlatforms: true` and knows the flag is doing something; absence means it isn't.

**Absence is default.** A state that doesn't mention an opt-out flag inherits the default behavior. New opt-outs don't require updating every existing state's data — they only appear on the states that want to deviate. This is what makes the pattern additive. If a new opt-out flag forces a default value into every state's data, it isn't an opt-out — it's a required field in disguise.

**The consuming system owns the default.** The default behavior isn't documented in the state data file; it's documented and implemented in the system that reads the flag. `wantsThroughPlatforms` in `collisionSystem.js` owns the default for `respectPlatforms`. `hitDetectionSystem` (and the hurtbox visualization alongside it) owns the default for `intangible` — tangible unless the flag says otherwise. Future opt-outs follow the same pattern: shield-interaction owns the default for `canBeShielded`, and so on. One wrinkle `intangible` introduced: it has *two* consumers reading the same flag with the same default. That's fine — and better than the alternative of the debug layer inventing its own signal — but it means the flag's meaning is now a two-site contract.

A consequence worth knowing: a future contributor reading state data for an attack state will see entries like `respectPlatforms: true, intangible: true` and not see what those entries suppress. The suppression is documented at the consultation site, not the data site. That's the right place — the consuming system needs to know what its default is regardless of how many states opt in or out, and the data file gets a useful kind of opacity that prevents accidental dependence on implementation details.

### Naming conventions

Two rhetorical patterns appear in the extrapolations above. Picking one consistently for each opt-out matters more than which one is picked.

**Pattern A: `respectX` / `respectsX`.** Reads as "this action respects (or doesn't respect) the X interaction." Defaults are "respects" (i.e., the absence of the flag means the interaction happens). Setting `respectX: true` means the action acknowledges and is bound by the interaction; setting `respectX: false` would suppress it. The current `respectPlatforms` is this pattern, though it inverts the usual sense — `respectPlatforms: true` suppresses drop-through, which is a default. This is mildly counterintuitive and worth knowing before adding a second `respect`-flagged opt-out.

**Pattern B: a single adjective describing the deviation.** `intangible`, `superArmor`, `reflectable`. Default is the absence (the fighter is tangible, has no super armor, the projectile isn't reflectable); setting the flag to `true` introduces the deviation. This reads more naturally for behaviors that are "off by default, on for special cases."

The two patterns aren't fully compatible — `respectShields: false` and `unblockable: true` are the same flag with opposite signs. Whichever you choose for a given behavior, document the default at the consumption site clearly, and don't mix the two patterns for closely related flags.

### What is not an opt-out

A few things look like opt-out flags but aren't.

**`fallSpeedMax`** (optional on state.physics) is a *tuning value*, not an opt-out. Different states have different caps; absence means "no cap." It's a parameter, not a suppressor.

**`gravity: 0`** uses the multiplier system, not the opt-out system. The state is declaring "multiply gravity by zero." Different mechanism — gravity is always *applied*, the multiplier just happens to zero it.

**`horizontalMode: 'none'`** uses the dispatch table. The state is declaring "use the none-mode handler." Not an opt-out.

The distinguishing question: would you set the flag to `false` to deliberately enable the behavior? If yes, it's a switch, not an opt-out. If no — because the behavior is on by default unless the flag is `true` — it's an opt-out.

The pattern is specifically for behaviors that happen *automatically* under some default condition (a player input, an environmental trigger, an entity interaction), where some actions need to suppress that automation. Parametric values, dispatch selectors, and required multipliers aren't in scope.

---

## 10. Recipe: adding a new value

Five questions. Answer them in order.

1. **What is the value's lifetime?** Authored once and never changes during play → immutable layer. Changes during play → runtime.

2. **(Immutable) Is it intrinsic to the character, specific to an action, or both?** Character-intrinsic → `data/characters/<fighter>.js`. Action-specific *and character-varying* → a state-keyed sub-table on the character (`attacks`, `hurtboxes` — or a new sibling if a genuinely new category appears). Action-specific and universal → `data/states/states.js` on the relevant state(s).

3. **(Runtime) Does it persist across state transitions?** Yes → add it to `createFighter` in `entities/fighter.js`. No → it almost certainly doesn't need to be stored; consider whether it's derivable from `actionState` and `stateFrame`.

4. **Which systems read it? Which systems write it?** Add the read/write contract to your understanding (and to `tick.md` if the change is significant). The expected pattern: one writer, multiple readers. Multiple writers is fine when the tick order coordinates them, but it's worth being explicit about who's writing what when.

5. **Default value.** Immutable data needs a default in the authoring file (or, for optional state fields, a "missing means default" interpretation in the consumer). Runtime fields need a default in `createFighter`. The default is part of the contract — every fighter created from any config has every runtime field; every state has every required physics modifier.

If the answer to question 2 or 3 feels like "both" or "neither," the value is the two-layers pattern from §8 — factor it before continuing.

---

## 11. Load-bearing decisions

**`fighter.config` is a reference, not a copy.** Multiple fighters can share a config. Mutating it would affect them all. This makes character data effectively immutable in practice; the discipline is to honor that in code by never assigning to `fighter.config.*`.

**`world.states[name]` is a reference, not a copy.** Same rule. Never assign to `world.states['Walk'].physics.gravity`. The state machine and physics system read state data on every tick — a runtime mutation would leak across every fighter in that state.

**`fighter.config` is a fighter field, not a World field.** A fighter carries its own config reference. The World does not hold a "current character" — the fighter does. This is what makes N-fighter support trivial: two fighters can have different configs without any plumbing changes.

**`actionState` is a string, not an object reference.** The fighter holds `'Walk'`, not the Walk state definition. Systems look up the definition through `world.states[fighter.actionState]` every frame. This is what lets the state set on the World be swapped or extended without changing the fighter shape, and it's what makes save/restore of a fighter trivially possible — a fighter is a small object with no live references into the state table, only by name.

**`respectPlatforms` is on state data, not the fighter.** Action-shaped; the consequence of moving it would be paired effects on every state that should opt in, with every easy-to-miss exit path leaving the fighter stuck. The principle is general: opt-out flags for action-shaped behavior belong on state data.

**Character data multipliers vs state data multipliers.** Both layers can carry a value named `gravity` (and `friction`). They are not the same value — one is the base, the other is the modulation. Physics composes them with `cfg.gravity * mods.gravity`. The naming is intentional: the *role* of the value is the multiplier-or-base, not the unit, and the system makes the composition explicit.

**No runtime field duplicates state-machine knowledge.** If the answer can be found by looking up `world.states[fighter.actionState]`, it is not stored on the fighter. The discipline keeps the state machine as the single source of truth for "what the fighter is doing right now." The Phase 13 fields don't breach this — each stores something *no* authored data encodes (a hit event, a percent, a per-hit timer).

**Attack tuning is character data with no state-side fallback.** `config.attacks[stateName]` is the source. Authoring a state-side "default attack" — even as a well-meant safety net — would convert a loud five-second bug (a state hanging at undefined duration) into a silent one (two characters accidentally sharing a move). The loud failure is the feature.

**The sub-tables share the box conventions.** Lists even at length 1, center-anchored shapes, facing-mirror at the consult site, inclusive `active` windows. Every future hitbox and hurtbox is authored against these; changing any of them re-authors all of them.

**`hurtboxes.default` exists; `attacks.default` must not.** Fallback where a universal answer exists (every state needs some hurtbox), loud failure where it doesn't (there is no "default attack"). Adding the missing one or removing the present one breaks the asymmetry's logic in both directions.

**`hitConnected`'s lifecycle belongs to `hitDetectionSystem`.** No condition reads it, so no effect resets it. If a future condition ever *wants* to read it (a "has this attack landed" cancel window, say), the reset must migrate into the effect registry at the same moment — visibility and lifecycle ownership travel together.

---

## 12. When to revisit this doc

Update this document when:

- A new field is added to character data, state data, or fighter runtime (the relevant section grows; the worked-examples section may grow).
- A new top-level data layer is introduced (e.g., a fighter loadout that holds equippable variations would be a new layer between character and runtime).
- The decision tree gets a new branch (e.g., separating "per-instance" runtime from "global runtime" if multiple fighters ever need to coordinate state).
- A wrong-layer mistake is discovered in code review — that's a sign the catalog in §7 should grow.
- A new opt-out flag enters the codebase — add it to §9's range list (as happened with `intangible`), and revisit the naming-convention guidance if the new flag exposes a tension between Pattern A and Pattern B.

The doc is the contract for where data lives. If the code has values living somewhere this doc doesn't justify, one of them is wrong.

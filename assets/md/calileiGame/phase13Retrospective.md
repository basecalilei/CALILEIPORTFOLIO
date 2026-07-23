# Phase 13 Retrospective (First Half — Steps 1–5)

## Overview

Phase 13 is Combat Foundation. Its scope per `secondHalfPlan.md` is "Hit Detection + FighterB-as-Dummy + Hitlag." We agreed early on to split it into five distinct, verifiable substeps rather than land it as one large change:

1. **FighterB** — spawn a second fighter with no input pipeline
2. **Hurtboxes** — defensive geometry per character, per state
3. **HitDetection** — new tick stage resolving attacker hitboxes against victim hurtboxes
4. **Knockback** — the launch formula, damage accumulator, Hitstun stub, universal `hitTaken` transition
5. **Hitstun** — dynamic Hitstun duration driven by per-hit data

Everything through step 5 is landed and verified. Hitlag and DI — the plan's remaining Phase 13 items — are deferred to a Phase 13b

The load-bearing framing at the start of the phase was:

> "Substrate has to be designed knowing Phase 17 (grab) and Phase 18 (projectiles) will both need their own variants of cross-entity interaction. Whatever shape hurtboxes take should generalize."

This shaped several decisions — most notably the choice to keep `hitDetectionSystem`'s AABB and world-space-transform logic inline rather than extracting shared abstractions prematurely. Each future contact-resolution system will own its own flow with different result semantics, and abstracting before we know what those need would force a shape on them.

---

## What Shipped

### Step 1: FighterB

A second fighter in the world. Not a real opponent yet — a hit target that sits in Idle and takes hits without reacting to input.

**Files:**
- **NEW** `src/data/characters/fighterB.js` — a `{...fighterA, name, color}` spread. Shallow copy: `body`, `physics`, `attacks`, and (after step 2) `hurtboxes` share references with fighterA. Documented as intentional until Phase 14c gives fighterB its own moveset.
- **NEW** `NEUTRAL_SNAPSHOT` constant in `src/core/inputBuffer.js` — frozen object matching the input snapshot contract, all fields at their "no input" value. Used by fighters without a live input source.
- **MODIFIED** `src/world/tick.js` — signature changed from `tick(world, inputs)` to `tick(world, inputsByFighter)`. Positional array indexed to `world.fighters`.
- **MODIFIED** `src/systems/inputSystem.js` — positional dispatcher. `inputsByFighter[i]` goes to `fighters[i].inputBuffer`.
- **MODIFIED** `src/main.js` — spawns both fighters, builds `[getCurrentInput(), NEUTRAL_SNAPSHOT]` per rAF.
- **MODIFIED** `src/debug/history.js` — comment naming `fighters[0]` as intentional diagnostic target.

**What we learned:** the engine was almost entirely N-fighter-clean already. Every system that iterates fighters (`inputSystem`, `stateSystem`, `physicsSystem`, `collisionSystem`, `renderer`, `debug/hitboxes.js`, `debug/liveStats.js`) had been written correctly from earlier phases. The only hardcoded `world.fighters[0]` in runtime logic was `debug/history.js`, and its choice is defensible (record the human's fighter). Phase 4's `inputSystem` comment had explicitly predicted: *"When P2 arrives, this is where the controller → fighter routing will live"* — this was where we landed, with the small refinement that the routing decision itself moved up to main.js (composition root) and inputSystem became purely a positional dispatcher.

### Step 2: Hurtboxes

Per-character, per-state defensive geometry with a `default` fallback for states that don't override. Rendered in green, drawn under (in z-order) the red hitboxes.

**Files:**
- **MODIFIED** `src/data/characters/fighterA.js` — added `hurtboxes` sibling to `attacks`. Two entries: `default` (30×60 covering the body exactly) and `Squat` (30×40, top compressed down for the crouch pose). fighterB inherits by spread.
- **NEW** `src/debug/hurtboxes.js` — visualization module. Iterates fighters, resolves per-state or default hurtbox list, skips states with `physics.intangible === true`, draws each rectangle in world space with facing-mirror.
- **MODIFIED** `src/debug/overlay.js` — call `drawHurtboxes` before `drawHitboxes` so a landed attack's red hitbox sits on top of the green hurtbox in the z-order.

**Data shape:**
```js
hurtboxes: {
  default: [{ shape: { x, y, w, h } }],
  <stateName>: [{ shape: { x, y, w, h } }],
}
```

Lookup: `hurtboxes[actionState] ?? hurtboxes.default`. Center-anchored geometry with `x` mirrored by `fighter.facing` — same convention as hitboxes exactly. List-of-entries-per-state (rather than single entry) is forward-compat for per-limb hurtboxes later, with zero authoring migration.

**First real consumer of `physics.intangible`.** The flag was a Phase 11 placeholder ("consumer to arrive with combat phase"). Step 2 gave it its first real reader (hurtbox visualization); step 3 added the second (hit detection).

### Step 3: HitDetection

A fifth tick stage, `hitDetectionSystem`, slotted after `collisionSystem`. Iterates attackers × victims, resolves boxes, writes `pendingHit` to the victim on overlap.

**Files:**
- **NEW** `src/systems/hitDetectionSystem.js` — the new stage. Contains AABB and world-space-transform helpers inline (three-consumer duplication with `debug/hitboxes.js` and `debug/hurtboxes.js`; extraction threshold not reached).
- **MODIFIED** `src/entities/fighter.js` — added `pendingHit: null` and `hitConnected: new Set()`.
- **MODIFIED** `src/world/tick.js` — imports and calls `hitDetectionSystem` after `collisionSystem`.
- **MODIFIED** `src/debug/liveStats.js` — added `pending:` row per fighter (shows `—` or `F{idx} d={dmg} a={angle} bk={base} kg={growth} hs={hitstun}`).

**pendingHit shape** (fields as of step 3; `attackerFacing` added in step 4):
```js
{
  attackerIndex:   <number>,
  damage:          <number>,
  angle:           <number>,
  baseKnockback:   <number>,
  knockbackGrowth: <number>,
  hitstun:         <number>,
}
```

**hitConnected lifecycle:** cleared inside `hitDetectionSystem` when `stateFrame === 0 && attacker has hitboxes for current state`. Never touched by state-machine effects.

**Algorithm:** for each attacker, get active hitboxes (filter by `stateFrame` against `active: [first, last]`). For each victim ≠ attacker, skip if intangible or already in attacker's hitConnected. For each (hitbox, hurtbox) pair, world-space transform both, AABB overlap check. On first overlap: write pendingHit, add to hitConnected, break out of the box loops (first-overlap-wins, author-orderable priority).

### Step 4: Knockback

Hits now cause launch. Fighters accumulate damage. The Hitstun state exists as a 1-frame stub. All 24 states route to it on hit.

**Files:**
- **NEW** `src/core/knockback.js` — pure `computeKnockback(hit, victimDamage, victimWeight) → {vx, vy}`. Melee-style formula, `VELOCITY_SCALE = 0.08` conversion to pixel/frame units.
- **MODIFIED** `src/entities/fighter.js` — added `damage: 0`.
- **MODIFIED** `src/data/characters/fighterA.js` — added `weight: 100`.
- **MODIFIED** `src/systems/hitDetectionSystem.js` — writes `attackerFacing` to pendingHit at hit time.
- **MODIFIED** `src/core/conditions.js` — added `hitTaken` condition.
- **MODIFIED** `src/core/effects.js` — added `applyHitReaction` effect (imports `computeKnockback`).
- **MODIFIED** `src/data/states/states.js` — added new `Hitstun` state (1-frame stub); universal `hitTaken` transition inserted as first entry in all 24 states via Python regex pass.
- **MODIFIED** `src/debug/liveStats.js` — added `damage: N.N%` row per fighter.

**Knockback formula:**
```
total        = victimDamage + moveDamage
damageComp   = total * 0.1 + total * moveDamage * 0.05
weightFactor = 200 / (victimWeight + 100)
base         = damageComp * weightFactor * 1.4 + 18
magnitude    = base * (knockbackGrowth / 100) + baseKnockback
speed        = magnitude * VELOCITY_SCALE       // 0.08 at time of writing
vx           = speed * cos(angle) * attackerFacing
vy           = -speed * sin(angle)              // Y-down: up is negative
```

Sakurai angle (361°) is treated as a regular angle for now — produces near-horizontal launch since cos(361°) ≈ cos(1°). Proper Melee "horizontal at low %, vertical at high %" semantics is Phase 14+.

**applyHitReaction ordering:**
1. Snapshot pendingHit into a local
2. `computeKnockback` (uses damage BEFORE the hit's damage is added — Melee convention: post-hit percent enters the formula via internal `total = victim + move`)
3. Apply vx/vy
4. Increment damage
5. Write `pendingHitstunFrames` from `hit.hitstun ?? 0` (added in step 5)
6. Clear pendingHit

**Universal hitTaken transition wiring.** All 24 states got `{ when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' }` as their first transition via a single Python regex pass on states.js. Priority order chosen: `hitTaken → notGrounded → everything else`. Hit reactions preempt every other transition.

### Step 5: Hitstun

Hitstun becomes duration-dynamic. Per-hit hitstun values (already carried through `pendingHit` since step 3) finally get consumed. Combos become possible.

**Files:**
- **MODIFIED** `src/entities/fighter.js` — added `pendingHitstunFrames: 0`.
- **MODIFIED** `src/core/effects.js` — `applyHitReaction` gains one line: `fighter.pendingHitstunFrames = hit.hitstun ?? 0`.
- **MODIFIED** `src/core/conditions.js` — added `hitstunFinished` condition (`stateFrame >= pendingHitstunFrames`).
- **MODIFIED** `src/data/states/states.js` — Hitstun's `duration: 1` removed; `durationElapsed → Fall` swapped for `hitstunFinished → Fall`.

**Re-hit semantics:** the `hitTaken` self-transition in Hitstun's transitions list works for free. A hit during Hitstun re-fires `applyHitReaction`, which overwrites `pendingHitstunFrames`. The state machine resets `stateFrame` to 0 on the Hitstun → Hitstun transition. Fresh launch, fresh timer.

**Defensive `?? 0` in `applyHitReaction`:** an attack authored without a `hitstun` field would produce `undefined` in the `stateFrame >= undefined` comparison, which is always false → permanent paralysis. The 4-character insurance produces "0-frame hitstun" (immediate Fall transition) as the graceful failure mode.

---

## Load-Bearing Decisions

### Positional-array tick signature (step 1)

Chose `tick(world, inputsByFighter)` — main.js builds the positional array — over adding an `inputSource` field to fighter runtime. Composition-root ownership: "who feeds whom" is a main.js concern, not distributed across systems. The change touched three files (`tick.js`, `inputSystem.js`, `main.js`) and preserved every system's generic-iteration pattern.

The alternative (fighter has `inputSource: 'keyboard' | 'stub'`, inputSystem dispatches via registry) would have introduced a stringly-typed enum and required the input system to know about source types. Rejected.

### Hurtboxes as list-of-entries even when length=1 (step 2)

Same Phase 12 hitbox precedent applied prospectively. Every current state has exactly one hurtbox; the shape is `[{...}]` anyway so per-limb arrays drop in later as `[{shape: arm}, {shape: leg}, {shape: body}]` with zero authoring migration.

### Character-keyed hurtboxes with 'default' fallback (step 2)

User's articulated requirement: "unique to each fighter — different fighters will be different sizes." State-level hurtbox data would have been universal-across-characters (a hypothetical Bowser's Squat would share geometry with fighterA's Squat). Character-level is the only correct layer for this data.

### hitConnected as hit-detection-internal scratchpad (step 3)

Chose internal reset (`stateFrame === 0 && has hitboxes`, checked at top of each attacker's iteration in `hitDetectionSystem`) over adding `resetHitConnected` as an effect on ~20 attack-entry transitions.

Justification: `hitConnected` is never read by any condition. Compare to `airJumpsUsed` — that field IS read by the `canAirJump` condition, so its reset must be visible to the state machine via an effect. `hitConnected` has no such consumer; the state machine never needs to see it. The system that owns a field owns its lifecycle.

Trade-off accepted: reset behavior isn't declared in state data. A reader of `states.js` can't see it. Mitigation is documentation in `hitDetectionSystem.js` — the header comment explains the semantics.

### pendingHit as self-contained snapshot (step 3)

Not a reference to the live hitbox object. Fields are copied at hit time. Rationale: (a) character config is read-only-by-convention, while pendingHit is a moment-in-time event with its own lifetime; (b) decouples the lifetime of pendingHit from the lifetime of the attack's active window — the attacker can transition out of the attack state before the victim's state machine consumes pendingHit, and the data stays valid.

### attackerFacing in pendingHit (step 4)

Snapshot at hit time. Chose over live-lookup via `attackerIndex`.

Rationale: (a) kept effects single-argument (matching every other effect), no world access needed; (b) semantically stable — the hit's direction is settled when contact occurs; if the attacker pivots between write and consume, the launch direction shouldn't distort.

### Stub Hitstun in step 4 vs stateless velocity-applier

Chose the stub. Hitstun exists as a real state in step 4 with `duration: 1`; step 5 only had to swap `duration`/exit-condition and add the field-write in `applyHitReaction`.

The alternative was: ship knockback in step 4 as a system or effect that sets velocity WITHOUT a state transition (no Hitstun state at all), then introduce Hitstun as a state in step 5 with all 24 `hitTaken` transitions authored fresh.

The stub was cleaner because the 24 `hitTaken` transition inserts are the biggest authoring chunk in the phase — landing that wiring in step 4 and never touching it again beat authoring throwaway velocity-applier logic in step 4 and retiring it in step 5.

### Composite `applyHitReaction` over array-of-effects extension (step 4)

Deferred the state-machine substrate change. `applyHitReaction` handles knockback + damage-accumulate + `pendingHitstunFrames`-write as one atomic effect.

`core/effects.js` has a comment on `resetAirActions` noting this same tension: *"The state machine supports one effect per transition; composing multiple resets into one effect is the cheapest factoring while only two counters need it."* Phase 13a didn't force the extension — the composite worked. Hitlag (deferred to 13b) will likely be the trigger, since freezing both fighters is a distinct enough action from applying knockback that composing them into one effect starts to feel wrong.

### `hitstunFinished` as sibling condition to `durationElapsed` (step 5)

Chose a new condition that reads a fighter-runtime field (`pendingHitstunFrames`) over extending `durationElapsed` to also check runtime fields.

`durationElapsed` reads a state-data field (`state.duration`). Its semantics ("this state's fixed duration has elapsed") stayed intact for fixed-duration states. `hitstunFinished` has different semantics ("this dynamic per-hit duration has elapsed") and gets its own name.

### Universal `hitTaken` as first transition in every state (step 4)

Chose explicit-in-data over interpreter-magic (a state-machine extension that automatically checks `pendingHit` before consulting per-state transitions).

Rationale: (a) declarative — a reader of `states.js` sees that hit can happen; (b) per-state override remains possible if needed later; (c) a mechanical 24-place edit via a Python regex pass is safer than trusting a single interpreter change.

Priority order chosen: `hitTaken → notGrounded → everything else`. Every state gets `hitTaken` first, including states like AirDodge — redundant since `intangible` blocks pendingHit-writes there, but harmless and defensive.

---

## Gotchas / Discoveries

### `Fall.fallSpeedMax` masks knockback

Terminal velocity in Fall is 6.0. Knockback at low damage produces launch vy well below that. During the step-4 1-frame Hitstun stub, this made spikes look completely broken.

Discovery: user observed down-air after a combo (B at ~6% damage). The dair produced vy = 5.09 — literally BELOW the terminal velocity B was already at. The spike appeared to do nothing.

The immediate fix was step 5 (longer Hitstun that keeps the launched fighter uncapped during the launch window). But even step 5 doesn't fully solve this: after hitstun ends, Fall's cap kicks back in, so post-hitstun motion always reads as terminal-velocity falling regardless of how hard the spike was.

The proper fix is a **Tumble** state (Melee's name) between Hitstun and Fall — uncapped fall with its own recovery behavior. Phase 14+.

### Shallow-spread inheritance for fighterB is load-bearing

`fighterB = {...fighterA, name, color}` means `fighterB.hurtboxes` (added in step 2) is the same object reference as `fighterA.hurtboxes`. Works today because nothing mutates config. Load-bearing when fighterA's hurtboxes get tuned — B's hurtboxes move with A's.

Documented as intentional-until-14c-forces-divergence. When Phase 14c gives fighterB its own moveset, the file becomes a proper standalone character config and the shared references go away. The reason to keep the spread now is that authoring one hurtbox and getting two is strictly less work than authoring two identical hurtboxes.

### Sakurai angle (361°) not properly handled

The formula treats 361° as a regular angle → cos(361°) ≈ cos(1°) → near-horizontal launch. Melee's Sakurai-angle semantics ("horizontal at low %, vertical at high %") is not implemented. Whether it matters depends on whether fighterA's authored attacks use 361° meaningfully. Deferred to Phase 14+.

### `?? 0` defensive default in `pendingHitstunFrames`

`fighter.stateFrame >= undefined` is always false → permanent paralysis if any attack is ever authored without a `hitstun` field. The 4-character insurance produces "0-frame hitstun" (immediate Fall transition) as graceful failure. Cheap.

### Effect ordering inside `applyHitReaction`

`damage` must be incremented AFTER `computeKnockback` — the formula uses the pre-hit damage as input, and internally computes `total = victim + move`. Pre-incrementing would double-count the hit's contribution.

### VELOCITY_SCALE — global scale vs per-attack tuning

Decision tree that emerged from a user question about tunables:
- "This one move is wrong" → attacks table (damage/angle/BKB/KBG/hitstun on `character.attacks[state].hitboxes[N]`)
- "This character feels too light/heavy" → `physics.weight`
- "Every hit feels too punchy / too floaty" → `VELOCITY_SCALE`

Worth capturing because the temptation with a wrong-feeling move is to reach for `VELOCITY_SCALE`. Almost always wrong — it globally shifts every attack across every character.

`VELOCITY_SCALE` was set to 0.08 at initial write. May need retuning now that step 5 makes launches visible for many frames instead of one. Feel-test after step 5 has settled.

---

## What This Enables

The substrate now supports:

- **Cross-fighter interaction as a first-class concept.** `hitDetectionSystem`'s structure — iterate attackers × victims, resolve boxes, check overlap — is the template for Phase 17 (grab) and Phase 18 (projectiles). Each will own its own contact-resolution flow with different result semantics, but the pattern is set.
- **Damage accumulation.** Melee-style % display. Consumed by the knockback formula. Currently never reset; Phase 19 (KO/respawn/stocks) will introduce that.
- **`physics.intangible` as a real consumer flag.** Two active readers now (hurtbox viz + hit detection). Phase 15 (roll dodge, spot dodge, frame-windowed invulnerability) will build on this — likely with an extension for per-frame windows.
- **`weight` as a real character parameter.** Used in the knockback formula. Adding heavier or lighter fighters is now a one-line character config change.
- **Universal transitions as an established pattern.** When future universal transitions arrive (grab-taken? hazard-taken? edge-catch?), the wiring pattern from `hitTaken` is proven.
- **Real feedback loop: attack → damage → stronger knockback → longer flight.** The core loop of a fighting game exists.

---

## Deferred

### To Phase 13b (Hitlag + DI)

- **Hitlag** — the freeze-both-fighters frames on hit. Would require array-of-effects extension to state-machine interpreter (applyHitReaction + applyHitlag on the same transition). Not force-required in 13a because Hitstun alone provides visible hit feedback.
- **Directional Influence (DI)** — allowing the hit fighter to angle their launch via stick input during hitstun. Substrate exists (pendingHit has angle, could be modified by input); needs design pass on how DI reads from the buffer and when it applies (at hit-frame? every hitstun tick? end of hitstun?).
- **Array-of-effects state-machine extension** — ~6 lines when it lands. Triggered by hitlag or any hit reaction needing multiple atomic effects.

### To Phase 14

- **Tumble state** — uncapped post-hitstun fall so spikes remain fast after hitstun ends. Currently spikes look right during hitstun and then hit Fall's cap; Tumble smooths this transition.
- **Sakurai angle proper semantics** — "horizontal at low %, vertical at high %."
- **Per-aerial landing lag + L-cancel** — Phase 14a scope.
- **Multi-hit / sweet-sour hitbox authoring** — Phase 14b scope.
- **FighterB's real moveset + independent hurtbox/physics/attacks config** — Phase 14c. Also the moment shallow-spread inheritance in `fighterB.js` gets replaced by full standalone config.

### To Phase 19+

- **KO / respawn / stocks** — the consumer that zeros damage. Currently damage climbs indefinitely.
- **Death plane** — currently fighters flying off-screen just keep going into negative-space coordinates.

### Debug UX

- **"Tracked fighter" selector for history panel** — currently records `fighters[0]` only. When 14c gives fighterB real behavior, this becomes needed.

---

## Statistics

- **Steps completed:** 5 of ~7 (Phase 13a done; hitlag and DI remain for 13b)
- **New files:** 4 (`fighterB.js`, `hurtboxes.js`, `hitDetectionSystem.js`, `knockback.js`)
- **New systems:** 1 (`hitDetectionSystem` — first cross-fighter interaction system in the engine)
- **New states:** 1 (Hitstun)
- **New conditions:** 2 (`hitTaken`, `hitstunFinished`)
- **New effects:** 1 (`applyHitReaction`)
- **New universal transitions:** 24 (`hitTaken`, added to every state via regex pass)
- **New fighter runtime fields:** 4 (`pendingHit`, `hitConnected`, `damage`, `pendingHitstunFrames`)
- **New character config fields:** 2 (`hurtboxes`, `physics.weight`)
- **pendingHit fields introduced across the phase:** 7 (`attackerIndex`, `attackerFacing`, `damage`, `angle`, `baseKnockback`, `knockbackGrowth`, `hitstun`)
- **Tick stages:** 4 → 5 (input → state → physics → collision → **hitDetection**)

---

*Phase 13b (Hitlag, DI) — to be added.*
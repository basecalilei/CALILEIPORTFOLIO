# physics.md

The physics system is what moves bodies through space. It reads the state's modifiers and the character's base constants, applies gravity if airborne, drives horizontal motion through one of four modes, and integrates velocity into position. It runs once per fighter per tick, after the state machine and before collision.

This document covers the pure functions in `core/physics.js`, the orchestration in `systems/physicsSystem.js`, the four horizontal modes, the asymmetric air-drift cap that lets dash-off-edge feel right, and the tuning intuition that governs how character stats and state modifiers compose to produce game feel.

Read this before any work that touches motion, gravity, friction, or velocity. The asymmetric cap in particular is the kind of rule whose violation produces bugs that look like animation problems but are actually math problems.

---

## 1. The shape

The physics layer has two pieces:

- **The primitives** (`core/physics.js`) — pure functions on a "body" (`{x, y, vx, vy, grounded}`). Five functions: `applyGravity`, `applyFriction`, `setHorizontalSpeed`, `addHorizontalVelocity`, `integrate`. Knows nothing about fighters or states.
- **The system** (`systems/physicsSystem.js`) — the per-frame orchestrator. Reads the fighter's current state, composes character base × state multiplier, dispatches to the right horizontal mode, integrates.

The primitives are reusable across any body in the World — fighters today, projectiles later, knockback victims, anything with the five fields. The system is the bridge that knows about fighters specifically and consults state data through `world.states[fighter.actionState]`.

---

## 2. The primitives

```js
applyGravity(body, gravity, maxFallSpeed)
applyFriction(body, friction)
setHorizontalSpeed(body, speed)
addHorizontalVelocity(body, accel, maxSpeed)
integrate(body)
```

Each is a small, focused mutation on the body. They are called from `physicsSystem`, never from each other, never from outside the physics layer.

**`applyGravity(body, gravity, maxFallSpeed)`.** Adds `gravity` to `body.vy`, then caps the result at `maxFallSpeed` *if and only if vy is positive after the add*. The cap is a terminal velocity for descending — it never touches rising velocity. If `maxFallSpeed` is `undefined` or `null`, no cap is applied. The asymmetry (cap descent, leave ascent alone) is what allows a jump impulse of vy = -8.0 to be larger than the fall cap of 6.0 without the impulse being immediately clamped.

**`applyFriction(body, friction)`.** Reduces `|vx|` by `friction` per frame, toward zero. If `friction > |vx|`, vx snaps to 0 rather than flipping sign. Friction alone never reverses direction. This guarantees a fighter sliding to a stop comes to rest at exactly 0, no oscillation.

**`setHorizontalSpeed(body, speed)`.** Assigns `body.vx = speed`. Used by modes where the speed is determined by stick or facing combined with a character stat (walk speed, dash speed), not by accumulating accel over time.

**`addHorizontalVelocity(body, accel, maxSpeed)`.** Accumulates velocity with an asymmetric cap. The rules are subtle enough to deserve their own section (§5). Used only by air mode.

**`integrate(body)`.** `x += vx; y += vy`. Single-step Euler. Called once per fighter per tick, after gravity and horizontal motion have set the velocities for this frame. Frame rate is fixed at 60Hz so dt is implicit and constant; forces are already per-frame quantities, not per-second. The math reads identically in any language.

All five functions go through `fixedMath` for the arithmetic. See `tick.md` §10 and `dataModel.md` for the `fixedMath` rationale; for physics purposes, treat `fm.add`, `fm.mul`, etc., as drop-in replacements for `+`, `*` that the engine can swap to integer math later without touching call sites.

---

## 3. The system

```js
export function physicsSystem(world) {
  for (const fighter of world.fighters) {
    const state = world.states[fighter.actionState];
    const mods = state.physics;
    const cfg = fighter.config.physics;

    const now = fighter.inputBuffer[0];
    const stickX = now ? now.stickX : 0;

    if (!fighter.grounded) {
      physics.applyGravity(fighter, cfg.gravity * mods.gravity, mods.fallSpeedMax);
    }

    const mode = horizontalModes[mods.horizontalMode];
    if (!mode) throw new Error(...);
    mode(fighter, stickX, cfg, mods);

    physics.integrate(fighter);
  }
}
```

Per fighter, in order:

1. **Look up the current state and its physics modifiers.** Read once per tick; reused for both gravity and the horizontal mode.
2. **Read the current input snapshot.** Defensively defaults `stickX` to `0` if the buffer is empty (which only happens on tick 1 of a fresh fighter, since input runs first).
3. **Apply gravity if airborne.** Pass `cfg.gravity * mods.gravity` as the per-frame increment. The multiplication composes the character's base gravity with the state's multiplier at the call site — the combined value is never stored.
4. **Dispatch to the horizontal mode** registered in `mods.horizontalMode`. Throws if the mode name is unknown; this is a guard for typos in state data.
5. **Integrate.** `x += vx; y += vy` via `physics.integrate(fighter)`.

The system reads state data for modifiers and character data for base constants. It writes `vx`, `vy`, `x`, `y` on the fighter, and in walk mode it also writes `facing`. It does not touch `actionState`, `stateFrame`, `grounded`, `airJumpsUsed`, or the input buffer. See `tick.md` §6 for the full read/write contract across systems.

---

## 4. Gravity

```js
if (!fighter.grounded) {
  physics.applyGravity(fighter, cfg.gravity * mods.gravity, mods.fallSpeedMax);
}
```

Gravity is only applied to airborne fighters. The grounded check is the system's gate, not the primitive's — `applyGravity` itself doesn't know about grounded. This separation lets the primitive be reused for cases where "the body is always affected by gravity" (e.g., future projectiles that don't have a grounded concept).

The per-frame increment is **base × multiplier**, composed at the call site:

- `cfg.gravity` is the character's per-frame base rate. For fighterA: `0.4` px/frame².
- `mods.gravity` is the current state's multiplier. Typical values: `1.0` (Fall, AirJump, Walk, etc.), `0` (JumpSquat, FastFall).

Multiplying gives the effective per-frame velocity increase. For fighterA in Fall: `0.4 × 1.0 = 0.4 px/frame²`. In FastFall: `0.4 × 0 = 0` — no acceleration, so the velocity set by the `applyFastFall` effect stays constant.

The cap is the state's `fallSpeedMax`, or none if absent. Current values: Fall = 6.0, AirJump = 6.0, FastFall = 9.0. Grounded states don't declare a cap because gravity isn't applied to them; the `!fighter.grounded` gate makes the omission safe.

### Why FastFall has both `gravity: 0` and `fallSpeedMax: 9`

The two together are defensive. `gravity: 0` means no per-frame acceleration, so vy stays at whatever `applyFastFall` set (9.0). The cap is technically redundant given the lack of acceleration — but if a future system applies an external downward force (knockback into a meteor smash, a wind effect, anything), the cap prevents the fighter from exceeding 9 during fast-fall regardless of how that force tried to push them. The state data file comment notes this explicitly. The redundancy is intentional load-bearing.

### Why gravity is only positive

`applyGravity` adds `gravity` and clamps only if `vy > maxFallSpeed`. Rising velocity is never touched by the cap. This is what lets a character jump higher than their fall terminal velocity. The trace below uses fighterA's defaults (jumpForce 8.0, gravity 0.4, Fall's fallSpeedMax 6.0) for concreteness; the substrate is the same under any tuning, as long as `jumpForce > fallSpeedMax` (otherwise gravity's first frame would already cap and the impulse would be quietly clipped):

- `applyJumpImpulse` sets `vy = -8.0` (Y-down, so negative = upward).
- The next frame's `applyGravity` adds 0.4, vy becomes -7.6. The cap check: is `-7.6 > 6.0`? No. Pass.
- Several frames later, vy is somewhere around -0.4. Add 0.4: vy = 0. Check `0 > 6.0`? No. Pass.
- Eventually vy passes 6.0. Cap fires: vy = 6.0.

If the cap applied to rising velocity, the initial impulse would be clamped to the descent terminal immediately (the impulse magnitude exceeds the cap in absolute terms), and the jump height would be wrong. Asymmetric capping is the right rule, and the architectural condition it preserves is **jumpForce must exceed any state's fallSpeedMax for the impulse to survive its first frame** — a constraint every future fighter must honor.

---

## 5. The four horizontal modes

Each state declares `physics.horizontalMode`: one of `'none' | 'walk' | 'air' | 'dash'`. `physicsSystem` dispatches to the matching mode.

| Mode    | Formula                                          | Used by                              | Reads                          | Writes        |
|---------|--------------------------------------------------|--------------------------------------|--------------------------------|---------------|
| `none`  | apply friction toward zero                       | Idle, Squat, JumpSquat, Land, DashStop, AirDodge, Hitstun, all six ground attacks | `cfg.friction`, `mods.friction` | `vx`          |
| `walk`  | `vx = stickX * walkSpeed`                        | Walk                                 | `stickX`, `cfg.walkSpeed`       | `vx`, `facing` |
| `air`   | `vx += stickX * airAccel`, asymmetric cap        | Fall, AirJump, FastFall, all five aerials | `stickX`, `cfg.airAccel`, `cfg.airSpeedMax` | `vx`          |
| `dash`  | `vx = facing * dashSpeed`                        | Dash, DashBack, Run                  | `facing`, `cfg.dashSpeed`       | `vx`          |

**`none` mode** applies friction. The character's `friction` is multiplied by the state's friction multiplier — Idle/Squat/Land/DashStop use `1.0`, JumpSquat uses `0` (no friction during the jump-squat windup, so any pre-jump motion is preserved into the jump). Friction never reverses direction — the primitive snaps to 0 instead of flipping sign. Phases 11–13 made `none` the workhorse mode: AirDodge pairs it with `gravity: 0, friction: 0` so the entry effect's locked velocity runs untouched; DashAttack pairs it with friction so entry dash-speed bleeds into the signature momentum slide; Hitstun pairs it with reduced friction so launches decelerate naturally on the ground.

**`walk` mode** sets vx directly. Walking has no acceleration curve; the velocity snaps to `stickX * walkSpeed` every frame. Releasing the stick makes stickX = 0 next frame, vx becomes 0, and the fighter stops instantly. The condition `noHorizontalInput` then fires the transition to Idle. Walking also updates `facing` to match the stick direction — you face the way you walk.

**`air` mode** is the only mode that uses `addHorizontalVelocity` and the only mode where airSpeedMax matters. The asymmetric cap is what makes this mode unique — see §6. Air mode deliberately does **not** update `facing`: you can drift backward while facing forward, which is Melee-canonical and load-bearing. A facing-commit line *did* live here from Phase 4 to Phase 12 — a copy-paste from walk mode — and sat inert until aerial back-attacks became the first consumer of stable air facing, at which point B-air was unreachable on keyboard (pressing back to aim the attack turned the fighter around first). The fix was deleting the line. A comment in `physicsSystem.js` guards the absence; re-adding it to "fix the inconsistency" with walk mode would break back-airs, drift-away spacing, and every future moonwalk-style mechanic. In the air, facing changes only by discrete commit (attack-press effects), never by drift.

**`dash` mode** sets vx to `facing * dashSpeed`. Note that dash mode reads `facing`, not `stickX`. This is what lets the player release the stick after slamming and have the dash continue — the slam captured the direction into `facing` via the `commitFacingFromSlam` effect, and dash physics reads the captured value. Dash mode does *not* update facing; that would defeat the point of capturing it. See `stateMachine.md` §7 for the capture-vs-live pattern.

### The dispatch table is a tiny internal registry

```js
const horizontalModes = {
  none: (fighter, _stickX, cfg, mods) => { ... },
  walk: (fighter, stickX,  cfg, _mods) => { ... },
  air:  (fighter, stickX,  cfg, _mods) => { ... },
  dash: (fighter, _stickX, cfg, _mods) => { ... },
};
```

Adding a new mode is one entry. The system never grows special cases — it dispatches through the table. If a future state needs motion that doesn't fit any of these (a wall-slide with constant downward speed, a tumble with its own drag curve), the new mode goes here as a new entry. The naming convention is one short verb that describes the motion pattern.

Worth knowing before adding one: air-dodge was once on this hypothetical list ("an air-dodge with directional locked motion") and ended up *not* needing a mode. The locked trajectory came from composing existing pieces — an entry effect writes the velocity once, and `none` mode with `gravity: 0, friction: 0` simply never touches it. Ten minutes reading the primitives beat a new dispatch entry. If you find yourself wanting to add a special case inside an existing mode for a specific state, the special case probably wants to be its own mode — but first check whether an effect plus the existing modifiers already expresses it.

---

## 6. The asymmetric air-drift cap

This is the rule that makes dash-off-edge work. The `addHorizontalVelocity` primitive implements it:

```js
function addHorizontalVelocity(body, accel, maxSpeed) {
  const oldVx = body.vx;
  const next = fm.add(oldVx, accel);

  // (a) accel keeps us inside [-max, +max] → take it normally
  if (next <= maxSpeed && next >= -maxSpeed) {
    body.vx = next;
    return;
  }

  // (b) we were inside the range and now we'd cross out → clamp to the cap
  if (oldVx >= -maxSpeed && oldVx <= maxSpeed) {
    body.vx = next > maxSpeed ? maxSpeed : -maxSpeed;
    return;
  }

  // (c) we were already outside the range. Only opposite-direction accel
  //     applies; same-direction accel is ignored (no further outward push).
  if (fm.sign(accel) !== fm.sign(oldVx)) {
    body.vx = next;
  }
}
```

Four behaviors, three branches. The behaviors:

1. **Accel within range** — accept normally. Walking-speed air drift in either direction.
2. **Accel crosses out of range** — clamp to the cap. Drifting from -1.5 with +1.0 acceleration would put you at -0.5; this branch handles the case where the result would exceed the cap.
3. **Already over cap, accel pushes further out** — ignore. The cap doesn't yank you back; it just refuses to accelerate you outward.
4. **Already over cap, accel pulls back toward zero** — apply normally. Deceleration always works.

### Worked example: dash-off-edge

The architectural condition the asymmetric cap supports is **a character whose `dashSpeed > airSpeedMax` can preserve dash velocity into the air**. fighterA satisfies this (2.8 > 2.0), so the trace below uses fighterA's values for concreteness. A future fighter could intentionally have `dashSpeed <= airSpeedMax` to make their dash "land" at the same speed as their max aerial drift — a more committed-feeling dash with no dash-off-edge advantage. The substrate handles both shapes identically; the emergence only appears when the inequality holds.

Trace with fighterA (`airAccel = 0.1`, `airSpeedMax = 2.0`, `dashSpeed = 2.8`). Player dashes right, then walks off the edge. The dash state ends (notGrounded fires); the fighter is now in Fall, vx = 2.8.

Frame 1 in Fall, holding right:
- `stickX = +1`, `accel = +1 * 0.1 = +0.1`
- `oldVx = 2.8`, `next = 2.9`
- Branch (a): `2.9 <= 2.0 && 2.9 >= -2.0` — false (`2.9 <= 2.0` fails). Skip.
- Branch (b): `2.8 >= -2.0 && 2.8 <= 2.0` — false. Skip.
- Branch (c): `sign(0.1) !== sign(2.8)` → `+1 !== +1` — false. Skip.
- vx stays at 2.8.

The player keeps moving right at dash speed even though it's above the air cap. They can't accelerate further outward, but they don't get yanked back either.

Same setup, but the player presses LEFT after dashing off:
- `stickX = -1`, `accel = -0.1`
- `oldVx = 2.8`, `next = 2.7`
- Branch (a): false (`2.7 <= 2.0` fails). Skip.
- Branch (b): false. Skip.
- Branch (c): `sign(-0.1) !== sign(2.8)` → `-1 !== +1` — true. Apply: vx = 2.7.

The player can air-brake. Holding the opposite direction reduces velocity at the air-accel rate. This is what enables aerial reversals after dashing off.

Same setup, no stick input:
- `stickX = 0`, `accel = 0`
- `oldVx = 2.8`, `next = 2.8`
- Branch (a): false. Branch (b): false.
- Branch (c): `sign(0) !== sign(2.8)` → `0 !== +1` — true. Apply: vx = 2.8.
- Effectively no change (we set vx = next, which equals oldVx). This is the same outcome as branch-c with no accel — the player keeps moving at dash speed.

### Why this rule

A symmetric cap ("clamp vx to ±max every frame") would yank the dash-off-edge speed back to 2.0 instantly. The dash velocity would vanish on the first airborne frame, breaking the emergent technique of running off the edge to gain aerial speed.

A "soft cap" (apply a counter-force proportional to over-cap excess) would slow the over-cap velocity over time. This is plausible and feels different — characters would lose their dash speed gradually rather than preserving it. Whether to switch is a design call, but the current rule's emergence is preserving momentum precisely, which composes with future techniques (chained dash-off-jumps, wall-jump preservation, knockback DI) without surprises.

The rule generalizes beyond dash, and Phase 13 cashed the first check: `applyHitReaction` writes launch velocities well above the air cap, and air drift preserves them — a launched fighter keeps their knockback speed, can DI-brake against it at air-accel rate, but can't pump it higher. Wall-jump velocities and aerial impulses will get the same treatment. The rule is "the cap limits new outward acceleration; it doesn't define the maximum vx that can exist."

---

## 7. Friction

`physics.applyFriction` is called by `none` mode with `cfg.friction * mods.friction` as the per-frame reduction. The primitive reduces `|vx|` by that amount, snapping to 0 if the reduction would exceed `|vx|`.

```js
applyFriction(body, friction) {
  const speed = fm.abs(body.vx);
  if (speed <= friction) {
    body.vx = 0;
  } else {
    body.vx = fm.sub(body.vx, fm.mul(fm.sign(body.vx), friction));
  }
}
```

The composition (base × multiplier) is the same pattern as gravity. For fighterA in Idle (`mods.friction: 1.0`): `0.1 × 1.0 = 0.1 px/frame²` deceleration. In Land (`mods.friction: 1.0`): same. In JumpSquat (`mods.friction: 0`): no deceleration — pre-jump motion carries through.

JumpSquat's `mods.friction: 0` is significant. JumpSquat is `horizontalMode: 'none'`, so friction is the only horizontal-motion mechanism. Setting the multiplier to 0 means JumpSquat preserves whatever vx the fighter had on entry. Walking into a jump preserves walk speed across all three JumpSquat frames into the resulting Fall. This is the mechanism for "jump-cancel-walk" feel — no special case, just a friction multiplier set to zero.

### Why friction can't reverse direction

The primitive's "snap to zero if friction would exceed |vx|" rule is what makes "fighter coming to a stop" not oscillate. Without the snap, a vx of 0.05 with friction 0.1 would become vx = -0.05 (overshoot), then next frame vx = 0.05 (overshoot again, in the original direction). The fighter would chatter between two near-zero values forever. The snap ensures a clean stop at 0.

The general principle: friction is a one-way force, always opposing current motion. It cannot create motion, and it cannot flip the sign of existing motion.

---

## 8. Integration

```js
export function integrate(body) {
  body.x = fm.add(body.x, body.vx);
  body.y = fm.add(body.y, body.vy);
}
```

Single-step Euler. `x += vx; y += vy`. Two lines.

Why this is enough:

- **Frame rate is fixed at 60Hz.** `dt` is implicit and constant. There's no need to multiply by elapsed time; every force is already a per-frame quantity.
- **Gravity, friction, and accel are all per-frame.** Their values would change if dt changed, but dt doesn't change.
- **The forces are small relative to typical velocities.** Gravity adds 0.4 to vy each frame against velocities in the range of 1-9. The Euler integration error is negligible at these magnitudes and at this dt.
- **Higher-order integrators (RK4, Verlet, semi-implicit Euler) have higher costs in code and arithmetic complexity.** None of them produce visibly different motion for a platform fighter's force scales.

Integration runs after gravity and horizontal motion have written the new velocities. Collision runs immediately after integration. The position written by integration is "where the fighter would be if there were no surfaces"; collision corrects it for surfaces. The two-step pattern (integrate then resolve) is standard for game physics at this complexity.

---

## 9. Tuning intuition

The character config is where balance lives. State data multipliers modulate it situationally. This is what each knob does in motion.

The values shown below as `default` are fighterA's specific tuning, included for concreteness. The substrate behaves the same way under any tuning. Where one knob's behavior depends on its relationship to another (e.g., `dashSpeed > airSpeedMax`), the relationship is the architectural condition; the specific values are an instance of that condition. A future fighterB, fighterC, fighterD may pick different values, and as long as the relevant architectural conditions hold, the substrate continues to behave as described.

### Character constants

**`gravity`** (default 0.4). The per-frame downward acceleration while airborne. Higher = heavier-feeling character, snappier jumps, shorter air time. Lower = floatier, longer air time, more time for aerial decisions. Doubling this without changing `jumpForce` halves jump height.

**`friction`** (default 0.1). Per-frame deceleration in `none` mode. Higher = stops faster after dash, less ground slide. Lower = longer slide, more skating feel. Affects DashStop's duration in practice (the fighter exits DashStop on `durationElapsed`, but their final position depends on how much velocity was still left to bleed off).

**`walkSpeed`** (default 1.6). Maximum walking velocity. Walk-traversal time across a stage of width W is `W / walkSpeed` frames (96 px/sec at fighterA's value and a 60Hz tick). Higher = faster ground travel without committing to a dash.

**`jumpForce`** (default 8.0). Initial upward vy when JumpSquat completes. Higher = jumps higher. Jump height in a vacuum is `jumpForce² / (2 * gravity)` — for fighterA's defaults that's `64 / 0.8 = 80 px`, roughly 1.3 body heights. The architectural condition is `jumpForce > Fall's fallSpeedMax` so the impulse survives its first gravity tick (see §3).

**`airAccel`** (default 0.1). Per-frame horizontal acceleration in air mode. Higher = more aerial control, faster direction changes mid-air. Lower = committed aerial trajectories, slow lateral changes. Time to reach airSpeedMax from rest is `airSpeedMax / airAccel` frames — for fighterA's defaults that's 20 frames.

**`airSpeedMax`** (default 2.0). The horizontal air-drift cap. Higher = faster maximum aerial speed without a dash. Lower = aerial motion feels more committed and less wavedash-like. The relationship that matters is `airSpeedMax` versus `dashSpeed` (see `dashSpeed` below and §6) — fighterA has `airSpeedMax < dashSpeed`, which preserves dash velocity into the air; a fighter with `airSpeedMax >= dashSpeed` would lose that emergence.

**`maxAirJumps`** (default 1). How many air jumps before landing. The `canAirJump` condition gates on `airJumpsUsed < maxAirJumps`. Increasing this gives more aerial recovery; decreasing to 0 removes air jumps entirely (some characters might want this).

**`airJumpForce`** (default 8.0). vy snapped on each air jump. Equal to `jumpForce` for fighterA; could be different to make air jumps weaker or stronger than ground jumps. No architectural relationship to other values — purely a feel knob.

**`dashSpeed`** (default 2.8). Velocity locked in during Dash, DashBack, and Run. Higher = faster ground burst. The dash-off-edge emergence depends on `dashSpeed > airSpeedMax`; reducing dashSpeed below airSpeedMax (or raising airSpeedMax above dashSpeed) would remove the preservation effect — the cap would be inclusive of dash speed and there'd be nothing to preserve. This is the most consequential cross-knob relationship in the character config.

**`fastFallSpeed`** (default 9.0). vy snapped on fast-fall trigger. Higher = faster descent commit, shorter aerial recovery time after fast-fall. Should be paired with the FastFall state's `fallSpeedMax` (typically `fallSpeedMax >= fastFallSpeed` so the cap doesn't immediately bleed the impulse; equal is fine, higher gives headroom against future external forces).

**`maxAirDodges`** (default 1). How many air dodges before landing. The `canAirDodge` condition gates on `airDodgesUsed < maxAirDodges`. Setting to 0 removes air-dodge for that character; 2+ enables multiple dodges per aerial phase.

**`airDodgeSpeed`** (default 5.0). Velocity magnitude of the air-dodge vector. Determines the maximum distance the dodge can cover (`airDodgeSpeed × AirDodge.duration` pixels horizontally) and the wavedash slide distance after landing (depends additionally on the character's `friction` and Land/Idle's friction multipliers — see phase 11's wavedash trace).

**`weight`** (default 100). Phase 13. Not consumed by the physics system at all — it's the knockback formula's divisor (`200 / (weight + 100)` in `core/knockback.js`; see `calileiGame.md` §8.12). Higher = launches shorter (a heavy), lower = launches farther (a light). It lives with the physics constants because it's the same kind of intrinsic tunable, and because the tuning ladder runs through it: one *move* feels wrong → that move's `attacks` entry; one *character* feels wrong → their `weight`; *every* hit feels wrong → `VELOCITY_SCALE` in `knockback.js`. Reaching for the global constant to fix a local problem is the classic mistake.

### State multipliers

The state's `physics.gravity` and `physics.friction` are multipliers on the character's base. Common values:

- **`gravity: 1.0`** in most airborne states (Fall, AirJump). Normal gravity.
- **`gravity: 0`** in JumpSquat (grounded, gravity wouldn't apply anyway) and FastFall (no acceleration past the fast-fall speed).
- **`friction: 1.0`** in grounded "stopping" states (Idle, Squat, Land, DashStop). Full deceleration.
- **`friction: 0`** in JumpSquat (preserve pre-jump motion), and in non-`none` modes where friction is irrelevant anyway.

The `fallSpeedMax` is a per-state terminal velocity. Current values: Fall = 6, AirJump = 6, FastFall = 9, and all five aerials = 9 (so a fast-fall entered before or during an aerial keeps its speed instead of being bled back to 6 — rising and falling aerials read differently because of this one number). Higher = falls faster (different "weight" feel in different actions). Different airborne states having different caps is what lets FastFall be visibly faster than Fall without changing the character's gravity.

**Hitstun deliberately declares no cap.** A launch's vy must not be clamped mid-flight, so Hitstun leaves `fallSpeedMax` off entirely. The known consequence: when hitstun ends and the fighter drops into Fall, Fall's cap of 6 kicks in — so a hard spike reads correctly *during* hitstun and then visibly decelerates to terminal velocity the moment it ends. The fix is a Tumble state (uncapped post-hitstun fall), scheduled for Phase 14. Until then, "spikes feel weak at low percent" is this interaction, not a knockback-formula bug — check `pendingHitstunFrames` before touching `VELOCITY_SCALE`.

### Tuning patterns

When changing a single knob doesn't produce the intended feel, the change you want is probably in two places. Some pairs:

- **Heavier character.** Increase `gravity`, increase `jumpForce` to keep jump height roughly the same, increase Fall's `fallSpeedMax` to allow faster descents, possibly increase `fastFallSpeed` proportionally.
- **Floatier character.** Decrease `gravity`, decrease `jumpForce`, decrease the Fall/AirJump `fallSpeedMax`. Don't decrease `fastFallSpeed` too much or fast-fall stops feeling distinct.
- **More aerial control.** Increase `airAccel`. Optionally raise `airSpeedMax`, though this also changes the dash-off-edge emergence.
- **Faster ground game.** Increase `walkSpeed`, `dashSpeed`. Possibly shorten Dash's `duration` so the fighter reaches Run faster.
- **Snappier stops.** Increase `friction`. Possibly shorten DashStop's `duration` since the fighter will reach 0 vx earlier.

---

## 10. What physics does not do

The boundaries matter as much as the responsibilities.

**Physics does not change `actionState`.** That's the state system's job. Physics reads state data; it doesn't transition between states.

**Physics does not read or modify the input buffer.** It reads exactly one field — `buf[0].stickX` — and only because horizontal modes need it to drive walk and air motion. It doesn't push, doesn't query buffer history, doesn't classify input patterns. That's all in the input layer.

**Physics does not know about stages or surfaces.** No `world.stage` access. The fighter passes through walls and platforms as far as physics is concerned. Collision is what corrects positions after physics has placed them.

**Physics does not apply impulses.** Effects do. `applyJumpImpulse` (an effect, not a physics call) sets vy at the moment of transition; `applyHitReaction` sets both velocities at the moment a hit is consumed. Physics then integrates those velocities into motion. Impulses and continuous forces are separate concerns: impulses fire once at state-machine moments, continuous forces apply every frame in the physics system. This is why knockback needed zero physics changes — a launch is just a velocity, and gravity, drift, and the asymmetric cap compose with it into arcs and combo trajectories automatically.

**Physics does not allocate.** No object construction, no new arrays, no closures created per call. The horizontal modes table is a single static object created once at module load.

**Physics writes only physical fields.** vx, vy, x, y, and (in walk mode) facing. It doesn't touch grounded, actionState, stateFrame, airJumpsUsed, inputBuffer, or config.

---

## 11. Load-bearing decisions

**Gravity is only applied to airborne fighters.** The `!fighter.grounded` gate is in the system, not the primitive. Removing it would apply gravity to grounded fighters, accumulating downward velocity that would only be zeroed by collision next tick. Subtle but visible — grounded fighters would "want" to fall every frame.

**`fallSpeedMax` caps only positive vy.** Rising velocity (`vy < 0`) is never touched by the cap. This is what lets jump impulses larger than the cap actually produce jumps.

**The asymmetric air-drift cap.** The cap limits new outward acceleration, not maximum velocity. Velocity above the cap is preserved. This rule is what enables dash-off-edge momentum, and it generalizes to every future case where an external force puts vx over the cap.

**Friction snaps to zero rather than overshooting.** Prevents oscillation. Without this, vx near zero would chatter between small positive and negative values forever.

**Friction is a multiplier composition.** Character base × state multiplier, multiplied at the call site, never stored as a combined value. The pattern is the same as gravity. State multipliers of 0 are common and meaningful (JumpSquat preserves motion).

**Horizontal motion is single-mode per state.** A state declares exactly one `horizontalMode`. There's no blending, no overlay, no compound motion. If a future state needs motion that doesn't fit the existing modes, the answer is a new mode in the dispatch table, not a special case inside an existing one.

**Walk writes `facing`; air deliberately doesn't; dash reads it.** Walk tracks the live stick (continuous steering); air leaves facing to discrete commits (the Phase-12 deletion — see §5 — and the line must stay deleted); dash uses the committed value from the slam. Three modes, three relationships to facing, each load-bearing. "Fixing the inconsistency" in any direction breaks either back-airs or the slam-and-release dash.

**Integration is single-step Euler.** Sufficient at 60Hz fixed timestep with the engine's force scales. Higher-order integrators are not needed and would only add cost and complexity.

**All arithmetic routes through `fixedMath`.** Position, velocity, gravity, friction, integration — all use `fm.add`, `fm.mul`, etc. Counters and indices use plain JS. The discipline keeps the swap-to-integer-math path open for future deterministic-replay or rollback work.

---

## 12. When to revisit this doc

Update when:

- A new horizontal mode is added (the table in §5 grows).
- A new physics primitive is added to `core/physics.js` (e.g., a damping function, a directional impulse helper).
- The asymmetric cap rule is changed (don't, but if you do, §6 needs to be rewritten with the new behavior and emergences described).
- A character stat is added or removed (the tuning section in §9 needs the new knob's intuition).
- Gravity or friction composition changes (e.g., if states ever gain *additive* modifiers alongside multipliers, that's a new pattern).
- A new state has a friction or gravity multiplier outside the current ranges (worth noting the case and what it enables).

The doc is the contract for how motion works. If the code does something this doc doesn't describe, one of them is wrong.

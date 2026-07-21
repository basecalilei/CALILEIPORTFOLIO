# collision.md

Collision is what corrects positions that physics put past surfaces. It runs once per fighter per tick, after physics, with the final say on `x`, `y`, `vx`, `vy`, and `grounded`. Whatever it leaves on the fighter is what the renderer draws, what the next tick's input and state systems read — and, since Phase 13, what `hitDetectionSystem` tests hitbox overlap against in the same tick (it runs immediately after collision precisely so its geometry reads resolved positions, and it moves nobody; collision remains the last *mover*).

This document covers the sweep primitives in `core/collision.js`, the orchestration in `systems/collisionSystem.js`, the per-side response rules, the perpendicular-only snap rule (the most counterintuitive constraint in the engine), the strict and non-strict inequality checks that handle corners correctly, the drop-through predicate, and the walk-off detection.

Read this before any work that touches stage geometry, surface response, drop-through, or wall behavior. The corner-case catalog at the end is the part most worth memorizing — collision rules are dense with subtle constraints whose violation produces bugs three frames downstream in systems that don't seem related.

---

## 1. The shape

Two pieces, same pattern as physics:

- **The primitives** (`core/collision.js`) — pure geometric sweep tests. `sweepPointOntoPlatform` for one-way lines, `sweepPointIntoSolid` for axis-aligned rectangles with side tagging. Know nothing about fighters, states, or stages.
- **The system** (`systems/collisionSystem.js`) — the per-frame orchestrator. Reads the fighter's current position and velocity, derives the previous position, sweeps against the stage geometry, applies per-side responses, and performs the walk-off check.

The primitives operate on points, not bodies. The fighter is collided as a single point at its bottom-center anchor (`x`, `y` = feet position). The body's width and height aren't used in collision today; if they're needed later (for hit-detection or ceiling-height-aware collision), the primitives stay the same and the system reads the additional fields.

---

## 2. The sweep primitives

Both primitives take `(xPrev, yPrev, xNow, yNow, geometry)` and return either a hit descriptor or `null`. The "from outside" position checks use non-strict inequality; the "through-the-side" checks use strict inequality. See §6 for why.

### `sweepPointOntoPlatform`

```js
sweepPointOntoPlatform(xPrev, yPrev, xNow, yNow, platform) → { x, y } | null
```

A platform is `{ y, x1, x2 }` — a horizontal line segment.

Returns a hit if:
1. `yPrev <= platform.y` (the point was at or above the line at start of frame).
2. `yNow > platform.y` (the point is now strictly below the line).
3. The interpolated `hitX` at the moment of crossing falls within `[x1, x2]`.

The interpolation uses parametric `t`: `t = (platform.y - yPrev) / (yNow - yPrev)`, then `hitX = xPrev + t * (xNow - xPrev)`. This finds the x-coordinate at the exact moment y crossed the platform's y. Both conditions on yPrev/yNow are strict-vs-non-strict deliberately — non-strict on yPrev catches the defensive case where a grounded fighter has somehow accumulated vy without leaving the surface; strict on yNow ensures only downward crossings fire (rising or stationary motion can't trigger a platform hit).

Platforms are one-way by construction. Sideways motion through a platform doesn't trigger (the y constraint requires a crossing). Rising motion doesn't trigger. Falling motion that doesn't cross — e.g., the fighter is below the platform and moving sideways — also doesn't trigger.

### `sweepPointIntoSolid`

```js
sweepPointIntoSolid(xPrev, yPrev, xNow, yNow, solid) → { x, y, side } | null
```

A solid is `{ top, bottom, left, right }` — an axis-aligned rectangle. `top` is the smaller y; `bottom` is the larger y. Y-down convention.

The function tests four sides in order: **top, bottom, left, right.** Returns the first hit and stops checking. Each side test has the same shape: check that the motion segment crossed that side from outside, interpolate to find the contact point, verify the perpendicular coordinate is within the side's range.

For top: `yPrev <= top && yNow > top` (non-strict from above, strict crossing). For bottom: `yPrev >= bottom && yNow < bottom`. For left: `xPrev <= left && xNow > left`. For right: `xPrev >= right && xNow < right`.

The hit descriptor's `side` field tags which side matched; the collision system uses this tag to pick the right response.

### Side priority and the early return

The function returns on the first side hit. Priority is top > bottom > left > right. This means if a motion segment crosses both a top and a left side (a diagonal approach into a corner), top wins.

For Battlefield's geometry — one rectangular floor with corners well off the playable area — corner ambiguity doesn't arise in normal play. A fighter approaching the main floor diagonally always crosses the top before either the left or right wall in any reasonable trajectory.

For future stages with more complex geometry (a low ceiling against a wall, an underside-overhang formation, two solids that share a corner), the side-priority approach can produce wrong choices. The fix is time-of-impact (TOI) ordering: solve for `t` at each crossed side, pick the smallest `t`, and that's the side the segment actually crossed first. The current primitive doesn't do this — the side-priority fallback is correct for current geometry and the upgrade is a localized change when geometry demands it.

### Multiple solids

`collisionSystem` loops the stage's solids and breaks on the first hit. This means only one solid hit per frame, regardless of how many solids' bounding regions the motion segment intersects. Same caveat: not a problem for Battlefield (one solid), worth re-examining when stages have multiple solids that could share corner cases.

---

## 3. The system orchestration

```js
export function collisionSystem(world) {
  const stage = world.stage;
  for (const fighter of world.fighters) {
    const state = world.states[fighter.actionState];
    const ignoringPlatforms = wantsThroughPlatforms(fighter, state);

    const xPrev = fm.sub(fighter.x, fighter.vx);
    const yPrev = fm.sub(fighter.y, fighter.vy);

    let landed = false;
    let hitSolid = false;

    for (const solid of stage.solids) {
      const hit = sweepPointIntoSolid(xPrev, yPrev, fighter.x, fighter.y, solid);
      if (hit) {
        // ...apply per-side response...
        hitSolid = true;
        break;
      }
    }

    if (!hitSolid && !ignoringPlatforms) {
      for (const platform of stage.platforms) {
        const hit = sweepPointOntoPlatform(xPrev, yPrev, fighter.x, fighter.y, platform);
        if (hit) {
          // ...apply landing response...
          landed = true;
          break;
        }
      }
    }

    if (!landed && fighter.grounded) {
      if (!isStandingOnAnySurface(fighter, stage, !ignoringPlatforms)) {
        fighter.grounded = false;
      }
    }
  }
}
```

Three responsibilities, in order:

1. **Sweep solids.** Always tested. Drop-through never affects solids — they're hard geometry regardless of input or state.
2. **Sweep platforms.** Skipped if a solid was hit (a fighter who just landed on a solid doesn't need a platform check). Also skipped entirely if `wantsThroughPlatforms` is true.
3. **Walk-off detection.** If the fighter was grounded last frame, didn't land on anything this frame, and is no longer on a valid surface — clear `grounded`.

`xPrev` and `yPrev` are derived from current position minus current velocity: `xPrev = x - vx`. This works because physics is the only system that moves bodies between frames and collision runs immediately after — the difference is exactly the velocity that integrated into this frame's position. No separate `xPrev`/`yPrev` field is stored on the fighter; the derivation is the canonical pattern.

---

## 4. Per-side response rules

Each side of a solid hit gets a specific response. Platform hits use the same response as solid-top hits.

### Top: landing

```js
fighter.y = hit.y;
fighter.vy = 0;
fighter.grounded = true;
```

Snap y to the surface, zero vy, set grounded. The fighter has landed. Note that `vx` is *not* touched — the parallel-axis preservation rule (§5) applies. A fighter landing while moving horizontally keeps their horizontal velocity.

### Bottom: head bump

```js
fighter.y = hit.y;
fighter.vy = 0;
// grounded unchanged
```

Snap y to the surface (the underside of the solid), zero vy. The fighter is still airborne — they hit their head on the underside and now start falling. `grounded` stays false. `vx` is not touched.

### Left or right: wall hit

```js
fighter.x = hit.x;
fighter.vx = 0;
// grounded unchanged, vy unchanged
```

Snap x to the wall, zero vx. The fighter stopped horizontally but their vertical motion is preserved — they're sliding down a wall, climbing past a wall in the air, or whatever vy dictates. No state change here; the state machine continues to drive vx through whatever horizontal mode the current state has, and collision keeps zeroing it on each subsequent contact frame until the fighter changes direction or falls past the wall's bottom.

### Platform: same as solid-top

```js
fighter.y = hit.y;
fighter.vy = 0;
fighter.grounded = true;
```

Platform landings produce the exact same response as solid-top landings. The difference between platforms and solid tops is in *when* the sweep fires (one-way for platforms, four-sided for solids), not in *what* the response does.

---

## 5. The perpendicular-only snap rule

When a collision fires, only the perpendicular axis snaps to the hit point. The parallel axis keeps whatever motion this frame produced.

- Top hit: snap y, leave x alone.
- Bottom hit: snap y, leave x alone.
- Left hit: snap x, leave y alone.
- Right hit: snap x, leave y alone.

This is the most counterintuitive rule in the engine. It looks like a bug — "the fighter penetrated the surface diagonally; shouldn't we snap both axes back to the contact point?" — and snapping both does produce visually correct first-frame behavior. The reason not to is what happens on the second frame of contact.

### The wall-slide bug

Imagine a fighter pressed against a wall, falling. Frame 1 of wall contact:

- Physics applies gravity, vy goes from 0 to some positive value. vx is unchanged (pushed into the wall, but collision will zero it).
- Physics integrates: x moves a tiny bit into the wall, y moves down by vy.
- Collision sweeps left/right, finds a wall hit. Side: right (say). Snap x to wall, zero vx. y is already updated.
- The fighter is at the wall with vy reflecting one frame of gravity. They've slid down by one vy worth.

Frame 2 of wall contact, **if the rule were "snap both axes":**

- Physics integrates: starts from current x (at the wall) and y (one frame down). Adds vy to y.
- Collision sweeps. The motion segment is from `(x, y - vy)` to `(x, y)`. xPrev equals xNow (we're already at the wall). The sweep fires at t = 0 with hitY = yPrev. The snap-both rule would then set y to hitY — which is yPrev, the start-of-frame y.
- The fighter ends frame 2 at the same y as frame 1.
- Every subsequent frame: same outcome. The fighter is stuck at the wall, perpetually yanked back to start-of-frame y by the sweep.

With **the perpendicular-only rule:**

- Same setup. Collision sweep fires at t = 0. Snap only x (which is already at the wall, no change). Leave y at its new value.
- The fighter has slid down by one vy.
- Frame 3: same pattern. They slide further.

The fighter slides smoothly down the wall, accumulating gravity each frame. Perpendicular-only snap is what makes wall-slides work.

### Why the rule generalizes

The same logic applies to top and bottom hits. A fighter landing diagonally — moving down and to the right onto a platform — should end up at the x they were heading toward, not at the exact contact point. The diagonal landing visually "scoots forward" by the parallel component of the frame's motion, which is the right behavior; jerking back to the precise contact point would look unnatural.

The general principle: **collision corrects the axis that was violated. The other axis is the fighter's intent, and intent is preserved.** Anything that wants to also stop motion on the parallel axis is the responsibility of a state-level rule (e.g., a state that sets vx to 0 when entered), not the responsibility of collision.

---

## 6. Strict vs non-strict inequalities

The sweep primitives use a mix of strict and non-strict inequalities, and the mix is deliberate.

### Top and bottom: non-strict from outside, non-strict x-range

```js
// TOP
if (yPrev <= solid.top && yNow > solid.top) {
  // ...interpolate hitX...
  if (hitX >= solid.left && hitX <= solid.right) {
    return { x: hitX, y: solid.top, side: 'top' };
  }
}
```

- `yPrev <= top`: non-strict. A fighter at exactly `y = top` is "from outside" the top surface. This is the snap-then-stay case — after a landing snap, the fighter is at exactly the top and the next frame's yPrev equals top. Non-strict catches that case as a valid starting position.
- `yNow > top`: strict. Only count it as a crossing if the fighter is below the surface this frame.
- `hitX >= left && hitX <= right`: non-strict on both sides. Corner landings count — a fighter landing at exactly `x = right` of a solid is still landed on the solid.

### Left and right: non-strict from outside, STRICT y-range

```js
// LEFT
if (xPrev <= solid.left && xNow > solid.left) {
  // ...interpolate hitY...
  if (hitY > solid.top && hitY < solid.bottom) {
    return { x: solid.left, y: hitY, side: 'left' };
  }
}
```

- `xPrev <= left`: non-strict (same reason as top — snap-then-stay).
- `xNow > left`: strict.
- `hitY > top && hitY < bottom`: **strict** on both sides. This is the rule that prevents a phantom wall hit when a fighter walks along the top of a solid at its corner.

### Why strict y-range on walls matters

Consider a fighter standing on a solid's top, walking right toward the solid's right edge. Their y equals `solid.top` and they're approaching `solid.right` horizontally. As they cross the edge:

- xPrev is somewhere left of the edge, xNow is at or past it. Both conditions on x check out.
- The wall test would interpolate hitY. Because the fighter is on the top, hitY = top.
- **If the y-range check were non-strict** (`hitY >= top && hitY <= bottom`), the test would match and fire a wall hit. The fighter walking off the edge would suddenly hit a phantom wall at y = top. They'd be snapped to x = right and zeroed in vx, stuck at the corner.
- **With the strict y-range** (`hitY > top && hitY < bottom`), hitY = top fails the strict check. No wall hit fires. The fighter continues past the edge horizontally, and the next tick's walk-off detection (§7) clears their grounded flag. They fall off the edge cleanly.

The strict y-range is the asymmetric counterpart to the non-strict x-range on top hits. A fighter at exactly `x = right` is on the top (corner landing counts); a fighter at exactly `y = top` is *not* on the side (walking off the edge doesn't trigger a wall).

The same asymmetry holds on the other corners by symmetry.

---

## 7. The drop-through predicate

```js
function wantsThroughPlatforms(fighter, state) {
  if (state.physics.respectPlatforms === true) return false;
  const now = fighter.inputBuffer[0];
  if (!now || now.stickY <= 0) return false;
  return true;
}
```

A fighter "wants through platforms" when their stick is held down (Y-down: `stickY > 0`) AND the current state doesn't opt out. The opt-out is `state.physics.respectPlatforms === true`, and it now has twelve users: AirDodge (structural — a down-angled dodge must land on the platform for wavelanding to exist, not clip through it), Land (a feel choice — it widens the stay-on-platform window after a waveland from frame-perfect to reactive), and all ten attack states (a mid-swing fighter holding down shouldn't drop through the platform under them). Hitstun deliberately leaves it unset — a launched fighter keeps normal drop-through rules.

### Why this is on state data, not on the fighter

The `respectPlatforms` field lives on state data because the rule is action-shaped: "this action should not be droppable through." It's not a property of the fighter as a whole. See `dataModel.md` §6 for the worked example, §7 for the paired-effect-leak failure mode that would result from putting it on the fighter, and §9 for the general state-level-opt-out pattern that `respectPlatforms` is the first instance of.

### The two application sites

`wantsThroughPlatforms` is consulted at two places in the collision system, and both consultations matter.

**Site 1: the platform sweep is skipped entirely.**

```js
if (!hitSolid && !ignoringPlatforms) {
  for (const platform of stage.platforms) {
    // sweepPointOntoPlatform
  }
}
```

A fighter falling from above onto a platform with down held — the sweep doesn't fire. They pass through.

**Site 2: the walk-off check ignores platforms.**

```js
if (!isStandingOnAnySurface(fighter, stage, !ignoringPlatforms)) {
  fighter.grounded = false;
}
```

A fighter standing on a platform with down held — `isStandingOnAnySurface` is called with `includePlatforms = false`. The fighter is on a platform, but with platforms excluded from the "valid surface" set, they're not on anything. `grounded` is cleared.

The same predicate governs both paths. A player holding down on a platform: collision doesn't catch them (site 1 is irrelevant since they're standing, not falling); the walk-off check sees them as "not on any surface" (site 2 fires); grounded becomes false; next tick's `notGrounded` condition fires the state transition to Fall. Drop-through-from-standing emerges from the two-site application of one predicate.

### Why collision reads the input buffer

Collision is otherwise pure geometry. `wantsThroughPlatforms` is the one exception — it reads `fighter.inputBuffer[0].stickY`. The reason is that drop-through is fundamentally input-driven physical behavior: the player's current down-press changes how platforms behave for this fighter on this frame. Pushing that logic into the state system would require a state that knows "I'm in Fall *and* the player wants drop-through right now," and the state count would multiply for every action that should respect or ignore platforms.

The cleaner factoring is: states declare a static opt-out (`respectPlatforms: true` for attack states); collision reads the live input to decide whether the platform conditional fires. One predicate, two sites, no state explosion. This is also a clean example of the substrate-vs-feature pattern from the architecture docs — drop-through is the desired behavior, but what got built is a predicate that controls platform-sweep eligibility. The predicate composes; the behavior emerges.

---

## 8. Walk-off detection

```js
if (!landed && fighter.grounded) {
  if (!isStandingOnAnySurface(fighter, stage, !ignoringPlatforms)) {
    fighter.grounded = false;
  }
}
```

The check fires only if the fighter didn't land this frame and was grounded coming into this frame. The question it answers: "is the fighter still on a valid surface, given where they are now?"

```js
function isStandingOnAnySurface(fighter, stage, includePlatforms) {
  for (const solid of stage.solids) {
    if (fighter.y === solid.top
        && fighter.x >= solid.left
        && fighter.x <= solid.right) {
      return true;
    }
  }
  if (includePlatforms) {
    for (const platform of stage.platforms) {
      if (fighter.y === platform.y
          && fighter.x >= platform.x1
          && fighter.x <= platform.x2) {
      return true;
      }
    }
  }
  return false;
}
```

A surface counts if the fighter's `y` exactly equals the surface's `y` AND the fighter's `x` is within the surface's horizontal range.

### Why exact equality works

The `===` on y looks fragile but is correct given the invariants:

- A grounded fighter has `vy = 0`. Collision sets it that way on landing.
- Physics doesn't integrate y when vy = 0. `y += vy` with vy = 0 is a no-op.
- So `y` remains exactly equal to the surface's y after the initial landing snap.

This holds until something sets vy to a nonzero value while grounded — which currently nothing does. If a future system mutates vy on a grounded fighter (e.g., a knockback effect, a moving platform, a hitstun launcher), the equality breaks loudly and the fighter starts behaving wrong on walk-offs. The comment in the code calls this out: if it ever breaks, the cause is "a system set vy nonzero while grounded."

### The `includePlatforms` parameter

When the fighter is requesting drop-through, the walk-off check is called with `includePlatforms = false`. A fighter standing on a platform with down held has no valid surface (their solid check returns false because they're not on a solid; the platform check is skipped because `includePlatforms` is false). `grounded` becomes false; the state transitions to Fall next tick.

When the fighter is *not* requesting drop-through, `includePlatforms` is true and the platform check runs normally. A fighter standing on a platform with no down input stays grounded.

### What walk-off doesn't do

The check only clears `grounded`. It doesn't change `actionState`, doesn't reset `airJumpsUsed`, doesn't touch velocity. The state machine takes care of the rest: next tick's `notGrounded` condition fires (from Walk, Idle, Squat, Dash, etc., all of which list `notGrounded → Fall` as their first transition); the fighter enters Fall with whatever horizontal velocity they had; physics applies gravity in the new frame.

This separation is intentional. Collision's job is "what's the truthful state of the fighter relative to surfaces" (grounded vs. not). What to do about it is the state machine's job. Conflating the two would couple collision to action semantics.

---

## 9. xPrev and yPrev: the previous-position derivation

```js
const xPrev = fm.sub(fighter.x, fighter.vx);
const yPrev = fm.sub(fighter.y, fighter.vy);
```

The sweep primitives need to know where the fighter was at the start of the frame, not just where they are now. The previous position is derived as `current - velocity`, not stored on the fighter.

This is safe because:

- Physics is the only system that moves bodies between frames. It applies `x += vx; y += vy` in `integrate`.
- Collision runs immediately after physics, in the same tick.
- The velocity that integrated into this frame's position is still on the fighter — physics didn't zero it, and nothing between physics and collision touched it.

So `current - velocity` is exactly the position before physics integrated, which is the position at the start of the frame.

### Why not store xPrev/yPrev directly

A separate `xPrev`/`yPrev` field on the fighter would mean:

- Every system that mutates x or y has to also update xPrev/yPrev correctly, or the derivation breaks.
- Effects that snap velocity (`applyJumpImpulse`) would either need to update xPrev/yPrev or accept that they're "stale" — adding a class of subtle bugs around what "previous" means across transitions.
- The fighter shape grows for a value that can be derived in two arithmetic operations.

The derivation pattern is the canonical one for this situation. It's also why physics runs before collision — the derivation works because physics is the previous mutator. Reordering would break it.

---

## 10. What collision does and doesn't do

**Reads.** `fighter.x`, `fighter.y`, `fighter.vx`, `fighter.vy`, `fighter.grounded`, `fighter.actionState` (via `world.states[...]` to get `respectPlatforms`), `fighter.inputBuffer[0].stickY`, `world.stage.solids`, `world.stage.platforms`.

**Writes.** `fighter.x`, `fighter.y`, `fighter.vx`, `fighter.vy`, `fighter.grounded`.

**Does not.** Change `actionState`. Reset `airJumpsUsed`. Push to or query the input buffer (beyond the single stickY read for drop-through). Read `world.frame` or any timing value. Allocate. Loop more than once per fighter per sweep type. Modify the stage or state data.

The drop-through stickY read is the one place collision reads input. It's a principled exception: drop-through is a per-frame physical behavior driven by live input, not by transition events. Treating it as a collision concern (rather than a state-machine concern) avoids a state explosion. See §7.

---

## 11. Load-bearing decisions

**Only the perpendicular axis snaps on collision.** Snapping both axes reads correctly for the first frame of contact but produces the wall-stuck bug on subsequent frames. The rule generalizes to all four sides of solids and to platform tops. See §5.

**Top and bottom have non-strict x-range; left and right have strict y-range.** A fighter at exactly `x = right` is still on the top (corner landing). A fighter at exactly `y = top` is not on the side (walking off the edge doesn't trigger a wall). The asymmetry is what prevents phantom wall hits at the corners of solids. See §6.

**"From outside" checks use non-strict inequality.** Snap-then-stay works only because `xPrev = wall` is treated as "from outside" on the next frame's sweep. Strict would produce penetration after a snap.

**Side priority for diagonal corner hits is top > bottom > left > right.** Correct for Battlefield's geometry. Stages with overlapping bounding regions need time-of-impact ordering instead — solve for `t` at each crossed side, smallest wins.

**Multiple solids: first-hit-wins in loop order.** Same caveat as side priority. One solid per stage today means no ambiguity; more solids means stage authors need to be aware of how their geometry composes.

**Drop-through is a single predicate at two sites.** `wantsThroughPlatforms` controls both the platform sweep skip and the walk-off check's `includePlatforms`. The two-site application produces both fall-through-from-above and drop-through-from-standing without separate code paths.

**`respectPlatforms` is on state data.** Action-shaped, not character-shaped — confirmed twelve times over by its current users (AirDodge, Land, the ten attacks). Moving it to the fighter would require paired effects on every action that opts in; the state-data placement avoids that entirely. See `dataModel.md` §9 for the general state-level opt-out pattern, of which this flag is the founding instance.

**`fighter.y === surface.y` is the walk-off equality check.** Works because grounded fighters have vy = 0 and physics doesn't integrate y when vy = 0. The first vy-mutator-on-grounded arrived in Phase 13 — `applyHitReaction` launching a grounded victim — and the assumption held for the right reason: an upward launch integrates y off the surface *before* the equality check runs, so the check correctly reports "not standing" and clears grounded. A downward hit resolves through the solid sweep instead (top-hit snap, vy zeroed, grounded kept). The warning still stands for any future system that mutates vy on a grounded fighter while intending them to *stay* grounded — that's the case that must restore vy = 0 before tick-end.

**xPrev and yPrev are derived, not stored.** `current - velocity` is the canonical pattern. Storing them as fighter fields would require every position-mutator to maintain them and would expose subtle bugs around what "previous" means.

**Collision is the last writer in tick order.** It has the final say on x, y, vx, vy, grounded. Physics writes them first (tentative); collision corrects (authoritative). The renderer reads collision's output.

**One geometric exception to "collision is pure geometry": the stickY read.** Worth knowing that collision is not strictly stateless — it does consult the current input snapshot for drop-through. Any future drop-through-like behavior should follow the same pattern (a predicate at the consultation point, not new state machinery).

---

## 12. When to revisit this doc

Update when:

- The stage data shape changes (a new geometry type beyond solids and platforms — for instance, slopes, curves, moving platforms).
- A new sweep primitive is added (e.g., point-vs-segment for non-axis-aligned walls). Note that hitbox-vs-hurtbox AABB testing deliberately did *not* land here — `hitDetectionSystem` keeps its overlap and transform helpers inline (three-consumer duplication with the debug draws; extraction threshold not reached, and future contact systems shouldn't be forced into fighter-vs-stage's shape). If a genuinely shared geometry need emerges, that's the moment this doc and `core/collision.js` grow together.
- The side-priority approach is replaced with TOI ordering — §2 and §11 both need updating.
- A new responsibility is added to `collisionSystem` (e.g., environmental damage from spikes, ladder attachment, fluid drag in water zones).
- `wantsThroughPlatforms`'s logic changes — e.g., adding a "ghost form" power-up that ignores platforms regardless of input, or making the down-input threshold something other than `stickY > 0`.
- The perpendicular-only snap rule is ever revisited (don't, but if you do, the wall-slide story in §5 needs to be rewritten with the new behavior and what it costs).
- The `===` equality assumption in `isStandingOnAnySurface` is invalidated by a new system that mutates vy while grounded.

The doc is the contract for how surfaces interact with bodies. If the code does something this doc doesn't describe, one of them is wrong.

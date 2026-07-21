## Phase 8: Walls, Fast Fall, and the Stage Restructure

Phase 8 is the heaviest collision-and-physics phase in the project. Two things happen at once: the **stage geometry is restructured** from a single list of platforms into two distinct collections (solids and platforms), and **fast fall** is added as a new state with its own physics modifier. Along the way, four subtle bugs get tracked down — each one a frame-by-frame timing mismatch that only shows up when you trace what's happening across multiple frames in a row.

Let me walk through each piece. There's a lot here, and the pieces interact, so I'll take it one concept at a time.

### Why the stage needed restructuring

Up to Phase 7, the stage was a single list of platforms, each one a horizontal line with a `dropThrough` flag. Battlefield's main floor was a platform like any other, just with `dropThrough = false`. This worked for the simple "fall onto floor, stand on floor" cases, but it had two problems that became urgent in Phase 8.

**Problem 1: walls don't exist.** A platform is a horizontal line. You can land on it from above, but there's no concept of bumping into it from the side. If the fighter dashes off the edge of the main floor at high speed, then drifts back leftward in the air, they don't hit anything — they pass through where the floor "should" be (geometrically beside the floor's right edge). The main floor isn't a solid object in the world; it's just a one-pixel-thick line that catches downward motion.

For a platform fighter, this is wrong. The main stage needs walls. A fighter who falls off the right edge and drifts back left should bonk into the side of the stage and slide down the wall, not pass through it.

**Problem 2: the rectangle is the natural shape.** Once you accept that the main floor needs walls on its sides, you've implicitly accepted that the main floor is a **rectangle** — it has a top (the landable surface), a left side, a right side, and a bottom. Trying to represent that as four separate horizontal/vertical line segments would be awkward; the geometry is cleaner if it's just a rectangle with four properties.

Soft platforms (the three suspended ones) genuinely *are* horizontal lines. You can land on them from above, but you can pass through them from below or from the sides. They don't have walls. Their geometry is one-dimensional.

So: the main floor and the soft platforms are *different kinds* of geometry. The data structure should reflect that.

### The new stage shape

The Phase 8 restructure splits the stage's geometry into two collections:

> *A stage has:*
> *- A list of solids. Each solid is a rectangle: { top, bottom, left, right }.*
> *- A list of platforms. Each platform is a horizontal line: { y, x1, x2 }.*
> *- Blast zones: bounds beyond which fighters would die (not yet used).*

The drop-through flag is gone. It's no longer needed — the *collection a piece of geometry lives in* tells you what kind it is. If it's in `solids`, it has walls and a real top. If it's in `platforms`, it's a one-way line.

For Battlefield specifically:

- One solid: top=400, bottom=640, left=180, right=780 (the main floor, drawn as a filled rectangle reaching down to the blast zone).
- Three platforms: the left and right at y=280, the top at y=180.

The main floor is now a real rectangle. You can land on its top, bump your head on its bottom, and slide down its sides.

A few small but real implications of this change ripple outward.

**The renderer learns to draw two shapes.** Solids draw as filled rectangles with a thin outline. Platforms still draw as thin lines. The visual distinction is immediate — the main floor now looks like a solid block extending down to the blast zone, not a single line. Players can see at a glance what's solid and what's pass-through.

**The collision code splits into two primitives.** One for the line-versus-motion-path sweep (used by platforms, unchanged from Phase 3 except renamed). One new for the rectangle-versus-motion-path sweep (used by solids). The collision system runs both, in a specific order, with specific responses per side.

**The walk-off detection becomes more general.** "Are you still on a surface?" needs to check both solids' tops and platforms' lines. The check expands but stays simple — just walk through both collections and ask if your y matches any surface's y and your x is within its x range.

### The solid sweep, conceptually

This is the new geometric primitive. A motion path goes from (xPrev, yPrev) to (xNow, yNow). A solid is a rectangle with top, bottom, left, right. The question: did the motion path cross any of the four sides of the rectangle, and if so, which one, and where?

The naive approach is "compute the time-of-impact for all four sides and pick the smallest." That's geometrically correct but adds complexity. Phase 8 chose a simpler model: **test each side in priority order**, and the first one that fires wins. The user explicitly agreed to defer diagonal-corner cases to a later phase.

The priority order: **top, bottom, left, right.** Top first because landing-on-top is the most common case and should always be preferred when it applies. Bottom next (the rare head-bump). Then the two sides.

Each side is its own swept-line test, structurally similar to Phase 3's platform sweep but applied to a different edge of the rectangle.

> *To test if a motion path entered a solid from above (top side):*
> *Did the path cross the y=top line, moving downward, with the crossing x inside [left, right]?*
> *If yes, return { x: hitX, y: top, side: 'top' }.*

> *To test if a motion path entered from below (bottom side):*
> *Did the path cross the y=bottom line, moving upward, with the crossing x inside [left, right]?*
> *If yes, return { x: hitX, y: bottom, side: 'bottom' }.*

> *To test if a motion path entered from the left:*
> *Did the path cross the x=left line, moving rightward, with the crossing y strictly inside (top, bottom)?*
> *If yes, return { x: left, y: hitY, side: 'left' }.*

> *To test if a motion path entered from the right:*
> *Did the path cross the x=right line, moving leftward, with the crossing y strictly inside (top, bottom)?*
> *If yes, return { x: right, y: hitY, side: 'right' }.*

The wall tests use **strict** inequality on the perpendicular axis (y must be strictly between top and bottom, not equal to either). The top and bottom tests use **inclusive** range (x must be between left and right, inclusive of the corners). This asymmetry is deliberate: a fighter walking along the top edge of a solid at exactly y=top should NOT trigger a phantom wall hit when their x crosses left or right. The strict-y check on the wall tests prevents that — at y=top exactly, the wall test bails because hitY is not strictly greater than top.

### Inclusive-versus-strict on the entry side

There's a subtle but load-bearing decision: the "are you starting outside the solid" check uses **non-strict** inequality. Let me unpack this.

For the top sweep, we want to fire when the fighter started at or above the top and ended past it. The check is:

> *yPrev ≤ top AND yNow > top.*

The non-strict on yPrev is what handles the snap-then-sit case. After a top-side hit, the fighter snaps to y=top. Next frame, if they're somehow no longer grounded (collision shouldn't get them un-grounded, but defensive coding matters here), they'd start the frame with yPrev = top exactly. With strict (`yPrev < top`), the sweep wouldn't fire on the next motion — but with non-strict (`yPrev ≤ top`), it would. Non-strict catches the snap-on-edge case.

This generalizes to all four sides: the "from outside" check uses non-strict on the boundary, and the "now penetrating" check uses strict. The pair (non-strict outside, strict inside) means the boundary itself counts as "outside" — you're not yet inside until you've moved past it.

This is the kind of decision that's invisible at first glance but matters when you trace edge cases. Without non-strict outside checks, the engine would have subtle bugs where snapped-on-edge fighters could occasionally penetrate the solid on subsequent frames.

### The collision response: snap only the perpendicular axis

This is the most important fix of Phase 8 and the one I'd recommend pinning in your head.

The naive response when a sweep fires is "snap the fighter to the hit point — set both x and y to the contact coordinates." That's intuitive: the fighter "lands" at the precise point of contact.

For top hits, this works fine — the fighter is at (hitX, top), vy = 0, grounded = true. They've landed on the platform, sitting at the contact point.

For **wall hits**, this breaks badly, in a way that's only visible across multiple frames.

Here's the bug. A fighter is falling, pressed against the right wall of a solid. They're at x = right (just snapped from the previous frame's hit). On this frame, gravity adds to vy, integrate moves them downward. But they're also slightly drifting left (the player's holding left to try to escape the wall). After integration, x might be 779.9 (slightly left), y is some new value (say, 510, having fallen from 504 the previous frame).

The collision sweep fires. Right-wall test: xPrev = 780, xNow = 779.9. The crossing is detected. What's hitY? The path goes from (780, 504) to (779.9, 510). It crosses x=780 at t=0 (xPrev is already on the wall). At t=0, y = yPrev = 504.

So hit.y = 504. If we snap both axes — fighter.y = 504 — the fighter is **yanked back to the y they had at the start of the frame**. All of this frame's gravity-driven downward motion is undone.

Next frame, same thing. The fighter never moves down. They're stuck at y=504, "stuck" against the wall, with vy growing each frame but never integrated into position.

The fix: **only snap the perpendicular axis.** For top/bottom hits, snap y but leave x alone. For left/right hits, snap x but leave y alone.

> *On a top hit: fighter.y = top; fighter.vy = 0; grounded = true.*
> *On a bottom hit: fighter.y = bottom; fighter.vy = 0; grounded unchanged.*
> *On a left hit: fighter.x = left; fighter.vx = 0; grounded unchanged.*
> *On a right hit: fighter.x = right; fighter.vx = 0; grounded unchanged.*

After the fix, a fighter sliding down a wall has their x pinned to the wall but their y free to accumulate gravity-driven motion. They slide down, frame by frame, at the natural falling speed. When their y exceeds the wall's bottom (640 for the main floor), the wall sweep stops firing (the wall's y-range check fails), and they can move horizontally again.

The same principle applies to top/bottom — preserving the parallel axis means a fighter who lands on a platform diagonally retains their horizontal momentum into the landing. This is the right behavior physically: the surface only stops motion in the direction perpendicular to it.

This fix was the user discovering "I drift into the wall and stick there." The bug was real and load-bearing. The fix is one line: change "snap both axes" to "snap only the perpendicular axis" and let the parallel axis carry whatever this frame's physics produced.

### The collision system, reorganized

The Phase 8 collisionSystem.js does three things in sequence:

> *Every frame, for each fighter:*
> *Compute xPrev, yPrev (current minus velocity, as always).*
>
> *Test solids first:*
> *For each solid, run the solid sweep.*
> *On the first hit, apply the side-specific response.*
> *Stop checking solids.*
>
> *If no solid hit, test platforms:*
> *For each platform, run the platform sweep.*
> *On the first hit, snap to y, vy = 0, grounded = true.*
>
> *If still no hit, run the walk-off check:*
> *Was the fighter grounded last frame? If so, is fighter.y still equal to any surface's y, with fighter.x in range?*
> *If no, clear grounded.*

Solids come first because they're "harder" geometry — a solid takes priority over a platform when both could fire on the same frame (in Battlefield they can't overlap, but the principle generalizes). The walk-off check now scans both solids' tops and platforms' lines.

### Fast fall, conceptually

Separate from the stage restructure, Phase 8 introduces a new state: **FastFall**. This is the "press down at apex of jump to commit to descending faster" mechanic.

The state itself:

> *FastFall:*
> *Duration: 0.*
> *Physics: gravity 0, friction 0, horizontalMode 'air', fallSpeedMax 9.0.*
> *Transitions:*
> *grounded → Land (with effect: resetAirJumps)*
> *canAirJump → AirJump (with effect: applyAirJumpImpulse)*
> *Render: color #cc4444 (darker red than normal Fall).*

The key physics-modifier difference: **gravity is 0**. FastFall doesn't accelerate — vy is set to a constant fast-fall speed by the entry effect, and then nothing changes it. The fighter falls at exactly 9.0 px/frame forever (until landing or air-jump-canceling out).

The state has only two exit transitions. Crucially, **there's no fastFallTriggered transition** in FastFall's list — once you've committed, holding down doesn't keep re-firing the trigger. The only ways out are landing or air-jumping.

The fast-fall trigger is added as a new condition and effect:

> *fastFallTriggered (Phase 8 version):*
> *Returns true if stickY > 0 AND vy >= 0.*
>
> *applyFastFall:*
> *Sets fighter.vy = fighter.config.physics.fastFallSpeed (9.0 in fighter A's stats).*

The condition's `vy >= 0` clause is what makes fast-fall a commit at apex. On the way up, vy is negative; the condition fails. The moment vy reaches zero (apex) and beyond (descent), the condition becomes true if the player is also holding down. So pressing down at apex triggers fast-fall instantly; pressing down on the way up does nothing until apex.

The transitions in Fall and AirJump are updated to add the trigger:

> *Fall's transitions, updated for Phase 8:*
> *grounded → Land (with resetAirJumps)*
> *canAirJump → AirJump (with applyAirJumpImpulse)*
> *fastFallTriggered → FastFall (with applyFastFall) [new]*

> *AirJump's transitions, updated for Phase 8 (similarly):*
> *grounded → Land (with resetAirJumps)*
> *canAirJump → AirJump (with applyAirJumpImpulse) [new in Phase 8 — re-jump from air-jump if maxAirJumps allows]*
> *fastFallTriggered → FastFall (with applyFastFall) [new]*

The priority order matters: `canAirJump` is above `fastFallTriggered`. If the player has both inputs active (held down and pressed jump), the air jump wins. This reflects player intent: a fresh jump press is a discrete deliberate action; down can be held for many reasons (crouching, drop-through later in Phase 9, fast-falling now). Treating jump-press as the more specific intent makes sense.

### Terminal velocity

The `fallSpeedMax` field appears for the first time in Phase 8. It's a physics-modifier on each airborne state:

> *Fall: fallSpeedMax = 6.0.*
> *AirJump: fallSpeedMax = 6.0.*
> *FastFall: fallSpeedMax = 9.0.*

The physics primitive `applyGravity` is updated to take a max:

> *To apply gravity to a body, given a gravity value and a maxFallSpeed:*
> *Add gravity to vy.*
> *If maxFallSpeed is defined AND vy > maxFallSpeed, clamp vy to maxFallSpeed.*

This is what gives the engine **terminal velocity**. Without it, a fighter in a long fall would accumulate vy indefinitely (gravity adds 0.4 per frame, forever). With the cap, vy grows from 0 toward 6.0 over 15 frames and then plateaus. The fighter falls at a steady maximum speed.

FastFall's cap is 9.0, higher than the fast-fall speed itself. The cap doesn't matter under normal conditions (FastFall has gravity 0, so vy doesn't grow). But if some external force ever pushed vy above 9.0 in FastFall (e.g., a future knockback), the cap would catch it. Defensive design.

### What happens with stickY held during a jump (the apex case)

Let me trace a full jump-and-fast-fall sequence to show the rules working together.

> *Frame 0: Idle on the floor. Player presses Space. Idle → JumpSquat.*
> *Frames 1–2: JumpSquat. vy unchanged.*
> *Frame 3: JumpSquat → Fall. applyJumpImpulse: vy = -8.*
> *Frame 4: Fall. Player has been holding Space, just released. Starts pressing Down. stickY = +1.*
> *fastFallTriggered checks: stickY > 0 yes, vy >= 0? vy is -7.6 (after 1 frame of gravity). vy < 0, fails. Doesn't fire.*

The fighter continues ascending. Each frame, vy gains 0.4. The player keeps pressing down.

> *Frames 5–22: Fall continues. vy approaches 0. fastFallTriggered keeps failing because vy < 0.*
>
> *Frame 23: vy = -0.4. Fails.*
> *Frame 24: vy = 0.0. stickY > 0, vy >= 0. **Fires.** Fall → FastFall. applyFastFall: vy = 9.0.*
>
> *Frame 25: FastFall. Gravity 0, vy stays at 9.0. Integrate: y += 9.0.*
> *Frame 26: FastFall. Same. y += 9.0.*
> *Frame 27 ...: continues until landing.*

The fast-fall fires exactly at apex, even though the player started holding down 19 frames earlier. The vy>=0 gate held it back until the moment the fighter physically reached the top of the arc.

This is the "press down at apex" feel that real platform fighters have. You don't need to time the press — you can press whenever you want, even before the apex, and the engine waits until the right moment to commit. The fighter visually pauses at apex for one frame (vy=0) and then snaps into the rapid descent.

There's a small nuance: this 8th-version of `fastFallTriggered` fires *every* frame after apex (as long as stickY is still held). That doesn't cause repeated firing of the transition because FastFall doesn't list fastFallTriggered in its own transitions — once you're in FastFall, the condition has no consumer. (Phase 9 will rewrite this condition to handle a different edge case around drop-through.)

### What's load-bearing about Phase 8

A lot, because this phase reshaped collision.

**The two-collection stage model.** Solids and platforms as separate kinds, queried separately. Every future stage will use this shape. The drop-through flag is dead; geometry-kind tells you collision-behavior.

**The four-side solid sweep with priority ordering.** Top, bottom, left, right, first-hit-wins. Phase 8 deliberately deferred TOI-correct diagonal handling; the side-priority order is the workable simplification.

**The snap-only-perpendicular response rule.** The single most important collision fix in the project. Wall slides, diagonal landings, and several future cases all depend on this. If you ever see "the fighter is stuck somewhere weird," check whether the parallel axis is being preserved.

**Terminal velocity as a state-level cap.** `fallSpeedMax` lives on the state's physics modifier, not on the character. Different states can have different terminal velocities. FastFall's cap is double the normal cap; future hitstun states could have their own.

**Fast-fall as commit-at-apex.** The vy>=0 gate is what gives the engine its "tap down to fast-fall" feel, even when the player presses down at any earlier moment. This pattern — "the condition gates on physical state, not on input timing" — is reusable. A condition can wait for the physics to be ready before firing.

**Non-strict outside checks on solid sweep entry.** The pair of "non-strict on outside, strict on inside" makes snap-on-edge cases work correctly. Without it, the engine has subtle penetration bugs.

**Strict y-range on left/right wall tests.** Prevents phantom wall hits when a fighter walks along the top edge of a solid. Without it, the corners would fire spurious side collisions.

### What was deferred

The user explicitly chose to defer two things in Phase 8:

**Diagonal-corner cases.** A fighter approaching a corner where they cross both the top and a side in the same frame gets handled by the priority order (top first, then sides). This is geometrically imprecise but works for Battlefield's geometry. A future stage with multiple solids close together might need TOI-correct ordering.

**Bottom-bump.** The geometry supports it (the bottom sweep is there), but Battlefield's main floor reaches the blast zone, so no fighter can be below it. The code is dead in this stage. A future stage with an overhead solid would exercise the bottom-bump and prove (or break) the implementation.

The deferral is conscious: we know the gaps exist, we know what they'd cost, and we know we don't need them yet.

---

That's Phase 8. The stage now has real walls. Fast-fall is a committed descent. Terminal velocity is a per-state cap. The collision response is asymmetric in a way that preserves natural motion. Several subtle frame-by-frame bugs got tracked down and fixed.
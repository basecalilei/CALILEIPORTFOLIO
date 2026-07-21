## Phase 3: Physics

Phase 3 is where the engine starts doing real work. Three concepts arrive at once: **a fighter exists**, **physics applies forces and integrates motion**, and **collision keeps the fighter from passing through the floor**. Each one is independently small but they have to interlock correctly.

I'll walk them in dependency order: fighter first (what's moving), then physics (how it moves), then collision (what stops it).

## The fighter, conceptually

A fighter is a flat object. No nested state, no internal classes hiding behavior. It has whatever fields the systems need, all visible at the top level.

> *A fighter is an object with:*
> *- Position fields: x, y*
> *- Velocity fields: vx, vy*
> *- A grounded flag: true if the fighter's feet are on a surface, false if airborne*
> *- A facing direction: +1 for right, -1 for left*
> *- A reference to its character config (stats and visual properties)*

The position anchor is at the **bottom-center** of the body. If a fighter is 30 pixels wide and 60 pixels tall, and `fighter.y` is 400, then the feet are at y=400 and the top of the head is at y=340. This is a deliberate choice, and it's load-bearing: collision will check whether `fighter.y` matches a platform's y, and rendering will draw the body from `y - height` up to `y`. Changing the anchor would touch every system.

Why bottom-center? Because the most common geometric question in a platform fighter is "are my feet on the ground?", and that's answered by comparing `fighter.y` directly to the surface's y. If the anchor were top-left, every system would constantly be doing `y + height` math to figure out where the feet are.

The fighter is created by a factory function:

> *To create a fighter from a config at position (x, y):*
> *Make a new object.*
> *Set its position to (x, y), velocity to (0, 0), grounded to false, facing to +1.*
> *Store a reference to the config.*
> *Return the object.*

Grounded starts as false. The fighter spawns in the air. Physics will pull it down. Collision will catch it on the floor. The first frame of the game tells the entire story of the engine.

## Physics, conceptually

Physics has three primitives that run every frame: **gravity adds to vertical velocity**, **friction reduces horizontal velocity**, and **integrate moves position by velocity**.

These are pure functions on bodies. A "body" is anything with `{x, y, vx, vy}` fields — physics doesn't know what a fighter is, doesn't know what a state is, doesn't know what a stage is. You hand it a body, it modifies the body. This is what keeps `core/physics.js` reusable: it would work in a completely different game with the same body shape.

### Gravity

> *To apply gravity to a body, given a gravity value:*
> *Add the gravity value to the body's vy.*

That's it. Gravity is acceleration: a force that increases velocity per frame. Y-down means gravity is a positive number (jumping is negative vy; falling is positive vy). The value is 0.4 pixels per frame squared in our tuning — a quiet, small number that feels right when fighters fall through air.

There's an important thing not happening here: gravity is **not** something the physics module decides to apply on its own. The physics module exposes the primitive `applyGravity(body, value)`. Whether to call it on a given frame, and what value to pass, is the caller's decision. In Phase 3, gravity is applied every frame to airborne bodies. In Phase 5, state-specific gravity multipliers will modulate it. In Phase 8, terminal velocity capping will be added. But the primitive itself stays simple.

### Friction

> *To apply friction to a body, given a friction value:*
> *Take the absolute value of the body's vx.*
> *If that value is less than or equal to the friction value:*
> *Set vx to zero. (Snap to rest — don't overshoot.)*
> *Otherwise:*
> *Subtract a "friction step" from vx in the direction opposite to its current sign.*

The snap-to-zero case matters more than it looks. Without it, a body with vx = 0.05 and friction = 0.1 would oscillate forever: subtract 0.1 → vx = -0.05, next frame subtract -0.1 → vx = 0.05, and so on. The snap makes friction a one-way force: it only decelerates, it never reverses direction.

A subtler decision: friction is per-frame, not per-second. The value 0.1 means "vx loses 0.1 px/frame per frame." If we ever changed the framerate, friction tuning would need to change. The 60Hz lock makes this safe.

### Integration

> *To integrate a body:*
> *Add the body's vx to its x.*
> *Add the body's vy to its y.*

Two assignments. This is Euler integration, the simplest possible numerical integration scheme. It has small inaccuracies at high velocities — energy isn't perfectly conserved — but those don't matter for a platform fighter. The game runs at a fixed timestep, the velocities are bounded, the visual result feels right.

There are fancier integration schemes (Verlet, RK4) that would conserve energy better, but they're solving problems we don't have. Euler is correct here because correctness is "the game feels right at 60fps," not "the simulation matches Newtonian mechanics to ten decimals."

## The physics system, conceptually

The physics system is what calls into the physics primitives. It reads the World, decides what to apply to each fighter, and writes results back.

In Phase 3, before states exist, the system is unconditional:

> *Every frame, for each fighter in the World:*
>
> *If the fighter is not grounded:*
> *Apply gravity using the character's gravity value.*
>
> *Apply friction using the character's friction value.*
>
> *Integrate.*

Gravity is gated by `grounded` because a grounded fighter shouldn't accumulate vy — the floor is pushing them up exactly as hard as gravity pulls them down. Friction always applies in Phase 3 (this gets refined in Phase 5 when states declare how much friction to use). Integrate always runs.

Notice what's missing: horizontal motion is **not** driven by physics in Phase 3. The fighter has no inputs yet, and no state machine to interpret them. If a fighter starts with vx ≠ 0, friction will slow it to zero. If it starts at vx = 0, it stays at zero. The fighter falls straight down. That's the entire behavior in Phase 3.

## Collision, conceptually

Collision is where Phase 3 gets genuinely tricky. The naive approach is "after physics moves the fighter, check if the fighter overlaps a platform; if so, push it out." This doesn't work for fast-moving objects.

Here's why: imagine a fighter at y=395 moving downward with vy = 10. After integration, y becomes 405. The platform is at y = 400. If we check overlap at y=405, the fighter is below the platform — but visually they're past it. Worse: if the platform is paper-thin (a 1-pixel line, as our platforms are), the fighter at y=405 isn't overlapping the platform at all (the platform exists only at y=400, the fighter is at 405). The fighter would fall through.

This is called **tunneling**. The fast-moving object passes through a thin obstacle in one frame because the obstacle was never sampled.

The fix is **swept collision**: instead of checking "is the fighter overlapping the platform now?", check "did the fighter's motion path cross the platform's line during this frame?"

### Computing the previous position

Swept collision needs to know where the fighter was *before* this frame's integration. We don't store that — we derive it:

> *The fighter's previous position is: current position minus current velocity.*
> *xPrev = fighter.x - fighter.vx*
> *yPrev = fighter.y - fighter.vy*

This works because physics is the only thing that moved the fighter between frames, and physics did it by `x += vx; y += vy`. Subtracting the velocity gives us the pre-integration position.

This trick is load-bearing across the entire collision system, including all later phases. It means we never store last-frame state on the fighter — we derive it when we need it. One less field to maintain.

### The sweep test, conceptually

The fighter moved from `(xPrev, yPrev)` to `(xNow, yNow)`. We want to know: did this motion path cross the platform's line?

For a horizontal platform at y = platformY, the question becomes: did the motion path cross y = platformY at some point?

> *The motion crossed the platform's y line if and only if:*
> *yPrev was strictly less than platformY (the fighter was above the platform before)*
> *AND*
> *yNow is greater than or equal to platformY (the fighter is at or below the platform now).*

That's the "did we cross?" question. If we crossed, we need to know **where** along the path we crossed, in x, because the platform isn't infinitely wide — it extends from x1 to x2.

The motion path is a straight line from `(xPrev, yPrev)` to `(xNow, yNow)`. We can parameterize it with `t` running from 0 to 1: at t=0 we're at the start, at t=1 we're at the end. At any t in between, the position is:

```
x(t) = xPrev + t * (xNow - xPrev)
y(t) = yPrev + t * (yNow - yPrev)
```

We want the t-value where y(t) = platformY. Solving:

```
t = (platformY - yPrev) / (yNow - yPrev)
```

Then plug t back into the x equation to get the x at the moment of crossing:

```
hitX = xPrev + t * (xNow - xPrev)
```

> *If the fighter crossed the platform's y line, compute the t-value at which the crossing happened.*
> *Compute hitX = xPrev + t * (xNow - xPrev).*
> *If hitX is between the platform's x1 and x2, this is a hit at (hitX, platformY).*
> *Otherwise, the motion crossed the y line but outside the platform's x range — no hit.*

That's the complete swept collision primitive. It handles fast falls correctly: even if the fighter moves from y=395 to y=805 in one frame, the sweep catches the crossing at y=400 and reports the hit.

There's one degenerate case: if `yPrev == yNow` (no vertical motion), the formula divides by zero. The function checks for this and returns "no hit" — if you didn't move vertically, you didn't cross a horizontal line. This case will matter when a fighter is walking along the top of a platform at constant y; we don't want phantom hits firing every frame.

## The collision system, conceptually

The collision system applies the sweep test to each fighter against each platform.

> *Every frame, for each fighter in the World:*
>
> *Compute xPrev and yPrev from the fighter's current position and velocity.*
>
> *For each platform in the stage:*
>
> *Run the sweep test from (xPrev, yPrev) to (fighter.x, fighter.y) against the platform.*
>
> *If a hit is reported:*
> *Set fighter.x = hitX.*
> *Set fighter.y = platformY.*
> *Set fighter.vy = 0.*
> *Set fighter.grounded = true.*
> *Stop checking platforms for this fighter (first hit wins).*

When the sweep reports a hit, we **snap** the fighter to the contact point and zero the vertical velocity. The fighter is now on the platform — physically present at the surface, not passing through it. Setting `grounded = true` tells the next frame's physics not to apply gravity.

The "first hit wins" rule matters because the fighter could in theory cross multiple platforms in one frame (a very fast fall through several stacked platforms). For Phase 3 with three platforms that don't stack vertically, this almost never happens, but the rule is correct: the *first* surface the fighter encounters is the one they land on.

### Walking off the edge

There's a case the collision system has to handle that isn't a hit: the fighter is grounded, walks horizontally across a platform, and walks past the edge. They should fall.

In Phase 3, fighters have no horizontal motion (no inputs yet), so this case doesn't actually fire. But the logic gets added now anyway, in anticipation of Phase 4-5:

> *After all sweep tests, if no hit was reported this frame, and the fighter is currently grounded:*
>
> *Check whether the fighter is still on a surface: is their y equal to any platform's y, AND is their x between that platform's x1 and x2?*
>
> *If not on any surface, set fighter.grounded = false.*

This is the "walk-off" check. It runs only when grounded was already true and no new hit fired this frame — meaning the fighter didn't land on something new but might have left what they were standing on.

The check uses **exact equality** on y (`fighter.y === platform.y`). This works because a grounded fighter has vy = 0, so physics doesn't change y, so y stays exactly equal to the platform's y after the initial snap. If anything ever set vy ≠ 0 while grounded (a bug), the equality check would fail and the fighter would become un-grounded — that's a loud failure, which is what we want.

## How a frame plays out in Phase 3

Concretely, the fighter spawns at (400, 100). It's airborne, vy = 0.

> **Frame 1:**
> *Physics: not grounded, apply gravity → vy = 0.4. Apply friction (vx is 0, nothing changes). Integrate → y = 100.4.*
> *Collision: xPrev = 400, yPrev = 100. Sweep against main floor at y=400: yPrev (100) < 400 but yNow (100.4) < 400, no crossing. No hit. Was not grounded, skip walk-off check.*

> **Frame 2:**
> *Physics: vy = 0.8. Integrate → y = 101.2.*
> *Collision: no crossing yet.*

> *... many frames pass, vy grows ...*

> **Frame ~30:**
> *Physics: vy ≈ 12. Integrate → y might jump from 395 to 407.*
> *Collision: xPrev = 400, yPrev = 395. Sweep: yPrev (395) < 400 AND yNow (407) ≥ 400 → crossed. t = (400 - 395) / 12 = 0.42. hitX = 400. In range [180, 780]. HIT.*
> *Snap fighter.y = 400, vy = 0, grounded = true.*

> **Frame 31 onward:**
> *Physics: grounded, skip gravity. Apply friction (vx still 0). Integrate (no movement, vx = vy = 0).*
> *Collision: no motion, no sweep crossing. fighter.grounded was true. Walk-off check: y = 400 matches main floor's y, x = 400 in [180, 780]. Still on surface. Grounded stays true.*

The fighter has landed. Frames keep ticking, but nothing else happens — the fighter sits at (400, 400) forever.

## What's load-bearing about Phase 3

A few decisions established here echo through every later phase.

**The fighter's anchor is at the bottom-center.** Every position comparison from this point on assumes this.

**Previous position is derived, not stored.** xPrev = x - vx, yPrev = y - vy. This stays true even after Phase 5 introduces states that don't change velocity — it's correct because *whatever* changed position did so by `x += vx; y += vy`.

**Collision uses swept tests, not overlap tests.** This prevents tunneling and will scale to fast-moving fighters later. The math (parameterize motion as a line, find t where y = platformY, plug t into x) is the same primitive used in Phase 8 for solid sides and the bottom-bump test.

**Physics is unconditional in Phase 3; states will modulate it in Phase 5.** Gravity always applies (if airborne). Friction always applies. This will become "gravity scaled by state.gravity, friction scaled by state.friction" in Phase 5. The Phase 3 version is a baseline that future phases generalize, not a placeholder.

**Grounded is a flag set by collision, read by physics.** Physics doesn't decide grounded; collision does. Physics asks "am I grounded?" and skips gravity if yes. This separation of concerns — collision owns "where am I in space," physics owns "how do forces affect motion" — survives unchanged into every later phase.

**No state machine yet.** The fighter has no concept of "action" — no Idle, no Walk, no Fall. There's just a position, a velocity, and a grounded flag. Phase 5 will add the state layer on top, and the state layer will *modulate* physics (by providing gravity multipliers, friction multipliers, etc.) but never *replace* it.

---

That's Phase 3. The engine is now a functioning physical simulation: a body in space, subject to forces, constrained by geometry. It's lifeless — there's no input, no agency, no goal — but the substrate is in place.
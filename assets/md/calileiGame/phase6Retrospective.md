## Phase 6: Squat and Double Jump

Phase 6 is a smaller phase by line count but introduces something new architecturally: **the fighter starts carrying state of its own**, not just position and velocity. Specifically, it starts counting things — how many air jumps it has used.

This is the first time runtime state lives on the fighter beyond the basics. Up to Phase 5, every behavioral question could be answered by looking at the fighter's actionState plus the input buffer. From Phase 6 onward, some questions need a counter: "have you used your double jump yet?" can't be derived from the state alone, because the fighter is in Fall whether or not they've already double-jumped. The counter remembers.

The phase has three distinct pieces. **Squat** is a new grounded state, the down-held companion to Idle. **AirJump** is a new airborne state, the "I pressed jump while in the air" companion to Fall. And the substrate to make AirJump work introduces the `airJumpsUsed` counter, the `canAirJump` condition, and the `applyAirJumpImpulse` and `resetAirJumps` effects.

Let me walk through each.

### Squat, conceptually

Squat is what happens when the player holds down while on the ground. The fighter crouches. In Phase 6, crouching does nothing mechanically — it's just a posture you can be in. In Phase 9 it becomes the entry point for dropping through platforms.

The data:

> *Squat:*
> *Duration: 0 (no auto-exit).*
> *Physics: gravity 1.0, friction 1.0, horizontalMode 'none'.*
> *Transitions:*
> *notGrounded → Fall*
> *jumpPressed → JumpSquat*
> *notCrouchInput → Idle*
> *Render: color #aa3333 (darker red).*

Most of this is unremarkable — Squat looks a lot like Idle. Same physics (full friction, no horizontal driving), same priority for notGrounded. The differences:

**It has a `notCrouchInput → Idle` transition.** When the player releases down, the fighter returns to Idle. This is the inverse of how Idle entered Squat in the first place (via `crouchInput`). The pair `crouchInput`/`notCrouchInput` is a new entry in the conditions registry — they're trivial:

> *crouchInput: returns true if the current snapshot has stickY > 0.*
> *notCrouchInput: returns true if the current snapshot has stickY <= 0 (or no snapshot).*

The Y-down convention shows up here: positive stickY means the player is pressing down. The naming chose "crouch" rather than "down" because it reads as intent — the condition isn't about a direction, it's about wanting to crouch.

**It has a `jumpPressed → JumpSquat` transition.** This is what enables crouch-jumping. Player holds down, fighter is in Squat, player presses jump, fighter goes through JumpSquat → Fall like any other jump. The Squat state doesn't interfere; it just offers jump as one of its exit conditions.

**It gets a render color override.** This is the first use of the optional render field on state data. The Phase 5 states didn't override color — they all rendered with the default red (#dd5555). Squat uses a darker red (#aa3333) so the player can visually distinguish it from Idle without checking the debug overlay. This sets the pattern for future states: Phase 7 will color Dash orange, Phase 8 will color FastFall a different dark red. Color is a debugging affordance that ships in the game itself.

### Idle, updated

For Squat to be reachable, Idle needs to be able to transition into it.

> *Idle's transitions, updated:*
> *notGrounded → Fall*
> *jumpPressed → JumpSquat*
> *crouchInput → Squat (new)*
> *horizontalInput → Walk*

`crouchInput` is inserted as priority 3, between jumpPressed and horizontalInput. The choice of position is deliberate: notGrounded and jumpPressed are higher because they represent immediate, time-critical events (falling and jumping shouldn't be delayed by crouching). crouchInput sits above horizontalInput because if the player is holding both down and a direction, the down should win — you go into Squat, not Walk. (This is a feel choice; Melee handles this differently with its dash threshold, but for our keyboard-driven scheme, "down beats direction" is the simpler rule.)

Walk and Land get similar updates, with `crouchInput → Squat` inserted in their transition lists. Squat needs to be reachable from any grounded state where pressing down should crouch you.

### AirJump, conceptually

AirJump is the state the fighter enters when they press jump in mid-air. It's the second jump. The "double jump."

A first instinct might be: "AirJump is just Fall with an extra jump impulse — can't we use Fall for both?" The answer chosen in Phase 6 is **no, AirJump is its own state**. The reasoning: even though the physics behavior is identical to Fall, calling the state "AirJump" makes it explicit in the debug overlay what the fighter is doing. It also gives future phases a clear hook — if we ever want to give air jumps different physics (a stronger upward arc, a more limited horizontal control), AirJump's physics modifier is where that goes. The duplication today is the price of clarity and extensibility.

The data:

> *AirJump:*
> *Duration: 0.*
> *Physics: gravity 1.0, friction 0, horizontalMode 'air'.*
> *Transitions:*
> *grounded → Land (with effect: resetAirJumps)*

(Phase 8 will add fast-fall and air-jump-from-AirJump transitions. For Phase 6, AirJump only knows about landing.)

The physics are identical to Fall's: normal gravity, no friction (you're in the air), air-mode horizontal motion. The visible difference is just the name.

### The fighter gets a new field

To gate the double jump, the fighter needs to count. **A new field: `airJumpsUsed`, an integer.**

Initialized to 0 when the fighter is created. Incremented when an air jump fires. Reset to 0 when the fighter lands.

In the fighter factory:

> *To create a fighter, the existing fields are set as before, plus:*
> *airJumpsUsed = 0.*

The character config gets a corresponding stat:

> *fighterA's physics, with one new field:*
> *maxAirJumps = 1 (single double jump).*

This is the first character-config field that gates a *gameplay* mechanic, not just tunes physics. walkSpeed and gravity are quantitative; maxAirJumps is qualitative — change it from 1 to 2 and the fighter has triple-jump. From 0 and they can't air-jump at all.

### The canAirJump condition

This is the most interesting new condition in the project so far, because it has *two* sub-checks combined.

> *canAirJump: returns true if both:*
> *(1) jump was pressed within the last 3 frames (a buffered jump press).*
> *(2) airJumpsUsed is less than maxAirJumps.*

The first sub-check is just `wasPressedWithin(buffer, 'jump', 3)`. Pretty standard. But notice the window: **3 frames, not 5**. The standard jumpPressed condition uses 5; canAirJump uses 3. Why?

This is one of the subtler bug fixes that happened during Phase 6 implementation. Imagine the player presses jump on the ground. JumpSquat fires (jumpPressed sees the press at buffer index 0). JumpSquat lasts 3 frames. On the third frame, durationElapsed fires, Fall begins, applyJumpImpulse sets vy = -8. The jump press is now at buffer index ~3.

If canAirJump used the same 5-frame window, on Fall's *very next frame* (frame 4 after the press), canAirJump would see the still-buffered press, observe that airJumpsUsed (0) < maxAirJumps (1), and fire. The fighter would immediately double-jump, on the first frame of being airborne, having spent zero time as a "normal" jump.

That's wrong. The original press was the ground jump — it shouldn't auto-promote to an air jump as soon as the fighter is airborne. The 3-frame window for canAirJump is tight enough that by the time Fall starts, the original press has already aged out (3 + 3 = 6 frames since the press, but canAirJump only looks back 3). The player has to press jump *again* in the air, fresh, for canAirJump to fire.

This is the kind of timing bug that's only visible if you trace through frame-by-frame. The fix is one constant value. The lesson: input windows are tuning knobs, and different conditions need different windows depending on what scenario they're meant to catch.

### The applyAirJumpImpulse and resetAirJumps effects

> *applyAirJumpImpulse: sets fighter.vy to negative of airJumpForce, AND increments fighter.airJumpsUsed by 1.*

Two operations in one effect. The first is the impulse: vy gets overwritten (not added to — overwritten) with the new upward velocity. This means whether you were rising, level, or falling at the moment you air-jumped, the result is the same upward burst. An air jump while falling fast doesn't get reduced by the existing downward velocity; the velocity is reset and replaced with the jump impulse. This is what makes air jumps feel responsive: the jump always produces the same height regardless of when you trigger it.

The second is the counter increment. This is the bookkeeping that prevents you from air-jumping forever. Each fire of applyAirJumpImpulse uses one of your available air jumps.

> *resetAirJumps: sets fighter.airJumpsUsed to 0.*

This is the inverse. When does it fire? On transitions from any airborne state back to grounded — specifically, on the `grounded → Land` transition. Land is the only entry point back from airborne. So whenever the fighter lands, their air jumps are refreshed.

This is the only place in the engine where air-jump availability is restored. If a future phase added a different airborne-to-grounded transition (say, getting hit and tech'ing on the ground), that transition would also need to call resetAirJumps. Today there's just one path, and it has the effect attached.

### Fall, updated

For air jumps to fire, Fall needs the new transition:

> *Fall's transitions, updated:*
> *grounded → Land (with effect: resetAirJumps) [unchanged]*
> *canAirJump → AirJump (with effect: applyAirJumpImpulse) [new]*

The order matters. `grounded` is priority 1 — if the fighter is touching down on the same frame they pressed jump (extreme edge case), they land first. `canAirJump` is priority 2 — if they're still airborne, the jump press converts to an air jump.

### The full air-jump sequence, traced

Let's walk through a complete double-jump to see all the pieces working together.

> *Frame 100: fighter is on the ground, Idle. Player presses Space.*
> *stateSystem: jumpPressed fires (rising edge at buffer[0]). Idle → JumpSquat.*
> *Frame 100 ends with actionState = JumpSquat, stateFrame = 0.*
>
> *Frames 101–102: JumpSquat counts down.*
>
> *Frame 103: JumpSquat's stateFrame is 2. durationElapsed: 2+1=3 ≥ 3, fires.*
> *applyJumpImpulse: vy = -8. actionState = Fall, stateFrame = 0.*
>
> *Frames 104+: Fall. Gravity adds 0.4 to vy each frame. Fighter ascends, slows, apexes, descends.*
>
> *The original jump press at buffer index 3+. Outside canAirJump's 3-frame window. Doesn't fire.*
>
> *Frame 130 (arbitrary, somewhere mid-air): player presses Space again.*
> *Frame 131: stateSystem in Fall. canAirJump checks: jump press within 3 frames? Yes (buffer[0] or thereabouts). airJumpsUsed (0) < maxAirJumps (1)? Yes. **Fires.***
> *applyAirJumpImpulse: vy = -8, airJumpsUsed = 1. actionState = AirJump, stateFrame = 0.*
>
> *Frames 132+: AirJump. Gravity continues. Fighter ascends, slows, etc.*
>
> *Player presses Space again at frame 160.*
> *Frame 161: stateSystem in AirJump. (AirJump's transitions in Phase 6: just `grounded → Land`. No canAirJump transition listed!) The press goes unconsumed.*

(Note: Phase 8 will add `canAirJump → AirJump` to AirJump's own transition list, enabling chained air-jumps if maxAirJumps were greater than 1. For Phase 6 with maxAirJumps = 1, the question doesn't arise — you'd never have a second air jump to use anyway.)

> *Eventually frame X: fighter lands. grounded becomes true.*
> *Frame X+1: stateSystem in AirJump. grounded fires. resetAirJumps: airJumpsUsed = 0. actionState = Land, stateFrame = 0.*

The cycle is complete. The counter went 0 → 1 (on air-jump) → 0 (on landing). The fighter can now air-jump again whenever they re-enter Fall.

### What's load-bearing about Phase 6

A few new architectural patterns that future phases will reuse.

**The fighter has a counter now.** `airJumpsUsed` is the first piece of mutable, gameplay-relevant runtime state on the fighter that isn't position, velocity, or grounded. This unlocks the pattern: when a state needs to know "have I done this thing already?", a counter on the fighter is the right place. Phase 8's `fallSpeedMax` lives on the state; the *count of how many times I've done it* lives on the fighter.

**Two different jump-buffer windows coexist.** `jumpPressed` uses 5 frames; `canAirJump` uses 3. Both are named constants in conditions.js. The takeaway: timing windows are not universal. Each condition gets its own constant, tuned to what scenario it's supposed to catch.

**Effects can do multiple things in one fire.** applyAirJumpImpulse both sets vy AND increments airJumpsUsed. This is fine — effects are mutation, and an effect can mutate as many fields as makes sense for what it represents. (resetAirJumps stays simple because resetting is one operation.)

**Pair-of-states architecture.** Idle/Squat are a "stance pair" (one for default, one for held-down). Fall/AirJump are a "vertical-momentum pair" (one for gravity-only, one for jump-impulse). Future phases will add Dash/DashBack as another pair. The pattern of "make a separate state for the variant rather than overloading a single state with conditional behavior" survives.

**Render overrides earn their place.** Squat gets a color override because visually distinguishing it from Idle is useful for the player and the developer. Future states (Dash, FastFall, etc.) will all get colors. The architecture supports any render override — color today, sprite/animation hints later — without code changes.

---

That's Phase 6. The fighter can now crouch, jump-out-of-crouch, and double-jump. The architectural cost was modest: one new condition pair, one new compound condition, two new effects, two new states, one new fighter field, one new character stat. Everything else (the state machine, the systems, the registries) absorbed the changes without modification.
## Phase 7: The Dash Family

Phase 7 introduces dashing, and it's the phase where the engine starts to feel like a platform fighter rather than a generic 2D physics demo. Four new states get added: **Dash**, **DashBack**, **Run**, and **DashStop**. They form a small interaction graph among themselves and with the rest of the state vocabulary. The player can now slam a direction to burst forward, reverse mid-dash, transition into a sustained run, and brake when they release.

Three new architectural pieces support the new states. A **rising-edge detector on the stick** (`stickSlammed`) reads the input buffer to distinguish "slammed" from "held." A **new horizontal mode** (`'dash'`) joins the physics dispatch, driving vx from facing × dashSpeed rather than from stickX. And a **new effect** (`commitFacingFromSlam`) lets transitions snap facing to the direction that triggered them, decoupling facing from the moment-to-moment stick.

There's also a quiet but consequential fix to the air-drift physics in `addHorizontalVelocity` — the asymmetric-cap behavior — that makes dashing off an edge feel right.

I'll walk all of it in order.

### What "slamming the stick" means

The whole dash family rests on one detection rule: the player **slammed** the stick into a direction, meaning they went from neutral to non-neutral within a small recent window. This is the difference between a casual hold and an aggressive tap.

The simplest version would be "stickX changed direction this frame." That's too tight — it requires the player to release stick on frame N-1 and press on frame N, both within one frame at 60Hz, ~16ms apart. Real players don't have that timing.

The actual rule:

> *stickSlammed returns true if:*
> *the current stickX is non-zero, AND*
> *somewhere within the last 5 frames, there was a transition from "stickX = 0" to "stickX ≠ 0".*

The current-stickX check is a gate. It prevents stickSlammed from firing when the player has released the stick — even if they slammed it a few frames ago, if they're back to neutral now, it doesn't count.

The five-frame lookback is the forgiveness window. It says "I saw you go from neutral to a direction within the last few frames." So a player who taps and releases within 5 frames *and* re-presses within 5 frames could in principle re-trigger. In practice, the gate keeps things sane.

> *To check: walk the buffer pairs from newest to oldest, up to 5.*
> *For each pair (buffer[i], buffer[i+1]):*
> *If buffer[i].stickX ≠ 0 AND buffer[i+1].stickX = 0, that's a slam.*
> *Return true on the first slam found.*
> *Otherwise return false.*

This is closely analogous to `wasPressedWithin('jump', N)` from Phase 4. The shape is the same — walk pairs of adjacent buffer entries, look for a rising edge. The only difference is what counts as "rising": for `jumpPressed` it's a boolean key going from false to true; for `stickSlammed` it's a numeric axis going from zero to non-zero.

A second related condition gets added:

> *stickReverseFromFacing returns true if:*
> *current stickX is non-zero, AND*
> *its sign is the opposite of the fighter's current facing.*

This doesn't need a slam — it's a pure direction check. It exists to detect the case where the player, mid-dash, pushes the stick the *other* way. That triggers a turnaround (Dash → DashBack), which is a feel-improvement: aggressive direction-changes shouldn't require a precise release-and-slam.

### The dash mode in physics

A new entry joins the horizontal-mode dispatch in `physicsSystem.js`:

> *'dash' mode: set vx to fighter.facing × dashSpeed.*

This looks similar to 'walk' mode, but with one crucial difference: **'dash' reads facing, not stickX.** In 'walk' mode, vx is `stickX × walkSpeed` — the player's currently-held direction. In 'dash' mode, vx is `facing × dashSpeed` — the direction the fighter is committed to.

Why? Because dashing is a *commitment*. Once you've slammed right, the fighter is dashing right, period. The fact that you stopped pressing the stick mid-dash, or even started pressing the other direction, doesn't immediately change vx — it has to go through the transition machinery (Dash → DashBack, for example) for direction to actually change.

This is what makes dashing feel different from walking. Walking is responsive: vx follows the stick instantaneously. Dashing is committed: vx is set by facing, and facing only changes when a transition fires `commitFacingFromSlam`.

The facing update happens in the effect:

> *commitFacingFromSlam: read the current snapshot's stickX. If non-zero, set fighter.facing to its sign.*

This effect fires on the moment of transition. When Idle → Dash fires (via stickSlammed), commitFacingFromSlam reads the just-slammed stickX, computes its sign (+1 or -1), and snaps facing. From that point on, the dash mode reads facing every frame and drives vx accordingly. The stick can be released, repressed, anything — vx is locked to facing until another transition changes facing.

This separation — facing as committed state, updated only by transitions — is the architectural device that makes dash, run, and dashback distinguishable from walk. It's also why DashBack needs to be a separate state from Dash, which I'll get to in a moment.

### The four new states

#### Dash

> *Dash:*
> *Duration: 10 (auto-exits after 10 frames).*
> *Physics: gravity 1.0, friction 0, horizontalMode 'dash'.*
> *Transitions:*
> *notGrounded → Fall*
> *jumpPressed → JumpSquat*
> *crouchInput → Squat*
> *stickReverseFromFacing → DashBack (with effect: commitFacingFromSlam)*
> *noHorizontalInput → DashStop*
> *durationElapsed → Run*
> *Render: color #ff8844 (orange).*

Dash is the 10-frame burst. The physics modifier uses `'dash'` mode, with friction at 0 because dash mode sets vx directly. Gravity stays at 1.0 in case the fighter somehow ends up airborne (the notGrounded transition catches that immediately).

The transitions are where Dash earns its place. Six of them, in priority order. The first three are escape hatches: if the fighter falls off, presses jump, or crouches, those win over the dash itself. The next three define how Dash ends: by reversing into DashBack, by stopping (releasing the stick), or by transitioning to Run after 10 frames.

The priority of `stickReverseFromFacing` above `noHorizontalInput` is deliberate. A player who slams right, then slams left, will go through neutral momentarily. If `noHorizontalInput` were checked first, the brief neutral frame might trigger DashStop before stickReverseFromFacing got the chance to fire DashBack. Putting reverse-detection above neutral-detection means: even with imperfect input, the engine prefers to interpret the motion as a direction change rather than a release.

#### DashBack

> *DashBack:*
> *(Identical to Dash, except color #ee6622, slightly darker orange.)*
> *Transitions:*
> *notGrounded → Fall*
> *jumpPressed → JumpSquat*
> *crouchInput → Squat*
> *stickReverseFromFacing → Dash (with effect: commitFacingFromSlam)*
> *noHorizontalInput → DashStop*
> *durationElapsed → Run*

DashBack is structurally a mirror of Dash. Same duration, same physics, same priority list. The difference: when DashBack's `stickReverseFromFacing` fires, the destination is Dash (not DashBack itself). The two states form a back-and-forth pair — Dash one direction, reverse it, you're in DashBack the other direction; reverse again, back to Dash.

Why are they separate states? Couldn't Dash just transition to itself? The decision came down to clarity. Two reasons:

**The debug overlay should show what's happening.** When the player slams left then right, seeing the state change from Dash to DashBack to Dash makes the sequence legible. If it were all "Dash" forever, you'd lose information about the dash dance.

**Future tunings might differ.** DashBack's 10-frame duration today matches Dash's. But if we ever decided the reverse-dash should have a slightly different feel — shorter, longer, different friction profile — having a separate state is the place to express that. Today it's a clone; tomorrow it might not be.

This is the substrate-first principle showing up: pay the cost of an extra state today to keep the door open for free variation tomorrow.

#### Run

> *Run:*
> *Duration: 0 (no auto-exit).*
> *Physics: gravity 1.0, friction 0, horizontalMode 'dash'.*
> *Transitions:*
> *notGrounded → Fall*
> *jumpPressed → JumpSquat*
> *crouchInput → Squat*
> *stickReverseFromFacing → DashBack (with effect: commitFacingFromSlam)*
> *noHorizontalInput → DashStop*
> *Render: color #ffaa44 (lighter orange).*

Run is the sustained version of Dash. The fighter keeps moving at dashSpeed indefinitely, until something interrupts. The transitions are the same set Dash and DashBack have, *minus* durationElapsed — Run has no duration, no automatic exit.

The relationship: Dash lasts 10 frames, and if nothing interrupts, durationElapsed sends you into Run. Run continues at the same dash speed (still using `'dash'` horizontalMode reading facing × dashSpeed). The player has, in effect, committed to running. Releasing the stick (DashStop) or reversing (DashBack) is the only way out, short of jumping or falling off.

In real platform fighters, this is the "you're now running" feeling — once you've committed past the initial dash burst, you're in a continuous-motion mode. The architecture matches by making Run a distinct, durationless state.

#### DashStop

> *DashStop:*
> *Duration: 4.*
> *Physics: gravity 1.0, friction 1.0, horizontalMode 'none'.*
> *Transitions:*
> *notGrounded → Fall*
> *jumpPressed → JumpSquat*
> *crouchInput → Squat*
> *stickSlammed → Dash (with effect: commitFacingFromSlam)*
> *durationElapsed → Idle*
> *Render: color #aa5544 (dark muted red-orange).*

DashStop is the brake. When the player releases the stick during Dash, DashBack, or Run, the fighter enters DashStop for 4 frames. Friction is at 1.0 — full friction — so the residual dash velocity bleeds off across those 4 frames. At the end, durationElapsed transitions to Idle.

DashStop has the same "escape" transitions as Dash (jump, crouch, fall), plus `stickSlammed → Dash`. This last one is the interesting feel-choice: a player who released and then immediately re-slammed gets a fresh Dash, even though they're still in the middle of stopping. This is what makes rapid dash-dancing possible. You don't have to wait for DashStop to finish — slam again and you're back into Dash.

### Walk's transitions update

For Dash to be reachable, Walk needs the slam transition too:

> *Walk's transitions, updated:*
> *notGrounded → Fall*
> *jumpPressed → JumpSquat*
> *crouchInput → Squat*
> *stickSlammed → Dash (with effect: commitFacingFromSlam) [new]*
> *noHorizontalInput → Idle*

The slam check sits at priority 4, after crouchInput but before noHorizontalInput. This means: a player walking right who then slams right (with a neutral frame in between) will transition into Dash. The walking velocity (vx = walkSpeed) gets replaced by dashSpeed on entry. The player effectively "burst-accelerates" from walking to dashing.

Similarly, Idle and Land both get the slam transition. From Idle, slamming directly transitions to Dash — this is the standard "burst from rest." From Land, slamming during the 4-frame landing lag transitions to Dash — this is "dash out of landing," a useful combat-engine pattern.

### The asymmetric-cap fix in addHorizontalVelocity

This is the quiet but consequential physics change. Without it, dashing off the edge of a platform would feel wrong.

The setup: in air-mode (used by Fall, AirJump), `addHorizontalVelocity` accelerates vx by stickX × airAccel, capping at airSpeedMax (2.0 in the tuning). When the fighter is dashing on the ground (vx = ±2.8 from dashSpeed), and walks off the edge, the state transitions to Fall and air-mode takes over. The fighter's vx is 2.8, but airSpeedMax is 2.0 — vx is already past the cap.

What should air-mode do? Two options:

**Option A: clamp vx to airSpeedMax.** When the fighter falls off the ledge, their vx snaps from 2.8 to 2.0. They lose 0.8 of horizontal velocity instantly. The dash's momentum is *yanked back* to the air-drift cap.

**Option B: let vx stay at 2.8 if it's already there, but don't accelerate further outward.** The fighter falls off with vx = 2.8 preserved. If they're still holding the dash direction, air-accel would push them further (2.8 + airAccel = 2.81+, but they're already past the cap so this doesn't happen). If they release the stick, vx stays at 2.8 until something else changes it. If they push the *opposite* direction, air-accel pulls them back toward zero — full deceleration applies normally.

Phase 7 chose Option B. The rule:

> *If vx is already past the cap (above maxSpeed or below -maxSpeed):*
> *Accelerating in the same direction is a no-op (don't push further outward).*
> *Accelerating in the opposite direction applies normally (deceleration always works).*
>
> *If vx is within the cap:*
> *Accelerate. If the result would exceed the cap, clamp to the cap. (Normal behavior.)*

This is the "asymmetric cap." It's asymmetric because pushing outward when already past the cap doesn't compound, but pushing inward (toward zero) always works. It preserves dash momentum while still letting the player decelerate in the air normally.

This change isn't a new function — it's a modification of the existing `addHorizontalVelocity` from Phase 3. The function still gets called from air-mode every frame. The result is that dashing off an edge produces a true "carry the dash speed into the air" feel, and the player can still air-decelerate by pulling the stick back. Both behaviors emerge from the same rule.

### How the dash family flows in practice

Let me walk a few representative sequences, since seeing the states transition is more useful than reading them in isolation.

**Slam right from rest:**

> *Frame 0: Idle. stickX = 0.*
> *Frame 1: player presses Right. stickX = +1.*
> *Frame 2: stateSystem in Idle. stickSlammed fires (slam at buffer[1] → buffer[0]). Transition: Idle → Dash, with commitFacingFromSlam (facing = +1). stateFrame = 0.*
> *Frame 2 physics: dash mode. vx = +1 × 2.8 = 2.8.*
> *Frames 3–11: Dash continues, stateFrame increments. vx stays at 2.8 (dash mode reads facing every frame).*
> *Frame 12: stateFrame = 10. durationElapsed: 10+1 >= 10? Hmm wait, 10+1=11 >= 10 yes, fires. Hmm wait, stateFrame 10 means we've been in Dash for 10 frames already (state entered with stateFrame=0; this is the 11th frame, no — let me re-check).*

Let me redo. duration 10 means the state lasts 10 frames. Entered on frame 2 with stateFrame=0. End of frame 2: stateFrame becomes 1. Frame 3 starts with stateFrame=1. The check is `stateFrame + 1 >= duration`, so we need stateFrame + 1 >= 10, i.e., stateFrame >= 9. On frame 11, stateFrame is 9 (entered frame 2 at sF=0, after 9 increments stateFrame is 9). Check: 9+1=10 >= 10, fires. durationElapsed → Run.

So Dash lasts from frame 2 through frame 11, inclusive — 10 frames. On frame 12, the fighter is in Run.

**Slam right, then immediately slam left (dash dance):**

> *Frame 0: Idle, stickX = 0.*
> *Frame 1: player presses Right. stickX = +1.*
> *Frame 2: Idle → Dash, facing = +1.*
> *Frame 3: player releases. stickX = 0.*
> *Frame 4: player presses Left. stickX = -1.*
> *Frame 5: stateSystem in Dash. stickReverseFromFacing: stickX = -1, facing = +1, signs opposite, fires. Dash → DashBack, with commitFacingFromSlam (facing = -1). stateFrame = 0.*
> *Frame 5 physics: dash mode. vx = -1 × 2.8 = -2.8.*

Dash-back. The player effectively "dash-danced" by slamming right then left. The fighter's vx flipped from +2.8 to -2.8 within a frame. This is exactly the feel of Melee's dash dance — sharp, committed reversal.

A player who keeps oscillating left-right gets Dash → DashBack → Dash → DashBack repeatedly, with vx flipping signs each time. Each transition is 5 frames or fewer apart (the stickSlammed/stickReverseFromFacing windows). The fighter visibly shimmies back and forth.

**Dash off the edge:**

> *Fighter at x = 770, y = 400 (on the main floor near the right edge), in Dash, facing = +1, vx = +2.8.*
> *Frame N: physics: vx = +2.8. Integrate: x = 772.8.*
> *Frame N+1: physics: vx = +2.8. Integrate: x = 775.6.*
> *Frame N+2: physics: x = 778.4.*
> *Frame N+3: physics: x = 781.2.*

Wait — the main floor's right edge is at x = 780. On frame N+3, x = 781.2, which is past the edge. The fighter has walked off.

Continuing:

> *Frame N+3 collision: no platform hit (still at y = 400, not crossing anything). Walk-off check: fighter.y = 400, x = 781.2, not in any platform's x range. Grounded → false.*
> *Frame N+4 stateSystem: in Dash. notGrounded fires (priority 1). Dash → Fall.*
> *Frame N+4 physics: state = Fall, horizontalMode = 'air'. addHorizontalVelocity is called with stickX (let's say still +1 if held, 0 if released).*

This is where the asymmetric cap matters. vx is 2.8. The cap is 2.0. If stickX = +1, addHorizontalVelocity tries to accelerate further outward, but the rule is "no-op past the cap in the same direction." So vx stays at 2.8.

If the player releases the stick, addHorizontalVelocity gets called with accel = 0. Nothing changes; vx stays at 2.8.

If the player pulls the stick *left*, accel = -0.1. The rule allows opposite-direction acceleration even past the cap. vx decreases each frame. The fighter air-decelerates, eventually arriving at vx between -2 and +2 and then capping normally.

The result: the fighter dashes off the edge with full dash speed preserved into the fall, and retains the ability to air-decelerate if the player wants. **Dash-off-edge feels right because the asymmetric cap was deliberately designed for it.**

### What's load-bearing about Phase 7

Several patterns that this phase establishes become part of the engine's architectural vocabulary.

**Slam detection on the stick.** The `stickSlammed` condition's "look for a rising edge within N frames" pattern shows up again later — Phase 8's `fastFallTriggered` uses a similar pattern on stickY. Once you have one rising-edge detector, the substrate has them; new conditions just declare which axis and which window.

**The `'dash'` horizontalMode pattern.** The fact that a horizontal mode can read fighter.facing rather than the current stick is what enables committed motion. Future states that need "the fighter is moving in a committed direction" — slides, certain attacks — can use the same mode without invention.

**Commitment-via-effect.** `commitFacingFromSlam` is the first effect that reads a transient input value at the moment of transition and freezes it into a fighter field. This is a pattern: the *transition* is when you take a snapshot of the current input; the *state* then reads from the frozen value. Future effects can follow the same shape — read a button, freeze a target, lock a property.

**Asymmetric physics behavior.** The rule that `addHorizontalVelocity` cap works one way but not the other is the project's first piece of "feel" physics — a non-symmetric rule that exists because the feel demanded it. Future tunings (knockback formulas, hitstun decay) will probably need similar asymmetries. The pattern is: bake the asymmetry into the primitive, with a comment explaining why.

**Mirror-paired states.** Dash/DashBack as separate states for clarity, even when functionally identical. Sets the precedent that "we'd rather have an extra state than overload one with conditional behavior." Phase 6's Idle/Squat is a softer version of this; Phase 7's Dash/DashBack is the explicit one.

---

That's Phase 7. The fighter can now perform the entire dash family: burst, run, reverse, brake. Dash-dancing, dash-out-of-landing, dash-off-edge-into-aerial-momentum, and several smaller behaviors all emerge from the state graph without anyone writing them as features.
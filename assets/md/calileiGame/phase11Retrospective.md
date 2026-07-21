## Phase 11: Air-Dodge

This phase adds one airborne action: shield-pressed-while-in-the-air enters a brief committed-trajectory state. After 20 frames the state ends and the fighter returns to Fall.

That single addition unlocked a substantial chunk of platform-fighter movement vocabulary — wavedashing, wavelanding to the ground, wavelanding onto platforms — without any of those techniques being named in code. It also produced one genuine surprise during testing: the substrate worked correctly on the first frame-trace but felt wrong on the first play session, and chasing the discrepancy turned out to be the most architecturally interesting part of the phase.

The phase also formally introduced the first state-level opt-out flag with an actual consumer (`respectPlatforms`, set on AirDodge to handle the surprise), wired up a placeholder i-frame flag (`intangible`, with no consumer yet), and renamed `resetAirJumps` to `resetAirActions` so the composite reset could include the new dodge counter.

Let me walk it.

---

### AirDodge as a state

The new state is small. Five physics fields, two transitions, one render color, one duration constant.

```
AirDodge:
  duration: 20
  physics:
    gravity: 0
    friction: 0
    horizontalMode: 'none'
    intangible: true
    respectPlatforms: true
  transitions:
    grounded → Land (effect: resetAirActions)
    durationElapsed → Fall
  render: color #5577cc
```

Every one of those five physics fields pulls weight. `gravity: 0` and `friction: 0` together with `horizontalMode: 'none'` produce locked-trajectory motion — the velocity set by the entry effect persists for the whole duration with nothing modifying it. `intangible` is the placeholder for future hit-detection; no system reads it today. `respectPlatforms` was the original speculative example of the state-level opt-out pattern from the dataModel doc, and Phase 11 turned out to be where it became real — see §7.

The `'none'` horizontalMode is the interesting reuse. JumpSquat already uses `'none' + friction: 0` to preserve walk speed across the 3-frame jump windup. AirDodge uses the same combination to preserve the dodge velocity across the dodge's 20 frames. The pattern composes: "physics doesn't drive horizontal motion this frame; the entry effect set it" is a substrate, not a per-state behavior. No new mode needed.

The 20-frame duration is the most consequential feel knob in the phase. Shorter and the dodge feels twitchy and forgiving; longer and the dodge becomes hard to commit to. 20 frames (one-third of a second) gives a meaningful commitment window without being so long that the recovery feels punishing. Maximum horizontal travel during the dodge is `airDodgeSpeed × duration` — for fighterA's `airDodgeSpeed: 5.0` × 20 frames, that's 100 pixels — meaningful but not stage-spanning.

---

### applyAirDodge and the length2D helper

The entry effect is the most numerically involved piece of the phase. It captures the stick direction at the moment of transition, normalizes the 2D vector, scales by airDodgeSpeed, and writes vx and vy.

```
applyAirDodge:
  read stickX, stickY from current snapshot
  if both zero:
    set vx=0, vy=0    (neutral dodge — useful for in-place i-frames)
  else:
    length = sqrt(stickX² + stickY²)
    vx = (stickX / length) × airDodgeSpeed
    vy = (stickY / length) × airDodgeSpeed
  airDodgesUsed += 1
```

The normalization is what makes cardinals and diagonals feel the same. Without it, diagonal dodges would be 41% faster than cardinal dodges (sqrt(2) × speed vs 1 × speed), and players would learn to always dodge diagonally because it's strictly better. The normalization removes that bias — every dodge direction reaches the same total magnitude.

The sqrt is the one piece of math we didn't already have in `fixedMath.js`. Adding it raised a small question: expose `sqrt` directly, or expose `length2D(x, y)` as the meaningful operation? We chose `length2D`. It's the operation physics math actually wants, and the future-port story (when fixedMath becomes integer Newton's method or LUT-based) has one swap site instead of N call sites scattered across the engine.

The neutral branch — both stickX and stickY zero — is a deliberate choice and an important one. It produces an in-place dodge that just freezes the fighter for 20 frames. Combat hasn't arrived yet; today this looks like a hover. When hit-detection lands and the `intangible` flag becomes consequential, the neutral dodge becomes "use i-frames without moving" — a tactical defensive option. The branch costs one if-statement and provides that option for free.

This effect is the 2D analog of `commitFacingFromSlam`. Both capture an input at the moment of state entry and freeze it into fighter fields the receiving state will read. commitFacing writes one sign to one int (facing); applyAirDodge writes two normalized components to two floats (vx, vy). The pattern generalizes: any time a state's behavior should be parameterized by input captured at the transition moment, the entry effect is the right place to do the capture.

---

### canAirDodge

Same shape as canAirJump. Rising-edge detection on the shield button within a window, gated by a counter check.

```
canAirDodge:
  if shield wasn't pressed within last 3 frames: return false
  if airDodgesUsed >= maxAirDodges: return false
  return true
```

The 3-frame window mirrors canAirJump's 3-frame window, and for the same reason: when a future ground-shield state arrives, pressing shield while grounded shouldn't carry into Fall and auto-promote into an air-dodge on the first airborne frame. Today there's no ground-shield to bleed into the buffer, but the window is set conservatively now so that when ground-shield lands the bug is preempted instead of discovered.

The maximum counter (`maxAirDodges`) lives on the character config, not the engine. fighterA gets `maxAirDodges: 1` — Melee-style, one dodge per stay-in-the-air. A future character with more aerial mobility could have 2 or 3; a future character without dodge access could have 0. The substrate doesn't change.

---

### Renaming resetAirJumps to resetAirActions

Adding `airDodgesUsed` meant the landing transition needed to reset both counters. The state machine supports one named effect per transition, which left three options:

**A.** Extend the interpreter to accept arrays of effects per transition.
**B.** Wire up the documented-but-inert `onEnter` hook so Land could declare a single per-state entry effect.
**C.** Make the existing reset effect composite — rename `resetAirJumps` to `resetAirActions` and have it reset both counters.

We chose C. Phase 11 is air-dodge, not state-machine extension. Options A and B are real architectural improvements that would compose cleanly with other future needs — combat's hit reactions in particular will probably want multiple effects per transition (apply knockback + apply hitstun + spawn particles + screenshake). When that need actually arrives, the case for Option A is multiplied by every hit-reaction transition. Doing it then makes more sense than doing it now to support exactly one composite that's already trivial.

The rename touched three transitions in `states.js` (all the `→ Land` exits from airborne states) and one entry in `stateMachine.md`'s effects catalog. The composite's body is two lines: zero `airJumpsUsed`, zero `airDodgesUsed`. The granularity loss is acceptable today because every landing wants to reset everything. If a future state ever needs to reset just one of the two counters, the answer is Option A — and at that point Option A is doubly justified.

A note for anyone reading the older phase docs: references to `resetAirJumps` from Phases 6–10 were correct at the time the function existed under that name. Phase 11's rename made the effect's name match its broadened responsibility.

---

### intangible as the i-frame placeholder

The `intangible: true` flag sits on AirDodge's physics modifier and is read by exactly nothing in Phase 11. Combat hasn't arrived. The flag exists in the data shape as the contract for future hit-detection.

This was deliberate. The architecture for i-frames doesn't need to be elaborate today; it needs to be ready. One boolean on the state, declared via the same opt-out pattern that `respectPlatforms` already established, is sufficient. When hit-detection arrives, that system consults `state.physics.intangible === true` at the point of would-be-hit, with the consumer-owns-the-default discipline. If frame-bounded intangibility is needed later (Melee's air-dodge has i-frames on frames 4–19 of a 29-frame dodge, not the full duration), the shape can expand to `intangible: { start: X, end: Y }` — a forward-compatible expansion of the same field.

This was the second documented instance of the state-level opt-out pattern from dataModel.md §9. At the time of Phase 11's design, both instances (`respectPlatforms` and `intangible`) were speculative — no state actually set either flag. By the end of Phase 11, both were set on the same state. The pattern had real users where it had been speculation about future ones.

---

### Wavedashing emerges

This was predicted. The composition is worth tracing.

The trace below uses fighterA's values for concreteness. The substrate produces wavedashing for any character whose values satisfy the dependencies — `airDodgeSpeed > 0`, `friction > 0`, Land and Idle's `horizontalMode: 'none'` with non-zero friction multipliers, and the perpendicular-only snap rule (which is engine-level, not per-character). A different fighter with different values will produce a wavedash with a different slide distance; the substrate is identical.

Jump from the main floor: JumpSquat → Fall, `vy = -jumpForce` (upward). At or near the apex, press shield + hold down-right. `canAirDodge` fires. `applyAirDodge` reads stickX=+1, stickY=+1, length2D = sqrt(2), normalized = (1/sqrt(2), 1/sqrt(2)), velocity = (airDodgeSpeed / sqrt(2), airDodgeSpeed / sqrt(2)). For fighterA, that's (3.54, 3.54). AirDodge begins.

For the next several frames, gravity:0 + friction:0 + horizontalMode:'none' means nothing modifies vx or vy. The fighter travels on a perfect 45° down-right line at airDodgeSpeed px/frame total speed. After some frames (depending on jump height and dodge angle), the fighter reaches the floor.

Collision sweep detects floor contact. Side priority is 'top'. The fighter snaps to floor y, vy is zeroed, grounded becomes true. The perpendicular-only snap rule from Phase 8 means **vx is preserved** — for fighterA, it's still 3.54. State transitions AirDodge → Land via `grounded → Land`, with resetAirActions firing.

Land begins with the preserved vx. Land's friction multiplier is 1.0 against the character's `friction`, so `friction` px/frame² of deceleration applies. Over Land's 4-frame duration, vx drops by `4 × friction`. At durationElapsed, Land → Idle. Idle has the same friction characteristics. The fighter continues sliding through Idle until vx reaches 0, taking `(remaining vx) / friction` more frames.

Total slide distance is determined by the integration of friction-decelerated velocity from `airDodgeSpeed / sqrt(2)` to zero — algebraically, that's `(airDodgeSpeed / sqrt(2))² / (2 × friction)`. **For fighterA's values (`airDodgeSpeed: 5.0`, `friction: 0.1`), this gives ~62 pixels of slide; about 13 of those happen during Land itself, the rest in Idle.** Stage main floor is 600 pixels wide, so a wavedash crosses about 1/10 of the stage on fighterA.

The slide-distance formula is the substrate-level statement; the 62 px is its instantiation for fighterA. Tuning `airDodgeSpeed` up scales the distance quadratically; tuning `friction` up scales it down linearly. Future characters with different values will have different wavedashes, and the formula tells you what to expect before you test.

Four independent primitives composed to produce this:
- Perpendicular-only snap rule (Phase 8): only y snaps on landing, vx is untouched
- Land's `horizontalMode: 'none' + friction: 1.0`: friction applies, but gradually
- Idle's same horizontalMode and friction: friction continues bleeding off vx
- AirDodge's `gravity:0 + friction:0 + horizontalMode:'none'`: locked trajectory until landing

All four were in place by the end of Phase 11. None of them mention "wavedash." The technique is what happens when they compose.

---

### Wavelanding onto platforms didn't work — and why

This was the surprise.

The first play session after Phase 11 shipped immediately uncovered a gap. Wavedashing on the main floor worked exactly as traced. Wavelanding to the floor from any prior aerial state worked. Wavelanding **onto a platform** did not work — the fighter passed through the platform every time and continued falling.

The diagnosis was straightforward once stated: the air-dodge direction shares an input with drop-through. Specifically, three different systems all consume `stickY > 0`:

- Drop-through wants stickY > 0 to skip platform collision
- Fast-fall wants stickY > 0 to commit to faster descent
- Air-dodge direction wants stickY > 0 to dodge with a downward component

Phase 9 untangled the first two using buffer history (the fresh/commit fast-fall paths). The third consumer can't be untangled the same way, because the player's intent during a diagonal-down dodge isn't ambiguous — they want to *go that direction*, and the drop-through behavior happens to be triggered by the same input the dodge needs.

The trace of a broken waveland: fighter dodges diagonally down toward a platform; the stickY > 0 input that produced the dodge angle is still in the buffer; collision system calls `wantsThroughPlatforms(fighter, state)`; the check sees no opt-out and stickY > 0; drop-through is enabled; platform sweep is skipped; fighter passes through.

This shape — drop-through being too eager during a committed motion — is exactly what the `respectPlatforms` opt-out was speculatively designed for. The pattern was documented in Phase 9 and elaborated in dataModel.md §9 with future attack states as the speculative consumer. AirDodge turned out to be the first real consumer, and it's a movement state, not an attack state — which means the pattern's reach is broader than the original speculation suggested.

The fix was one line: add `respectPlatforms: true` to AirDodge's physics modifier. The opt-out fires before the stickY check in `wantsThroughPlatforms`, drop-through is suppressed during the dodge entirely, and the platform sweep runs normally. Wavelanding onto platforms started working.

The trade-off: you can no longer drop through a platform deliberately while air-dodging. That's a niche option — players who want to drop through can just press down without dodging — and the new affordance (wavelanding onto platforms) is fundamental to platform-fighter movement. The trade was the right way around.

---

### The wavelanding window emerges, then gets tuned

This was the second surprise, and the more interesting one.

After `respectPlatforms: true` landed on AirDodge, wavelanding onto platforms worked. But the moment the fighter transitioned from AirDodge to Land, the very next collision check saw a Land state without `respectPlatforms` set and a stickY > 0 input still held in the buffer. The fighter dropped through the platform on the next physics frame.

Effective window to stay on the platform: roughly one frame after landing, plus whatever reaction-time slop the input pipeline absorbs. To waveland onto a platform and stay there, you had to release down at or before the moment your feet touched.

This wasn't designed. It emerged from clean rules being applied per-state: AirDodge respects platforms, Land doesn't, and the transition between them happens on a discrete frame boundary.

The first reaction to it was: this is fascinating. Consistently wavelanding onto a platform required real precision and rewarded practice. The window was tight enough to demand attention and loose enough to be hittable. It was exactly the texture of the technique in competitive Melee — a frame-perfect or near-frame-perfect timing window between a desired outcome (stay on the platform) and a competing outcome (continue dropping through). Players who couldn't master it could still waveland to the floor; players who could gained a movement option that required real practice.

The architecture had produced this for free. Every state declares its own platform-respecting behavior. When two adjacent states disagree (AirDodge respects, Land doesn't), the transition between them creates a one-frame opportunity. There was no "wavelanding window" function. Nobody decided "make this a one-frame timing window." The behavior was what naturally happened when opt-out flags differed between adjacent states.

The decision was whether to leave the one-frame window as-is or extend it. The fix would be symmetric: add `respectPlatforms: true` to Land's physics modifier as well. Land's 4-frame duration plus the transition to Idle (where Squat would intercept stickY > 0) meant the window extended from ~1 frame to ~5 frames, and it became reactive instead of pre-emptive.

The trade-off: the window goes from "frame-perfect commitment based on visual anticipation" to "post-landing reactive choice." Players who never had platform consistency get it. Players who had drilled the one-frame window lose some of the precision-rewards-mastery texture. The Squat flicker (documented in dataModel.md §7 as an accepted oddity) becomes more visible because the Idle → Squat → Fall path is now the normal way to drop through after a waveland.

The competitive-veteran perspective made the call: leave `respectPlatforms: true` on Land. The reasoning was that an inaccessible technique hurts the game broadly more than a precision technique helps the top-end, and the architecture is the same either way — one boolean on one state's physics data, easy to remove later if play patterns suggest the tighter window would be better.

The end result is that wavelanding onto platforms is reactive and forgiving rather than pre-emptive and demanding. The wavedash to the main floor is unchanged. The frame-perfect window from the surprise didn't survive into the shipped phase, but the discovery of it — the proof that the architecture can produce skill-expression windows from state-boundary opt-out differences — is the part worth keeping. Future phases will produce more of these windows, and the calibration of each will be a real design decision.

---

### What changed in the codebase

Seven files. One new state, one new condition, two new effects (one replacing another), one new fighter field, two new character stats, one new fixedMath helper. Two states gained the `respectPlatforms` flag.

- **states.js**: AirDodge state added with five physics modifiers and two transitions. Fall, AirJump, FastFall all gained a `canAirDodge → AirDodge` transition. All landing transitions reference the renamed `resetAirActions` effect. Land gained `respectPlatforms: true` in its physics modifier as the second pass of platform-respect tuning.
- **conditions.js**: `canAirDodge` added. `AIRDODGE_BUFFER_FRAMES = 3` constant declared alongside the existing buffer constants.
- **effects.js**: `applyAirDodge` added (vector-normalization entry effect). `resetAirJumps` renamed to `resetAirActions` and broadened to zero both counters.
- **fighterA.js**: `maxAirDodges: 1` and `airDodgeSpeed: 5.0` added to physics stats.
- **fighter.js**: `airDodgesUsed: 0` added to the factory function.
- **fixedMath.js**: `length2D(x, y)` exported. One-line wrapper around `Math.sqrt(x² + y²)`.
- **stateMachine.md**: §6 updated to mention `canAirDodge` in the compound conditions catalog and `AIRDODGE_BUFFER_FRAMES` in the window-sizing discussion. §7 updated to add `applyAirDodge` to the impulse effects, document the resetAirActions composite and its architectural alternatives, and reference `applyAirDodge` as the 2D analog of `commitFacingFromSlam`.

The state machine interpreter is unchanged. The physics system is unchanged. The collision system is unchanged. The input system is unchanged. Every behavior added in Phase 11 came from new data plus reuse of existing primitives.

---

### Load-bearing decisions

**AirDodge's velocity is set on entry and locked.** The combination of gravity:0, friction:0, horizontalMode:'none' is what produces the straight-line trajectory. Changing any of them changes the technique's feel substantially.

**Vector normalization at the entry effect.** Cardinals and diagonals reach the same magnitude because the stick vector is normalized before scaling by airDodgeSpeed. The 41% diagonal advantage that exists without normalization would have produced a strict-best-direction dodge bias, which would have reduced the technique's expressiveness.

**`canAirDodge`'s 3-frame buffer window.** Set defensively against the future ground-shield bleed. If widened later for any reason, the ground-shield interaction will need to be reexamined.

**`resetAirActions` is composite, not array-of-effects.** The state machine interpreter is unchanged. Future combat may require Option A (array of effects per transition) for hit reactions; that's the right time to do that extension.

**`respectPlatforms: true` on AirDodge.** Enables wavelanding onto platforms by suppressing drop-through during the dodge. First state to actually set this flag.

**`respectPlatforms: true` on Land.** Extends the platform-stay window from ~1 frame (pre-emptive timing) to ~5 frames (reactive choice). Tunable later if play patterns suggest the tighter window would be better. The two `respectPlatforms` settings work as a pair — the first makes wavelanding onto platforms possible, the second makes it consistently achievable.

**AirDodge has no act-cancel transitions.** No mid-dodge canAirJump, canAirDodge, fastFallTriggered, or notGrounded. The commitment is part of the design and what gives the technique tactical weight.

**Air-dodge speed.** The wavedash slide distance is `(airDodgeSpeed / sqrt(2))² / (2 × character.friction)` for a 45° dodge — quadratic in `airDodgeSpeed`, inverse-linear in `friction`. For fighterA's tuning (5.0 and 0.1), this produces a ~62-pixel slide. The most consequential per-character feel knob in Phase 11; future fighters will tune both `airDodgeSpeed` and `friction` together to land in the slide range that fits their archetype.

**`intangible: true` placeholder on AirDodge.** No consumer in Phase 11. Establishes the contract for future hit-detection, with the consumer-owns-the-default discipline from dataModel.md §9.

---

### What's deferred

**Combat itself.** No hit detection, no hurtboxes, no knockback, no damage. The `intangible` flag exists waiting for a consumer.

**Frame-bounded intangibility.** Melee's air-dodge has i-frames on a sub-window of the full dodge (frames 4–19 of 29). Our placeholder is whole-state. The boolean is a forward-compatible entry point if sub-window timing becomes needed.

**Post-dodge restrictions / special fall.** In Melee, the fighter cannot act after an air-dodge until they touch the ground — they're in restricted "special fall." Our AirDodge transitions back to Fall with full availability (subject to counter exhaustion). This is more permissive than Melee. When combat introduces recovery balance concerns, a SpecialFall state with restricted transitions may be needed.

**Multi-effect transitions.** The Option A architectural extension (array of effects per transition) is deferred until combat genuinely needs it. The composite resetAirActions handled Phase 11's case without it.

**Ground shield and ground rolls.** Pressing shield while grounded does nothing in Phase 11. The shield button is reserved for the future combat phase. Air-dodge currently has exclusive consumption of the shield button.

**Wall-dodge interaction.** A fighter who dodges into a wall hits it via standard wall collision (perpendicular snap, vx zeroed) and remains in AirDodge until duration or until they touch the floor. This produces slightly awkward behavior in corners; left as-is for now.

**Debug overlay update.** The overlay shows airJumpsUsed/maxAirJumps per Phase 10. A natural addition is airDodgesUsed/maxAirDodges. Debug-side update, not engine.

**Doc updates from the surprises.** Phase 11 surfaced two emergences that weren't in the original seven docs:
- `emergence.md` §2: wavedashing and wavelanding should move from §5 (techniques requiring new primitives) to §2 (worked emergences in the engine). A new entry for state-boundary skill windows would teach the wavelanding-window pattern.
- `dataModel.md` §9: the "likely range" of opt-outs should note that the pattern's first real users came from movement, not combat, and that opt-out flags being state-specific (with adjacent states disagreeing) produces emergent skill windows worth tracking.
- `collision.md` §7: the discussion of `wantsThroughPlatforms` should be updated — the flag has users now, and AirDodge and Land both demonstrate it.

---

### How Phase 11 set up combat

The two architectural pieces Phase 11 added or matured are exactly the pieces combat will need.

**The state-level opt-out pattern, now exercised by real users.** `respectPlatforms` started Phase 11 as speculation and ended it set on two states for two different reasons (one structural, one tunable). `intangible` was added as a placeholder. The pattern's discipline — explicit boolean comparison, absence-is-default, consuming-system-owns-the-default — is now visible in the data shape of two existing states, ready to multiply when combat adds states with `intangible` as a real consumer, plus future flags for `superArmor`, `canBeShielded`, `canBeGrabbed`, `reflectable`, and so on.

**The 2D input-capture pattern.** `applyAirDodge` extended `commitFacingFromSlam` from 1D (sign of one component) to 2D (normalized vector of two components). The pattern — capture-on-entry, lock-during-state, free-the-input-after — is what attack states will use to capture stick direction at the moment of attack input. Forward-air, back-air, up-air, down-air all parameterize on stick-Y direction at the attack moment in Melee; the substrate for that capture is now in place.

Combat is the next major phase. The pieces Phase 11 added are ready for it.

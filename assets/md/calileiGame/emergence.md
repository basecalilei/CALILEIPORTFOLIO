# emergence.md

This is the doc you read before adding a technique to the engine, and the doc you stop on when you catch yourself writing a feature where a primitive should be. The other deep-dives teach the systems; this one teaches how the systems compose — and more importantly, how to think about composing them.

The project's defining discipline is: **build the substrate, not the feature.** When a behavior is wanted, the question is never "how do I implement this behavior." It is "what primitive rules would compose to produce this behavior, and do those rules already exist." If they do, the behavior is data. If they don't, the primitives need generalizing. Either way, the answer is rarely "write a function that does the thing."

This rule is the source of every other architectural decision: data over code, decoupling, one-World-one-tick, conditions and effects as registries, snapshot contracts that claim slots up front. They are all servants of one master goal — keeping the engine general enough that the next interesting behavior falls out without being designed.

---

## 1. The substrate-vs-feature distinction

A **feature** is a behavior that exists because code says it exists. There is a function named after the behavior. The function checks if the behavior should happen and makes it happen. Adding the behavior was a decision; removing it would be a deletion.

A **substrate** is a set of primitive rules that, when composed, produce behaviors. The primitives know nothing about which behaviors they enable. The behaviors arise from how the primitives interact. Adding a new behavior is rarely a code change — it's a discovery that the existing rules already produce it, or a small generalization of one rule that produces a family of new behaviors.

In Melee, *wavedashing* is the canonical emergence. Nobody wrote a `wavedash()` function. The developers wrote air dodges, ground collision, and momentum preservation. Wavedashing is what falls out when those three compose: air-dodge into the ground at a shallow angle, the landing state cancels the air-dodge animation, the horizontal momentum survives the state transition, the fighter slides along the ground. Not designed. Discovered.

Compare *Final Smashes* in later Smash games. A Final Smash is a feature. There is logic that checks whether the Smash Ball was broken, whether the player has it, what the character's specific Final Smash animation is, what damage it does, what cinematic plays. The behavior exists because code says it exists. Removing it would be a deletion.

Both are valid design choices. Different games make different ones. This project's bet is on the first kind. The cost is that adding a specific designed behavior is harder; the payoff is that adding a *substrate* lets a hundred behaviors fall out at once.

The test of a primitive's quality is **how many techniques it enables that you didn't intend**. If adding a new state or condition makes three new techniques possible without further work, the addition is good. If it only makes the one thing you wanted possible, it's probably too narrow.

---

## 2. Emergences already in the engine

The engine ships with a small set of designed primitives and a larger set of behaviors that fall out of them. Walking through these is the fastest way to internalize the discipline.

Worked traces below use fighterA's values for concreteness — `walkSpeed: 1.6`, `dashSpeed: 2.8`, `airSpeedMax: 2.0`, `jumpForce: 8.0`, and so on. The substrate is identical under any tuning. Where an emergence depends on a *relationship* between values (e.g., `dashSpeed > airSpeedMax` for dash-off-edge), the relationship is the architectural condition, called out explicitly. A future fighter that doesn't satisfy that condition won't produce the emergence; the substrate doesn't care, and the absence is not a bug.

### 2.1 Walk-off-edge preserves walking velocity into Fall

Walk right. Walk off a platform.

What happens in the code: collision's walk-off detection clears `grounded`. Next tick's state machine sees `notGrounded` (the first transition in every grounded state) and fires Walk → Fall. The transition has no effect; no code zeroes vx. Physics on the next tick applies air mode, which uses `addHorizontalVelocity` with the character's `airSpeedMax` as the cap. For fighterA, `walkSpeed (1.6) < airSpeedMax (2.0)`, so vx is within the cap. The fighter falls forward, drifting at walking speed.

What didn't have to be written: nothing that says "carry walking velocity into the fall." The velocity was already in the fighter; the new state didn't ask for a reset; physics integrated it. The emergence is *the absence of code* that would have prevented it.

The architectural condition is implicit but real: `walkSpeed <= airSpeedMax` for the walk-off to drift without first triggering the asymmetric cap. fighterA satisfies this comfortably. A fighter with `walkSpeed > airSpeedMax` would walk off into a different emergence — see §2.2.

### 2.2 Dash-off-edge preserves dash velocity above the air cap

Dash right. Walk off a platform.

What happens: same path as §2.1 up to entering Fall. Physics applies air mode. But now `addHorizontalVelocity` sees an `oldVx` greater than `airSpeedMax`. The asymmetric cap rule kicks in: same-direction acceleration is a no-op, opposite-direction acceleration applies normally. The dash speed is preserved through the air.

For fighterA, `dashSpeed (2.8) > airSpeedMax (2.0)` makes this dramatic — the fighter sails forward at 2.8 px/frame for as long as no opposing input bleeds them down. **This emergence depends entirely on `dashSpeed > airSpeedMax`.** A character with `dashSpeed <= airSpeedMax` doesn't produce it; their dash is already at or below their max air-drift, so the cap doesn't fire and there's nothing to preserve. That character's dash feels less like a momentum commitment and more like just-another-aerial-speed. Either design is valid; the substrate handles both.

What didn't have to be written: nothing that says "preserve dash speed past the air cap." The preservation is a *property of the cap rule*. The cap was designed to limit new outward acceleration, not to define a maximum vx. Dash-off-edge falls out as one consequence; future knockback that puts vx over the cap will be preserved by the same rule, regardless of character.

### 2.3 Jump-cancel-walking

Walk right. Press jump.

What happens: jumpPressed fires, Walk → JumpSquat. JumpSquat has `horizontalMode: 'none'` and `friction: 0`. The 'none' mode applies friction; multiplied by zero, friction does nothing. vx is preserved through all 3 frames of JumpSquat. JumpSquat → Fall with `applyJumpImpulse` sets `vy = -jumpForce`. Fall is `horizontalMode: 'air'`. The fighter's walk-speed vx is now in air mode — within the cap for fighterA (1.6 < 2.0), preserved as air-drift.

What didn't have to be written: any code that says "preserve walking momentum into a jump." JumpSquat could trivially zero vx with a transition effect, or apply normal friction. It doesn't. The `friction: 0` multiplier is the entire mechanism, and it's a one-line entry in state data.

This emergence is interesting because it's *fragile by design*. If someone "fixes" JumpSquat by setting `friction: 1.0` to match other grounded "stopping" states, jump-cancel-walking dies. The discipline is to recognize that the zero is load-bearing, not a typo.

### 2.4 Edge-cancel landing

Drop onto a platform with horizontal momentum, landing within friction-reach of the edge.

What happens: collision lands the fighter on the platform; perpendicular-only snap rule preserves vx (only y snaps). Grounded becomes true; state fires `grounded → Land`. Next tick: Land's `horizontalMode: 'none'` applies friction (multiplier 1.0 against the character's `friction`). vx decreases by `character.friction` per frame; position integrates by the new vx. If after integration the fighter is past the platform's x-range, collision's walk-off check clears grounded. Land's first transition is `notGrounded → Fall`. The fighter falls off, carrying the remaining vx. For fighterA, `friction = 0.1`, so vx bleeds slowly enough that a fighter landing near the edge with non-trivial horizontal speed often walks off; a heavier-friction character would stop more often within Land.

What didn't have to be written: edge-canceling. The behavior is a consequence of (a) perpendicular-only snap preserving vx, (b) Land using a friction mode rather than a velocity-zeroing transition, (c) walk-off running every frame, (d) `notGrounded` being the first transition in Land. Four independent primitives compose to produce a Melee-style technique.

### 2.5 Dash-dancing

Tap right (slam). Release. Tap left (slam). Release. Tap right. Repeat.

What happens: first tap fires `stickSlammed → Dash` (with `commitFacingFromSlam` setting facing=+1). Dash physics commits vx = +dashSpeed every frame. Within Dash's 10-frame duration, second tap fires `stickReverseFromFacing → DashBack` (with `commitFacingFromSlam` setting facing=-1). DashBack physics commits vx = -dashSpeed. Within DashBack's 10-frame duration, third tap fires the same reverse-condition (DashBack has `stickReverseFromFacing → Dash`). And so on.

What didn't have to be written: any code that tracks dash-dancing as a multi-input sequence. Each individual transition is checked independently against the fighter's current state and input. The "dance" emerges from chaining them. The fighter rapidly pumps left-right; the engine sees a sequence of single-frame transitions.

This one is particularly clean because the priority-ordered transition design makes the cancellation work: `stickReverseFromFacing` is high in Dash's transition list, so it fires immediately on the next press regardless of how many frames into Dash you are.

### 2.6 Drop-through-from-fall and drop-through-from-standing

Hold down while falling toward a platform. Pass through it.

Hold down while standing on a platform. Fall off.

Both behaviors come from the same predicate (`wantsThroughPlatforms` in `collisionSystem.js`) applied at two sites. See `collision.md` §7 for the worked details. The relevant emergence point: there's one rule ("don't treat platforms as surfaces when the player wants through"), applied to both the sweep and the walk-off check. Two distinct player-visible behaviors fall out without separate code paths for "drop-through from above" and "drop-through from standing."

### 2.7 Aerial reversal via opposite-direction air-drift

Dash right off the edge. While airborne (with vx above the cap from the dash-off-edge emergence), press left.

What happens: air mode's `addHorizontalVelocity` sees `oldVx` above the cap, `accel` in the opposite sign. The third branch of the asymmetric rule applies normally — opposite-direction acceleration always works regardless of current speed. vx decreases by `airAccel` each frame. Hold left long enough and vx eventually crosses zero, then accumulates in the negative direction up to the cap. For fighterA, that's `2.8` decreasing by `0.1` per frame, reaching zero in 28 frames and the opposite cap in another 20.

What didn't have to be written: any code that says "let the player reverse direction in the air after a dash-off." It's the third branch of the cap rule. The same branch lets a future hit-launched fighter influence their trajectory with directional inputs (the equivalent of Melee's DI), without any DI-specific code, and regardless of which character is being launched.

### 2.8 Buffered input

Press jump during the 4-frame Land animation. Press jump one frame before touchdown. Press a direction during JumpSquat's 3-frame windup. The press lives in the buffer until a state with a matching transition condition picks it up.

What happens: the input system pushes the snapshot into the buffer regardless of what the fighter is doing. The current state doesn't have a transition that matches the press, so it doesn't fire. Each frame, the press shifts to a higher buffer index. When the fighter eventually reaches a state whose transition list does match (and whose window is still open), the press fires the transition.

A worked example. The player presses Space on Land's first frame. Land's transitions don't include `jumpPressed`. The press sits at buffer index 0, then 1, then 2, then 3. After 4 frames, Land's `durationElapsed → Idle` fires. Idle's first transition check evaluates `jumpPressed`, which uses `wasPressedWithin(buffer, 'jump', 5)`. The press is at index 4 — within the 5-frame window. `jumpPressed` returns true. Idle → JumpSquat fires. The player jumped out of landing lag.

The same pattern produces a family of behaviors: press jump just before touchdown, fire jump after Fall → Land → Idle (~5 frames buffered); press jump during JumpSquat, fire as air jump in Fall via `canAirJump` (the shorter 3-frame window means this only works close to JumpSquat's end); press a stick direction during JumpSquat, fire as Dash from Land via `stickSlammed → Dash`. None of these are coded; all of them emerge from the press living in the buffer and transitions consuming it when the relevant state arrives.

What didn't have to be written: any "input buffering" code. There is no function named after the behavior. The buffer pushes every snapshot because that's its job. Rising-edge conditions walk pairs of adjacent buffer entries because that's how they answer their question. The two systems don't know about each other; the emergence is in their composition.

The general rule: **a press is buffered for exactly the number of frames between the snapshot and the next state that has a matching transition condition with an open window. If no such state arrives within the window, the press expires unused.**

The hard ceiling on buffer depth is the longest window of any active condition. Currently that's `jumpPressed` and `stickSlammed` at 5 frames; `canAirJump` at 3; `fastFallTriggered`'s fresh window at 3 with a 6-frame commit path. The buffer holds 12 entries; no current condition scans all of them. The window sizes are the real ceiling, not the buffer size.

This is the substrate's answer to "responsive input feel without frame-perfect timing." The player presses at any moment; the engine fires the input when a state that listens for it arrives, as long as that's within the relevant window.

### 2.9 Physics-gated fast-fall

Press down at any point during a jump. The fast-fall doesn't fire until the fighter has stopped strongly ascending — currently when `vy >= -5`, a few frames before apex.

What happens: the `fastFallTriggered` condition gates on physical state. The player can hold down throughout the ascent; the condition's `f.vy < -5 → return false` clause suppresses the trigger while the fighter is still moving upward fast. Once `vy` crosses the threshold, the condition's remaining clauses are evaluated — stick still held, fresh-press window or sustained-hold window — and the transition fires when they match.

What didn't have to be written: any code that says "remember the down-press during the jump and fire it at the right moment." The condition just asks two questions every frame — "is the player still pressing down" and "is the physics ready" — and fires when both answer yes.

This is the complementary emergence to buffered input (§2.8). Buffered input is **the press waits for the right state**. Physics-gated fast-fall is **the condition waits for the right physics**. Together they form the substrate's answer to "input responsiveness without timing demands." In both cases, the player presses at any moment; in both cases, the engine fires the relevant transition when the precondition is met. Neither needs a special-case timing mechanism.

A note on the threshold. `vy >= -5` rather than `vy >= 0` is an in-progress feel choice. Allowing fast-fall to fire while still slightly ascending lets the player cancel a portion of their jump by tapping down before apex, which makes movement feel faster. When fast-fall becomes available during a jump has a major effect on movement feel in a platform fighter — at `-5` a meaningful chunk of the ascent is cancellable, at `0` only the apex itself is. The exact threshold may be tuned later for balance or feel. The principle stands regardless of where the value settles: the substrate is "a condition that gates on physics readiness," and the specific numeric threshold is a tuning choice.

### 2.10 Wavedashing and wavelanding (Phase 11)

Jump, air-dodge diagonally down-toward the ground, land. The fighter slides along the floor at speed, fully actionable a few frames later. Waveland: the same input onto a platform instead of the floor.

What happens: `applyAirDodge` captures the stick at dodge entry, normalizes the vector, and writes a locked velocity (`gravity: 0`, `friction: 0`, `horizontalMode: 'none'` keep it locked). A down-diagonal dodge drives the fighter into the ground within a few frames. Collision's perpendicular-only snap fires a landing — y snaps, **vx survives**. `grounded → Land`; Land's `friction: 1.0` mode starts bleeding the large horizontal component. The visible result is the slide, its length set by `airDodgeSpeed`, entry angle, and the character's `friction`. For platforms, AirDodge's `respectPlatforms: true` is the enabling detail — without it, the dodge's downward component would count as "wants through" and the fighter would clip through the platform instead of wavelanding onto it.

What didn't have to be written: `wavedash()`. This is the engine's own version of the Melee story from §1, and it played out exactly as §3's worked diagnostic predicted before the phase was built: one missing primitive (the air-dodge state), everything else already in place. The phase shipped the state; the techniques were discovered in the first play session, sliding exactly as the substrate said they would.

### 2.11 Attack momentum for free (Phase 12)

Three behaviors arrived with the ten attack states, none of them coded:

**The DashAttack slide.** DashAttack is `horizontalMode: 'none'` with friction — no motion code of its own. Entered from Dash/Run, the fighter carries dash speed in, and friction bleeds it across the attack's duration. The signature "sliding attack" is momentum preservation plus a friction mode, same mechanism as edge-cancel landing (§2.4).

**Rising and falling aerials.** Aerials are `horizontalMode: 'air'` with `fallSpeedMax: 9`. Press an attack out of a jump's ascent and it rises with you; press it during a fast-fall and the fast-fall speed persists through it (the 9-cap, matching FastFall's, is the one number doing that work). Air drift keeps steering mid-attack. Rising back-air, falling forward-air, drift-away spacing — all combinations of existing physics with a state that simply doesn't fight them.

**Edge-cancelled aerials.** Land an aerial on a platform edge with momentum and slide off before the landing resolves — §2.4's machinery, inherited by ten new states for free because they use the same transitions and the same collision rules.

### 2.12 Combos without combo code (Phase 13)

Hit the dummy, jump after them, hit them again before hitstun ends. The second hit connects, re-launches, and the flight extends as damage climbs.

What happens: Hitstun's own first transition is `hitTaken → Hitstun` — a self-transition. A hit landing mid-hitstun re-fires `applyHitReaction` (fresh knockback computed against the now-higher damage), and the interpreter's ordinary transition mechanics reset `stateFrame`, restarting the timer. The launch is just velocity (§2.2's cap rule preserves it; gravity arcs it), damage feeds the next launch's magnitude, and hitstun scales with the hit. Attack → damage → stronger knockback → longer flight: a feedback loop assembled entirely from a formula, a self-transition, and physics that treats launches like any other motion.

What didn't have to be written: a combo counter, a juggle system, hit-priority code. The word "combo" appears nowhere in the engine.

---

## 3. The diagnostic question

When asked to implement a Melee-style technique, **ask first whether the primitives that would produce it already exist.** If they do, the technique is data, or it already works and just needs verification. If they don't, the next question is what primitive is missing and whether generalizing an existing one would produce it.

The diagnostic question, in three parts:

1. **What player-visible behavior is wanted?** State it as concretely as possible. Not "I want wavedashing." "I want the player to be able to slide along the ground at high speed by air-dodging into it at a shallow angle, with the air-dodge animation cancelled by the landing."

2. **What primitive rules would produce that behavior?** List them. For the wavedash example: an air-dodge state that locks momentum at a stick-determined angle, ground collision that fires a landing on contact, the perpendicular-only snap rule that preserves horizontal velocity through a landing, the existing Land state that has friction:1.0 to decelerate the resulting slide.

3. **Which of those primitives already exist?** When this example was first written, the answer was: ground collision exists, the perpendicular-only snap rule exists, the Land state exists, the air-dodge state does *not*. Phase 11 built exactly that one missing primitive, and the prediction resolved as forecast — wavedashing and wavelanding emerged in the first play session with zero technique-specific code (§2.10). The example stays here in its original form because the *method* is the point: three questions, one missing primitive identified, one well-bounded addition, a family of techniques out the other side.

The answer to question 3 tells you what to do. If everything exists, the technique is already possible — verify it in the overlay and you're done. If one primitive is missing, that's the work; generalize an existing primitive or add a new one in a way that produces the behavior plus a family of others.

What the diagnostic question prevents: writing `function wavedash() { ... }`. That function would have to know what an air dodge is, what a landing is, what a slide is. It would be a feature, not a primitive. Even if it works, it doesn't enable anything else, and removing it would be a deletion.

### The honest version

The diagnostic question has a sharper form for moments when you catch yourself reaching for a feature: **if I had to delete this code six months from now, what else would have to be deleted with it?**

A well-bounded primitive can be deleted because some better generalization replaced it; nothing else has to change. A feature dragged into the engine takes its consumers with it — every state that references it, every condition that gates on it, every effect that depends on it. The cost of features is hidden until you try to remove them.

---

## 4. Techniques close to emergence

These are behaviors that the current primitives almost produce. Each requires a small, well-bounded addition — not a feature.

### 4.1 Walking-into-jump-into-walking landing (no extra work)

Already works. Walk, jump (vx preserved through JumpSquat by friction:0), drift in air (vx preserved by air mode below cap), land (perpendicular-only snap preserves vx), continue walking (Land's friction is small enough that one tick doesn't kill the velocity; the player can re-engage walk input to override). Verify in the overlay: walk speed should persist across the entire trajectory.

### 4.2 Edge-cancel from any aerial state landing on a platform corner (already works)

§2.4 above is one form. Edge-canceling from a dash-off-edge fall onto a small platform: the fighter has high vx in Fall, lands on the platform corner with vx preserved, slides off the far edge within Land's friction-reach, falls again. Verify: drop onto the very edge of a soft platform with horizontal momentum; the fighter should appear to "skim" the platform and fall off the far side.

### 4.3 Air-jump-cancel of fast-fall (already works)

Fall, fast-fall, air-jump out. The current FastFall transitions include `canAirJump → AirJump`. The `applyAirJumpImpulse` effect overwrites vy with `-airJumpForce`, replacing the fast-fall speed with an upward burst. Verify: fast-fall, then press jump while still descending. The fighter should immediately rise.

### 4.4 Wavelanding-style ground slide on landing (shipped — see §2.10)

This entry predicted that once an air-dodge state existed, wavelanding would emerge "from the same machinery as wavedashing... a property of the existing machinery, not a separate feature." Phase 11 shipped the state; the prediction held to the letter, including the state shape this entry sketched (stick-captured locked velocity, `gravity: 0`, `friction: 0`, fixed duration, Land on grounded). Kept here as the record of a close-to-emergence call that paid out; the worked trace now lives in §2.10.

### 4.5 L-cancelling (one primitive remaining)

When this was written it needed attack states; Phase 12 shipped them, and aerials already carry the `grounded → Land` transition that edge-cancelling exercises. What remains is exactly the sketch below — a buffered-shield condition and a short-land variant — now scheduled as Phase 14a scope alongside per-aerial landing lag.

The condition is straightforward to write: `landedWithShieldBuffered = grounded AND wasPressedWithin(buffer, 'shield', N)`. Aerial states then list two grounded transitions in priority order:

```js
{ when: 'landedWithShieldBuffered', to: 'ShortLand' },
{ when: 'grounded',                 to: 'NormalLand' },
```

The two land states have different durations. Pressing shield within the window routes the landing through ShortLand; not pressing it routes through NormalLand. L-cancelling emerges from a buffered input at the moment of a transition — pure substrate.

What this requires: attack states. That's a phase boundary, not an architectural change. The primitive (buffered input check on a transition) is already there.

---

## 5. Techniques that need new primitives

Some techniques can't emerge from the current rules at all. They need new primitives, not new states. Recognizing which is which is the diagnostic skill.

### 5.1 Moonwalking (needs a new dash-family primitive)

Moonwalking in Melee is: slide backward (vx in one direction) while facing forward (facing in the opposite direction). In the current engine, dash mode sets `vx = facing * dashSpeed` every frame. There's no path to "vx and facing diverge" from any current rule.

The naive fix is a `Moonwalk` state where vx and facing are explicitly opposite. That's a feature. The principled fix is to generalize the dash family: instead of `vx = facing * dashSpeed`, have dash mode read a separate `dashDirection` field on the fighter (committed at slam time, can differ from facing under specific input patterns). Now moonwalk emerges from the same dash mode, with the specific input pattern (smash → quick-reverse-before-Run-threshold) producing a `dashDirection` that differs from `facing`.

The generalization changes dash from "drives one captured direction" to "drives two related but separable captured values." Every existing technique still works (dashDirection = facing in the common case). New emergences become possible.

This is the principled move when an emergence is desired and the primitive is too narrow: **widen the primitive, don't add a special case.**

### 5.2 SDI / DI (machinery arrived in Phase 13; consumers are 13b+)

Smash DI and DI are input-driven trajectory modifications during hitstun. When this was written they couldn't emerge because hitstun didn't exist; Phase 13a built the machinery, and it landed in the predicted shape — Hitstun is a state with physics modifiers, the hit arrives as a self-contained `pendingHit` (already carrying `angle`), and re-hits work through a self-transition. What remains is the consumers:

- DI: applied at the moment of hit, the stick direction influences the launch trajectory. This is `applyHitReaction` (or a sibling effect) reading the buffer around the hit moment — a `pressIndex`-style press-context read — and modulating the angle before `computeKnockback`. Scheduled for 13b; the design pass is *when* the stick is read (hit frame? every hitstun tick? exit?), not *how*.
- SDI: applied during hitstun, each stick "flick" displaces position slightly. This is a condition (`stickFlickDuringHitstun`) firing an effect (small position bump in the flick direction) inside the Hitstun state — mechanically the same self-transition pattern re-hits already use.

Both are pure substrate now that the substrate is here. Aerial reversal (§2.7) already gives a taste: a launched fighter's over-cap velocity responds to opposite-direction drift at air-accel rate, which is DI's crude ancestor operating with zero DI code.

### 5.3 Shield-drop (needs shield states and a stick-direction condition)

Shield-dropping in Melee is dropping through a platform while shielding, via a precise stick angle. Needs Shield states (a future addition) and a condition that detects the stick at a specific narrow downward angle range.

The condition is a small extension of `crouchInput` — instead of `stickY > 0`, something like `stickY > 0 && |stickX| < threshold` for an analog stick (a precise down direction, not down-and-side). On keyboard it's just `stickY > 0` with stickX = 0.

The technique emerges from: Shield state has a transition `shieldDropInput → Fall` (with the drop-through machinery already in collision); the transition fires when the player threads the stick into the narrow window. Pure substrate once Shield exists.

### 5.4 Dash-cancel grabs / JC-grabs (needs grab states)

In Melee, you can grab during the Run state (and the early frames of Dash) by jump-cancelling into a grab. This is feature-like in many engines; in this one, it's two transitions in the right state. When Grab states exist:

```js
// in Dash and Run:
{ when: 'grabPressed', to: 'Grab' },

// Grab itself: grounded action, fixed duration, returns to Idle
```

The "jump-cancel" part is a misnomer in the Melee-source-of-the-term sense — what's happening mechanically is that Dash/Run lets the player exit via grab without going through DashStop. The transition is direct. The fluidity emerges from the priority order: `grabPressed` ranks above `noHorizontalInput → DashStop`, so a grab press during Dash skips DashStop entirely.

This emerges almost trivially once grab states ship.

---

## 6. When special-casing is correct

The discipline is "build the substrate, not the feature," but the rule has exceptions. Recognizing them matters as much as recognizing emergence.

**Cinematic moments.** A character's specific Final-Smash-style finishing move, if the design ever calls for one, is a feature. There is no substrate from which "this specific character does this specific 3-second cinematic when they collect this specific item" emerges. The engine accommodates features by giving them their own scope (a state, a set of effects, an entity), and the feature lives in that scope without leaking into the substrate.

**Stage-specific geometry behavior.** If a future stage has a unique mechanic (a moving platform, a destructible wall, a stage hazard), the mechanic might genuinely require code that knows about it. The defense is to put the special case in the stage data layer, not in the collision primitives. The collision system stays general; the stage's behavior is opt-in via stage-data fields and a stage-specific update system if needed.

**Hard authoring constraints from the game's rules.** Sometimes a rule is rule-of-game, not rule-of-physics. "When time runs out, the player with more stocks wins." This isn't an emergence question — it's a scoring system, separate from the simulation. Score-and-rules code is allowed to be feature-shaped because it doesn't interact with the substrate; it observes the substrate.

The test for whether a feature is acceptable: **does it interact with the simulation's primitives, or is it adjacent to them?** A primitive-interacting feature (a special character ability that ignores friction) corrupts the substrate and should be re-thought as a generalization. An adjacent feature (a UI element, a score, a stage-specific cinematic) lives in its own scope and is fine.

The honest version: most things you'll be tempted to special-case are not in the "rare exception" category. Most are emergences in disguise, or primitives that need widening. When in doubt, treat the discipline as binding.

---

## 7. The discipline in practice

These are the habits that make the substrate-vs-feature discipline durable. They're prescribed elsewhere as rules; here they're explained as practices.

**When asked for a behavior, ask first whether it already exists.** Many emergences are already in the engine and just haven't been verified. Walk-off, dash-off, jump-cancel-walking, edge-canceling, dash-dancing, drop-through, wavedashing, wavelanding, the DashAttack slide, rising aerials, combos — none of these were designed as behaviors; they're consequences of choices that compose. The first move is always to test whether the behavior already happens.

**When a new piece feels needed, read the existing primitives before building it.** Phase 12 twice dissolved an anticipated addition this way: a planned dash-attack pivot effect evaporated after two minutes in `physicsSystem.js` (facing-commit discipline plus dash-mode-reads-facing already did the work), and air-dodge never needed the horizontal mode it was once sketched to require (an entry effect plus `gravity: 0, friction: 0` expressed it). Ten minutes of reading is the cheapest substrate there is, and it's how the freebies in §2.11 were found rather than re-implemented.

**When a consumer misbehaves, suspect the substrate beneath it, not just the consumer.** The air-facing bug is the canonical case: a copy-pasted facing-commit line sat inert in air mode for eight phases, then made back-airs unreachable the moment aerial attacks became the first consumer of stable air facing. "The new feature is broken" is sometimes "the foundation was always broken and nothing had cared yet." Substrate bugs are latent until consumers exist — which also means every new consumer is a free audit of the layers beneath it.

**When implementing a new state, ask what techniques it enables besides the one you're designing for.** A state that only enables the one thing it was designed for is too narrow. A state that enables three or four things is probably the right shape. The test is whether you can sketch the *other* techniques in plain English from the primitives the new state adds.

**When a transition or effect grows complex, stop and look for missing primitives.** A condition that's three pages of branching logic is a sign that the underlying patterns haven't been factored. The fix is to identify the primitives (rising edge, sustained hold, neutral-then-direction) and either compose existing helpers or add a new helper to `inputBuffer.js`. Conditions should be a few lines of orchestration over named primitives.

**When you find yourself adding a flag to a fighter that's set on entry to one state and cleared on exit, stop.** That's a paired-effect leak; see `dataModel.md` §7. The fix is to put the flag on the state itself, where it's queried in context and nothing needs setting or clearing.

**When you find yourself special-casing a state by name, stop.** "if (fighter.actionState === 'AttackAirN')" is a sign that the rule wants to live on state data, not on the system reading it. Add a field to the state definition (e.g., `physics.respectPlatforms`, `physics.canBeReversed`) and have the system read the field generically.

**When you can't see how a behavior would emerge, ask what primitive is missing.** Often the answer is a state you haven't built yet (an air dodge, an attack, a shield). Sometimes it's a generalization of an existing primitive (the dashDirection field, the buffered-on-landing condition). Rarely is it a feature. If it really is a feature, name it as such and put it in adjacent scope.

**When you suspect you're wrong, you probably are.** The discipline is unfamiliar. Most game engines don't work this way. The temptation to special-case is constant and feels productive. Honor the discipline anyway. If you're right that something needs to be a feature, the case for it gets stronger when you've sat with the question for a while; if it doesn't, the temptation passes and the substrate is preserved.

---

## 8. The cost of breaking the discipline

Every special case that leaks into the substrate has a hidden cost: it disables emergences nobody has noticed yet. The Melee developers didn't know wavedashing was possible until players discovered it. If they had added a special case anywhere along the way — "don't preserve horizontal momentum across the air-dodge-to-landing transition," for performance reasons or for design reasons or just for code cleanliness — wavedashing wouldn't exist. The entire competitive scene that emerged from it wouldn't exist.

This is the asymmetric bet the architecture makes. The cost of *not* special-casing is sometimes harder code or slightly more careful authoring. The cost of special-casing is invisible — it removes possibilities that nobody knows existed yet. By the time someone discovers what a primitive could have produced, the special case has been there for years and the technique is unreachable.

The practical guard is a question: **if I remove this special case in six months when someone notices a related technique is broken, what else has to come out with it?** A well-bounded primitive has one obvious removal point. A leaked feature drags its consumers with it. The longer the leak persists, the more consumers attach, and the more the substrate calcifies around the wrong shape.

The shorter version: **emergences are downstream of discipline.** You don't get them by hoping for them. You get them by holding the line, repeatedly, in moments when special-casing would have been easier.

---

## 9. The relationship to the architecture's other rules

Every other architectural rule in this codebase serves the substrate discipline:

- **Data over code** keeps states, characters, and stages as configurations the engine interprets. Code that interprets data composes freely; code that hard-codes behavior doesn't.
- **Decoupled systems** keep each primitive ignorant of what it's enabling. Physics doesn't know about attacks; collision doesn't know about characters; state machine doesn't know about specific states. Each can compose with anything.
- **One World, one tick** keeps the simulation state in a flat shape that can be read, written, and composed without side channels. Emergences need a stable substrate to emerge from; side-channels are how features sneak in.
- **Conditions and effects as registries** keep the state machine general. Adding a new condition or effect is a one-line registry entry that composes with every existing state.
- **Snapshot contract claims slots up front** lets new consumers be added without contract migration. Future emergences that depend on c-stick, on shield depth, on heavy attack — they're all unblocked the moment the consuming logic arrives.
- **Determinism** keeps the simulation reproducible, which makes emergences testable. A behavior that emerges from primitives in a deterministic engine emerges identically every time; nobody has to argue about whether it's a bug or a feature.

The architectural rules are not separable from the substrate discipline. They're the discipline's mechanism. A codebase that follows the rules but doesn't pursue emergence is over-engineered; a codebase that pursues emergence but breaks the rules can't sustain it. The two work together.

---

## 10. When to revisit this doc

This is the doc that gets revisited least often, because its content is timeless rather than version-specific. The systems docs evolve as the systems do; this doc evolves only when:

- A new emergence ships that's worth canonizing as a worked example.
- A primitive is generalized in a way that enables a new family of behaviors, and the family is worth describing.
- An attempted emergence fails and the failure surfaces a primitive that needs widening — the lesson goes here.
- A special-casing decision is made (rarely, deliberately) and the rationale is worth preserving for the next contributor tempted to remove it.
- The diagnostic question (§3) or the discipline-in-practice habits (§7) get sharper in some way through experience.

Update this doc less than the others. Treat its content as part of the project's identity, not its implementation.

---

## 11. The shortest version

If you read nothing else: **build the substrate, not the feature.** When asked to add a behavior, ask what primitive rules would produce it and whether they already exist. If they do, the behavior is data. If they don't, generalize an existing primitive or add a new one in a way that produces the behavior plus a family of others. Rarely, almost never, write the behavior as code that names what it does.

Emergences are not free. They are the payoff of a discipline applied consistently. The discipline is uncomfortable in moments. It is what makes the engine generative rather than complete.

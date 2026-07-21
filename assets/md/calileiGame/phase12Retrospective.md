# Phase 12 Retrospective — Light Attack Combat Substrate

Phase 12 set out to add the combat substrate, scoped to the light attack family. By the end it shipped: ten new action states (jab, three ground tilts, dash attack, five aerials), one new input-buffer primitive (`pressIndex`), one new effect (`commitFacingFromLightAttackPress`), six new conditions across two attack-family shapes (ground tilts and aerial forward/back), one data-layer migration that moved attack tunables off state-data and onto character-data, and one substrate bug fixed (air mode was committing facing). No state-machine interpreter changes. No physics primitives added. No new tick stages.

The combat substrate was almost entirely composition of pieces the engine already had. The few additions were small, well-bounded, and each became the right architectural shape only after specific discoveries during the build.

Phase 12 was split into five sub-phases: 12a.1 (first hitbox + debug visualization), 12a.2 (ground directional family + the `pressIndex` substrate), 12a.2.5 (data-layer migration), 12a.3 (dash attack), and 12a.4 (aerial family + the air-mode facing fix). Hit detection itself — the actual mechanism by which one fighter's hitbox affects another fighter — is deferred to Phase 12b. What Phase 12 shipped was the action shape that hit detection will eventually consume: the states, the data, the input routing, the visualization. The combat skeleton without the contact.

---

### The first hitbox (12a.1)

Phase 12a.1's job was to nail down the data shape for an attack before authoring four more variants. LightNeutralGround — the grounded jab — was implemented from a single source state (Idle) into a single attack state, with debug-overlay rendering as the only consumer of hitbox data. No hit detection, no second fighter, no transitions to anything else from the attack.

The load-bearing data shape decisions made here propagated through every subsequent sub-phase:

- **Hitboxes as a list, not a single object.** Even though every attack today has exactly one hitbox, the shape is `hitboxes: [...]`. Melee attacks routinely have multiple hitboxes (sweetspot/sourspot, multi-hit jabs, different active windows for different limb positions). A list of length 1 is forward-compatible to a list of length N without authoring rework. Cost today is zero; payoff later is no migration.

- **Center-anchor on shape.x, shape.y.** The hitbox's `(x, y)` is its center offset from the fighter, not its corner. The consumer (debug overlay, eventually hit detection) computes corners from center ± half-extent. Center-anchor reads more naturally in authoring ("30 in front of me at mid-body") and matches the convention used by most fighting-game tooling. The decision was named explicitly because it bakes into every future hitbox.

- **Inclusive `[first, last]` active windows.** `active: [6, 9]` means active on stateFrames 6, 7, 8, and 9 — both endpoints inclusive. Reads more naturally than `[first, count]` or `[first, last+1]`. Again, named explicitly to lock the convention.

- **`respectPlatforms: true` on the attack state.** This was the third use of the Phase 11 opt-out pattern (after AirDodge and Land). Attack states shouldn't be droppable through soft platforms mid-swing. The pattern was established enough by 12a.1 that this felt routine — no new substrate, just data.

The debug-overlay extension introduced one new module (`src/debug/hitboxes.js`) following the existing pattern of liveStats.js, history.js, colorEditor.js — a self-contained module exporting one `drawHitboxes(world, ctx)` function called from overlay.js. The renderer itself stays out of attack visualization entirely; hitboxes are diagnostic output, not gameplay rendering. Production rendering will eventually have attack animations; the overlay's role is making the engine's internal state visible until then.

---

### The directional family substrate (12a.2)

The four-direction light family (LightNeutralGround as the catch-all plus LightSideGround, LightUpGround, LightDownGround) needed a new primitive: reading the stick at the moment of the press, not at the moment the state machine evaluates. The lightAttackPressed buffer is 5 frames; in that window, a player might press A while holding a direction and then release the direction before the state machine ticks. Reading current stick gives the wrong attack.

The substrate piece: `pressIndex(buffer, key, frames) → number | -1` in `inputBuffer.js`. Sibling to `wasPressedWithin` — same walk, same edge-detection, returns the position in the buffer where the rising edge sits, or -1 if no edge within the window. Conditions then look up `buffer[idx].stickX` and `buffer[idx].stickY`. The press carries its own context across frames.

This is more substrate than it looks. `wasPressedWithin` was a "did the input happen" primitive; `pressIndex` is a "find it and look around it" primitive. Future consumers: DI input during hitlag (read stick at hit moment), smash-vs-tilt distinction when smashes arrive (smash detected by stick-flick at press frame), any condition that wants context from when the player committed to an input. Shipped as a generic primitive on the user's call — pressIndex was already the cleanest extraction, three lines, no premature abstraction risk.

The four directional conditions for ground tilts overlap deliberately. `lightAttackPressedUp` (stickY < 0), `lightAttackPressedDown` (stickY > 0), and `lightAttackPressedSide` (stickX !== 0) can all match on diagonals; transition priority order resolves which fires. Up before Down before Side before the lightAttackPressed catch-all. This means up-right + A produces u-tilt, down-right + A produces d-tilt, and pure horizontal + A produces side-tilt. Pure neutral + A falls through to the catch-all and produces jab.

The one effect introduced — `commitFacingFromLightAttackPress` — fires on side-tilt transitions and pivots the fighter to the press-frame stickX direction. This was the second pattern of "facing commit on input" alongside the existing `commitFacingFromSlam`, and naming it specifically (rather than reaching for a generic `commitFacingFromPressStick`) was deliberate: there's currently one consumer; when heavy-attack and special-attack families want similar behavior, the question of extraction can be answered with two or three concrete uses in hand, not one.

---

### The c-stick foresight

Two decisions in 12a.2 changed direction mid-discussion based on the user's observation that the c-stick (a controller input that produces directional attacks independent of the main stick and facing) would eventually arrive.

The first was the facing-commit question. The initial proposal was Melee-canonical: side-tilt doesn't commit facing, you have to turn around first. The user noted that the c-stick, when implemented, would absolutely commit facing — pressing c-stick-back attacks behind you regardless of facing. So the architecture for facing-commit on side-tilt needs to exist anyway; building it now means c-stick is a new condition, not a state-structure rewrite.

The second was Squat's transitions. The initial proposal gave Squat only `lightAttackPressed → LightDownGround` (any A press from crouch is d-tilt). The user pointed out that c-stick would let you d-tilt, side-tilt, u-tilt, or jab from Squat — the input is independent of the main-stick crouch hold. So Squat got the full directional family even though, on keyboard, only down is reachable. The transitions exist for the c-stick path.

Both decisions are forward-compatible architecture for an input surface that doesn't exist yet. They paid zero cost in 12a.2 (the conditions and transitions are cheap data) and zero coupling (the c-stick will eventually plug into the existing condition shape, not require its own).

This was a discipline moment worth memorializing. The c-stick wasn't being built; it was being designed-around. The retro-relevant lesson: when a future input surface is named and its semantics are concrete, designing-around it is cheap and right. The temptation to "build what's reachable now" produces architecture that needs reshaping when the rest arrives.

---

### The data-layer migration (12a.2.5)

After 12a.2 shipped, the user asked: "should hitbox tunables really live in states? because won't they propagate to both fighterA and fighterB?"

This was the load-bearing question of the entire phase. The state-data placement worked with one fighter — `world.states.LightNeutralGround.hitboxes` was just one fighter's data, by accident. The moment a second fighter spawned, both would read the same hitbox table. Falcon's jab and Marth's jab would be the same move. That's wrong.

The migration: move `duration` and `hitboxes` off state-data, onto character-data as a sub-namespace `fighter.config.attacks[stateName]`. The state declares the action shape (physics modifiers, transitions, render color, identity); the character declares the tuning (timing, hitbox geometry, damage, knockback parameters). The same state name reached by two different fighters produces the same action shape with each fighter's own tuning.

The architectural fork: when the character doesn't have an entry for an attack state, what happens?

- **Two-tier with fallback** (state-data as default, character as override) was the safer-feeling choice. But for attacks, "default" makes no semantic meaning — Falcon's jab isn't "the default jab with Falcon tweaks." And fighterA and the state-data would have the same values, redundant and misleading.
- **Character-as-source** (no state-data default) was chosen. Missing data → state hangs at undefined duration → loud bug, immediately visible on first press, fixed in five seconds.

The consumer side change was small: `durationElapsed` consults `f.config.attacks?.[s.name]?.duration` first, falls back to `s.duration` for movement states (Land, JumpSquat, etc. — those values are still universal-across-characters, for now). `drawHitboxes` reads from `fighter.config.attacks?.[fighter.actionState]?.hitboxes` with no fallback. Four mechanical edits.

The pattern this established — **character-data sub-table mirroring state names, consumed via optional-chaining lookup in conditions and systems** — will recur. Movement state durations (JumpSquat: 3 frames, Land: 4 frames, Dash: 10 frames) are universal today but won't stay that way. When Falcon's JumpSquat needs to be 3 frames and Bowser's needs to be 8, the same migration applies: move the value off state-data, into `fighter.config.movement` or similar, update durationElapsed to consult it. The pattern is now established with one consumer; the next migration won't need a design conversation.

Doing the migration at 12a.2.5 — between the four-direction family and DashAttack — was the right timing. Postponing it would have meant DashAttack and the five aerials authored on state-data, which would have meant 10 attack states to migrate later instead of 4. The fix scales linearly with attacks-in-the-wrong-place; doing it early was cheaper. The pattern this points at: data-layer mistakes compound; fix them when small.

---

### DashAttack: a no-new-effect dash attack

The plan for DashAttack came in expecting one new substrate piece — a `pivotForDashAttack` effect to handle facing-vs-motion alignment when attacking out of DashBack. The thinking was that DashBack might have facing and motion pointing different ways (you reversed, you're still moving the old way), and the attack would need to pivot facing to match motion direction.

Reading `physicsSystem.js` revealed the actual situation: `dash` mode sets `vx = facing * dashSpeed` every frame. It reads facing, not stickX. And `commitFacingFromSlam` fires on every transition into Dash AND into DashBack. So facing and motion always agree in dash states — the instant-reversal feel of DashBack is achieved by flipping facing and letting physics pick up the change on the next tick.

DashAttack from any dash state (Dash, Run, DashBack) inherits facing-and-motion-already-aligned. The pivot effect wasn't needed. The attack hitbox extends in the motion direction with no extra work.

This was the second time Phase 12 found that an anticipated substrate piece wasn't necessary. The directional family had `commitFacingFromVelocity` floated then rejected (one consumer, defer extraction). DashAttack had `pivotForDashAttack` floated then rejected (the existing facing-commit + dash-mode-reads-facing discipline did the work).

The Phase 11 wavedash story has a parallel shape: four independent primitives (perpendicular-only snap, Land's friction-with-no-horizontal-mode, Idle's similar physics, AirDodge's locked trajectory) composed to produce wavedashing without anyone designing it. Phase 12's parallel: the engine's facing-commit discipline composed with dash-mode-reads-facing to make DashAttack just-work without any new substrate.

The lesson is the same lesson Phase 11 named: substrate makes more things free than designers expect. Investigating the existing primitives before assuming new ones are needed is the discipline that finds the freebies.

What DashAttack did add was two data pieces: the DashAttack state itself (with momentum-preserving `friction: 1.0` + `horizontalMode: 'none'` physics — the wavedash substrate generalized to attacks) and the entry transitions on Dash, Run, and DashBack. No new conditions, no new effects, no engine changes. The simplest sub-phase of all five.

---

### The aerial family (12a.4)

The aerial family introduced the most data of any sub-phase — five new states (LightNeutralAir, LightForwardAir, LightBackAir, LightUpAir, LightDownAir) and five new tuning entries in fighterA.attacks. But the architectural decisions were tighter than they looked.

The forward/back distinction is the key shape difference from ground. Ground tilts use one `lightAttackPressedSide` that commits facing to the press-frame stickX direction. Aerials use two conditions — `lightAttackPressedForward` (press-frame stickX same side as facing) and `lightAttackPressedBack` (opposite) — and they don't commit facing. The hitbox itself encodes the direction: F-air has positive shape.x (extends forward), B-air has negative shape.x (extends behind), both mirrored by facing at the consult site.

This is the cleaner-than-ground formulation. F-air and B-air are TWO DIFFERENT MOVES with hitboxes on opposite sides, not "side with two pivots." Facing stays put across the aerial. No commit-facing effect, no pivot logic, no new effect at all. Two new conditions, both consumers of the existing pressIndex primitive.

Source states for aerial attacks: Fall, AirJump, FastFall. Not AirDodge (committed dodge — Phase 11 design intent), not JumpSquat (the buffered-press path through Fall handles "rising aerial = jump + immediately attack" for free). Each source state gets five new transitions for the aerial family, slotted between `canAirJump` and `canAirDodge`. Priority pattern matches ground: discrete-button attacks sit after jump (preserves player options) and before dodge.

The aerial states themselves are deliberately committed. Each has only two transitions: `grounded → Land` (cuts the aerial short on touchdown) and `durationElapsed → Fall` (attack finishes in air, normal fall resumes). No air-jump cancel, no dodge cancel, no fast-fall cancel, no chaining into another attack. Aerial commitment is Melee-canonical and the simplest substrate.

The `fallSpeedMax: 9.0` choice on aerial states (matching FastFall, not Fall's 6.0) was the user's call against my initial proposal. Reasoning: a player who fast-falls into an aerial expects the fall speed to preserve, not snap to 6. With cap 9, fast-fall vy persists through the aerial; normal-fall aerials gain a slightly heavier sink feel as gravity continues to accelerate toward 9. Discontinuity on exit (vy clamps to Fall's 6) is small enough to ignore for now.

---

### The air-mode facing bug

After 12a.4 shipped, the user reported: B-air is inaccessible. Holding the opposite-of-facing direction in air and pressing Z gives F-air, not B-air.

The trace pointed at `physicsSystem.js`. Air mode was committing facing every frame:

```js
air: (fighter, stickX, cfg, _mods) => {
  physics.addHorizontalVelocity(fighter, stickX * cfg.airAccel, cfg.airSpeedMax);
  if (stickX !== 0) fighter.facing = stickX > 0 ? 1 : -1;
},
```

The second line was a copy-paste from walk mode. In walk, committing facing to stick direction is correct — you face the direction you walk. In air, it isn't. Melee deliberately decouples air facing from drift direction, which is what lets you drift backward while still facing forward — the substrate property that makes B-air keyboard-accessible (without c-stick) and that enables future moonwalk-style mechanics.

Removing the line fixed B-air. It also restored Melee-canonical air behavior. And it added one comment block to physicsSystem.js documenting why air diverges from walk on this specific point, so future maintainers don't "fix" the inconsistency by re-adding the line.

This was the most interesting discovery of the phase. The bug had been in air mode since Phase 4 (when air drift landed). It was inert for eight phases — no consumer cared about facing being stable in air. Phase 12a.4 added the first consumer: aerial back-attacks. The bug surfaced immediately the moment a player tried to do a B-air on keyboard.

The pattern this points at: **substrate bugs can be inert for arbitrary numbers of phases until a consumer surfaces them.** Copy-paste between similar-looking handlers is the most common source. The `air` mode handler looked like `walk` mode handler; the facing-commit line came along for the ride; nothing read it for a long time. If we audit other places where copy-paste between mode handlers might have happened, similar latent bugs may exist. None are visible yet because the consumers aren't built yet.

The slightly broader pattern: **functions that "look right" to a careful reader can still contain inert lines that diverge from the function's actual intent.** Air drift control and air facing commitment are two separate concerns that happened to live in one function. They got introduced together because copy-paste; they exited together because removal was a one-line fix.

---

### What stayed substrate-clean

Across all of Phase 12, the state-machine interpreter didn't change. Phase 11's retrospective explicitly anticipated that combat's hit reactions would force the array-of-effects extension — multiple effects per transition (apply knockback + apply hitstun + spawn particles + screenshake). That didn't happen in Phase 12 because hit reactions didn't arrive yet. The only effect attached to attack transitions is `commitFacingFromLightAttackPress`, and it doesn't compose with anything. Single-effect transitions sufficed.

When 12b ships hit detection, the array-of-effects extension will probably finally land. The composite reset pattern (`resetAirActions` rolling up two resets) is still in place from Phase 11; combat's hit-reaction transitions will be the second context that wants effect composition, and at that point Phase 11's "extend the interpreter and decompose the composite" recommendation becomes the right move.

Physics didn't change either, except for the one-line removal in air mode. Tick order is unchanged: input → state → physics → collision. Hit detection will add a fifth stage after collision when 12b lands.

Collision didn't change. Input buffer gained one primitive (pressIndex) but the buffer's shape and pushInput discipline are unchanged. The snapshot contract is unchanged — every input slot used by Phase 12 (`lightattack`, `stickX`, `stickY`) was already in the snapshot from Phase 4.

This was the cleanest part of the phase. Combat didn't reshape the engine; it composed against the engine.

---

### What composed for free

Several things worked without any direct authoring because the substrate produced them:

- **Edge-cancelling attacks.** Aerial attacks land on a platform; `grounded → Land` fires. If the player slid off the platform during the attack, `notGrounded → Fall` fires. No edge-cancel code; the transition list handles it.

- **Buffered presses across state transitions.** Press A during JumpSquat → press buffers → JumpSquat → Fall on durationElapsed → Fall's first frame evaluates → aerial fires. The "rising aerial" technique emerges from the buffer + priority order without any aerial-specific handling.

- **DashAttack momentum preservation.** Friction-with-`horizontalMode: 'none'` is the wavedash substrate from Phase 11. Applied to DashAttack, it produces "slide through the attack with momentum decaying" without any new mechanic. The fighter enters at `facing * dashSpeed`, gravity is irrelevant (grounded), friction bleeds vx off across the duration.

- **Press-frame context across buffered transitions.** Player slams left during Dash, dashes back, presses A. The press carries through to DashAttack; press-frame stickX is whatever the player had when they pressed; current facing is whatever DashBack committed to. The pressIndex substrate makes the whole sequence work without special-case logic.

- **The dash-attack from DashBack case** specifically composed three primitives: `commitFacingFromSlam` on DashBack entry (facing commits to slam direction), `dash` mode reads facing for vx (facing-and-motion stay aligned), and the lightAttackPressed transition in DashBack (entry point exists). No fourth piece needed.

These aren't bonus features; they're what the substrate produces when it's clean. Phase 11's wavedash emergence pointed at this pattern; Phase 12's parallels reinforce it.

---

### What was deferred and why

A list, with the reason each one waits:

- **L-cancel substrate** (per-aerial landing-lag states + `landedWithShieldBuffered` condition routing to ShortLand variants). Substrate is well-understood; the build is bounded; it's a one-phase task. Deferred because Phase 12 was already five sub-phases and L-cancel without hit detection has nothing to L-cancel out of meaningfully.

- **Per-aerial landing lag.** Currently all aerials land into the same Land state with the same 4-frame duration. In Melee these differ per aerial (F-air lag ~22 frames, B-air ~10, etc.). Adding requires new Land variants — substrate-wise identical to L-cancel substrate, deferred together.

- **Fast-fall during aerial as velocity modifier.** Today, fast-fall is a State (`FastFall`). You can't be in FastFall and in an aerial simultaneously. In Melee, fast-fall is a velocity modifier that applies regardless of state. Substrate change required: separate "fast-falling" flag from "in FastFall state." Deferred to a polish phase.

- **AirDodge attack transitions.** Per user: "revisit later." The substrate works either direction — adding `lightAttackPressed* → LightSomethingAir` to AirDodge is mechanical. The question is design: does AirDodge commit or not? Deferred for actual play testing once 12b makes hits register.

- **Multi-hitbox attacks.** Data shape (`hitboxes: [...]`) supports it; no current attack uses more than one. When sweet-spot/sour-spot or multi-hit jab is wanted, just add entries to the list.

- **Hit detection itself.** Phase 12b. The action shape Phase 12 shipped is what 12b will read: state's hitbox geometry (via character.attacks), state's hitbox active windows, eventual hurtbox geometry. The substrate is ready.

- **Knockback math.** Damage, angle, baseKnockback, knockbackGrowth, hitstun values are placeholders today. They'll be tuned when hits register and the feel emerges from play. Until then, the values are forward-compatible with whatever formula Phase 12b uses.

---

### The discipline that paid off

Three patterns from Phase 12 worth memorializing for future phases:

**Substrate over features at every sub-phase.** No sub-phase has a `function executeAttack()` or anything like it. Every attack is a state with data; every state-machine transition is data; every condition is a small pure function. The interpreter doesn't know which states are attacks. Aerial states share a physics shape with each other but the interpreter doesn't know about "aerials." The discipline holds across ten new states.

**Forward-thinking for input surfaces not yet built.** The c-stick foresight changed two architectural decisions (side-tilt facing commit, Squat full directional family) at zero cost today. When c-stick arrives, the work is connecting it to existing conditions, not reshaping states. The general lesson: when a future input surface is concretely named, design-around it.

**Early data-layer migration.** The 12a.2.5 migration moved 4 attacks' tunables. If it had been postponed to "after the aerial family ships," it would have moved 10 attacks' tunables — and authors (including future contributors) would have written DashAttack and the five aerials on the wrong layer by precedent, multiplying the migration work and the risk that someone misses an entry. Doing it when small was cheap; postponing would have compounded.

---

### What this enables next

- **Phase 12b: hit detection.** This is the next sub-phase. The shape: a new `hitDetectionSystem` slots in after collision, iterates fighters, evaluates each fighter's active hitboxes against other fighters' hurtboxes, writes a `pendingHit` field on the receiving fighter. State machine on the next tick reads `pendingHit` via a `hitTaken` condition every receivable state lists, transitions to Hitstun, fires `applyHitReaction` effect to consume the pendingHit. Hitlag — the freeze-both-fighters frames Melee uses — can be inserted as a state between hit-detection and Hitstun later, or shipped with 12b if it feels right.

- **The character-as-source pattern recurs.** When characters want different JumpSquat / Land / Dash durations, the same migration applies. The shape is already authored: `fighter.config.movement` (or whatever sub-namespace fits), durationElapsed consults it first.

- **Per-aerial landing-lag and L-cancel.** Roughly a one-phase task that doesn't depend on hit detection. Could land before or after 12b; user choice.

- **Smashes, heavy attacks, specials.** Each is the same shape as light attacks: a state with a hitbox, an entry condition, a transition in source states. Smashes will use pressIndex's "stick-flick-at-press-frame" pattern for the smash-vs-tilt distinction. Heavies are mechanically identical to lights. Specials introduce per-character state variation (Falco's blaster, Marth's counter, etc.), which is the first time `fighter.config.attacks` keys will diverge between characters — straightforward extension.

- **Wall-jump, tech-roll.** Both want some form of "commit facing based on velocity or stick at action moment." The `commitFacingFromVelocity` primitive that Phase 12 considered and rejected (no current consumer) will probably arrive when one of these does, at which point the abstraction has two or three consumers and extraction is justified.

- **Sound effects, animations, screen shake, particles.** Layered consumers of state transitions, all attach via the effect system once array-of-effects ships (which it probably does in 12b).

---

### Patterns and observations for future phases

A few things worth carrying forward beyond Phase 12 specifically:

**Substrate bugs are latent until consumers exist.** The air-mode facing-commit line was wrong for eight phases without anyone noticing. Aerial back-attacks were the first consumer to care, and the bug surfaced the moment they tried to use it. This suggests other latent bugs likely exist in places where similar-shaped handlers copy-pasted similar-looking lines. They won't surface until consumers arrive. The remediation is not "audit everything proactively"; it's "be alert when a consumer behaves unexpectedly that the substrate underneath might be wrong."

**One-consumer primitives stay specifically named.** `commitFacingFromLightAttackPress` is verbose; the temptation to call it `commitFacingFromPressStick` is real. The discipline that resisted that temptation in 12a.2 and 12a.3 will look prescient if heavy/special attack families end up using slightly different lookup logic than light. If they end up identical, renaming to a generic name when three consumers exist is a five-second change.

**Forward-compatible data shapes cost nothing today.** Hitboxes as a list, character.attacks as a sub-namespace, fallSpeedMax as an optional field with consumer-side defaults — none of these added authoring overhead in their first use, all of them paid off in the second use, and they'll pay off again as the engine grows.

**Read the existing code before adding new substrate.** The DashAttack pivot effect "would be needed" only until I read `physicsSystem.js`. The check took two minutes; the substrate decision took the rest of the conversation. The general pattern: when a new piece feels needed, investigate the existing pieces for ten minutes first.

Phase 12 was a phase about combat that mostly used what the engine already had. The few additions were small, named, and justified. The biggest discovery — the air facing bug — was a deletion. The biggest migration — character.attacks — moved data sideways without changing the consumers. The biggest emergence — DashAttack-without-pivot — was the realization that no new substrate was needed at all.

The combat skeleton is in place. Hit detection in 12b will give it contact.

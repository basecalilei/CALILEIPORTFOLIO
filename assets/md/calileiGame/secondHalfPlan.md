# Second-Half Plan — Phases 13 through 20+

This document is a pre-mortem for the rest of the project. It is NOT a roadmap that prescribes solutions; it's an inventory of the architectural pressures, migrations, and substrate questions that the upcoming phases will surface. The intent is that when Claude or the project lead opens a future phase, this document gives them enough orientation to recognize the load-bearing decisions before they accidentally bake the wrong one.

Every phase below has been through enough thinking to identify what the *questions* are — but most don't have answers yet. The pattern from Phase 12 should hold: investigate existing primitives before adding new ones, name single-consumer pieces specifically, and let two-or-more consumers force generalization.

> **Status annotation (post-Phase 13a).** Phase 13 split in practice: **13a (hit detection, fighterB, knockback, hitstun) shipped**; **13b (hitlag, DI, the array-of-effects interpreter change) is pending**. The Phase 13 entry below is annotated with predicted-vs-actual; two newly discovered items (Tumble, Sakurai angle) are filed under Phase 14a. The embedded build of the game in the Calilei site also landed alongside 13a — not a phase, but it added one standing constraint on engine work (the embed contract, `calileiGame.md` §8.16). Per the closing note, later retros should keep annotating.

---

## The shape of the back half

Phase 12 was almost entirely additive. New states, new conditions, new effects, no system rewrites. From Phase 13 onward, the engine starts changing in deeper ways. Hit detection adds a new tick stage. Grab couples fighters to each other. Projectiles add a new entity type. Shield adds a runtime resource. Each is more substrate-invasive than anything in Phase 12.

The first-half pattern — "each fighter is an independent simulation against the stage" — gets explicitly broken in Phase 13 (hit detection) and broken again more fundamentally in Phase 17 (grab). The substrate that ships in Phase 13 should be designed knowing this is the first of several cross-fighter coupling mechanisms.

The phase ordering: 13a (hit detection + FighterB-as-dummy — shipped), 13b (hitlag + DI + array-of-effects — pending), 14 (split into 14a per-aerial landing/L-cancel, 14b multihit/sweet-sour, 14c FighterB's moveset), 15 (dodges + i-frames), 15.5 or 16's-precursor (edge mechanics), 16 (shield), 17 (grab), 18 (split into 18a projectiles, 18b items), 19 (KO/respawn/stocks), 20 (controller), then polish (sound, animation, balance).

---

### Phase 13 — Hit Detection + FighterB-as-Dummy + Hitlag *(split: 13a shipped / 13b pending)*

The phase that turns Phase 12's combat skeleton into combat.

> **What actually happened (13a).** The entry below is preserved as written; here's the reconciliation. **Shipped as predicted:** the cross-fighter pendingHit pattern (write-then-consume, 1-frame lag held, no `resolveHit()` mega-function), the five-stage tick, `core/knockback.js` as its own pure file, the dynamic-duration shape for Hitstun (`pendingHitstunFrames` + `hitstunFinished`, exactly the sketch below), and the damage-init gotcha (caught). **Different than predicted:** the array-of-effects change did *not* ship — no consumer forced it, so `applyHitReaction` shipped as one composite instead of the `applyKnockback`/`applyHitstun`/`applyHitlag` atoms, and both it and `resetAirActions` decompose when 13b's hitlag finally forces the interpreter change. The universal `hitTaken` transition landed *first* in every state — above `notGrounded`, not below it (getting hit preempts going airborne) — across 24 states, targeting Hitstun directly since Hitlag doesn't exist yet. The `pendingKnockbackVx/Vy` staging fields were never needed (the effect writes `vx`/`vy` directly; the formula returns `{vx, vy}` and hitstun rides on the hit data, not the formula). The dummy's input became a frozen `NEUTRAL_SNAPSHOT` rather than a null stub, which surfaced the one unpredicted structural change: the tick signature widened to `tick(world, inputsByFighter)`, positional, with routing owned by the composition root. **Deferred to 13b:** hitlag, DI, array-of-effects, the composite decompositions. **Newly discovered:** Tumble and the Sakurai angle (filed under 14a below). Full story: `phase13Retrospective.md`.

**The big architectural moves:**

**Cross-fighter awareness lands here.** Until now each fighter ticks against the stage, never against another fighter. Hit detection introduces fighter-vs-fighter interaction. The substrate for this should be designed to be reusable — Phase 18 (projectiles) and Phase 17 (grab) will both need their own variants of cross-entity interaction. Hit detection's pattern (writes `pendingHit` field, state machine consumes next frame) should generalize.

**Array-of-effects extension finally ships.** Phase 11 anticipated; Phase 12 didn't need; Phase 13 needs. Hit reactions want multiple effects per transition: `applyKnockback` + `applyHitstun` + `applyHitlag` + (eventually) particles/screenshake. The interpreter change is ~6 lines. After this, `resetAirActions` should decompose back into atomic `resetAirJumps` + `resetAirDodges` for tidiness.

**Hitlag introduces dynamic state duration.** Until now, every state's duration was authored (state-data or character-data). Hitlag's duration varies per hit (based on damage). The substrate question: where does that variable duration live? The likely answer is a fighter runtime field (`pendingHitlagFrames`) set by `applyHitlag` effect, consumed by a `hitlagFinished` condition (`f.stateFrame >= f.pendingHitlagFrames`). The state's authored `duration` stays 0; the condition is the gate.

Same pattern applies to Hitstun (duration scales with damage). Worth getting the shape right once — Hitlag and Hitstun share it.

**Pending-hit fields proliferate on fighter runtime.** Likely new fields: `pendingHit` (object containing hit details from hitDetectionSystem), `hitConnected` (Set tracking which victims this attack has hit), `damage` (the percent accumulator), `pendingHitstunFrames`, `pendingHitlagFrames`, `pendingKnockbackVx`, `pendingKnockbackVy`. The fighter shape grows substantially in this phase.

**The universal `hitTaken` transition.** Every receivable state will need `{ when: 'hitTaken', to: 'Hitlag' (or Hitstun), effect: 'applyHitReaction' }` near the top of its priority list, just below `notGrounded`. That's 25+ states getting one new transition. Per stateMachine.md §11, repetition is not a refactoring target — explicit listing in each state stays. Authoring overhead is real but the discipline doesn't bend.

**New tick stage.** `hitDetectionSystem` slots in after collision: `input → state → physics → collision → hitDetection`. First time the tick has five stages.

**FighterB-as-dummy** is intentionally minimal. Spawn a clone of fighterA with no input pipeline (null snapshots or a stub) at a fixed position. Just enough to be a hit target. Real character variation lands in 14c.

**Single-consumer pieces likely to land in 13:**
- `hitDetectionSystem` (the system itself)
- `applyKnockback`, `applyHitstun`, `applyHitlag`, `applyHitReaction`, `beginAttack` (effects — some may compose; some may be atomic)
- `hitTaken`, `hitlagFinished`, `hitstunFinished` (conditions)
- `Hitlag`, `Hitstun` (states)
- `pendingHit`, `hitConnected`, `damage`, `pendingHitlagFrames`, `pendingHitstunFrames`, `pendingKnockbackVx/Vy` (fighter runtime fields)
- Knockback math: `core/knockback.js` — pure function `computeKnockback(hitbox, victimDamage, victimWeight) → {vx, vy, hitstun}`. Should be its own file.

**Things to watch for:**
- The temptation to write a `resolveHit(attacker, victim, hitbox)` function that does ten things. Discipline version: hit detection writes pendingHit, state machine reads it, transitions consume it, effects apply it. Each piece small.
- Cross-fighter system ordering. When the hitDetectionSystem runs, fighter A is between physics and the next tick's state machine. Fighter B's pendingHit gets set this frame, consumed next frame. The 1-frame lag is fine and invisible; trying to "resolve hits immediately" introduces ordering bugs.
- The `damage` field needs careful initialization in `createFighter`. Forgetting it would make every fighter's "percent" start at undefined.

**Migrations expected:**
- `resetAirActions` composite decomposes once array-of-effects ships.

**Probably also lands or is on the radar:**
- **DI (Directional Influence)** as a Hitstun-entry effect that reads buffer input during Hitlag and biases the knockback vector. Could ship in 13 or wait for 14. Without DI, combat feels static — the player can't influence trajectory after being hit. The substrate piece is small (effect reads `inputBuffer[0..hitlagFrames]` for stick direction); worth considering for 13's scope.

---

### Phase 14a — Per-Aerial Landing Lag + L-Cancel

Self-contained substrate work. Authoring volume but minimal new patterns.

**Inherited from Phase 13a** (discovered during hit-detection work, not in the original inventory):

- **Tumble.** Fall's `fallSpeedMax: 6` masks strong knockback the moment hitstun ends — a spiked fighter visibly decelerates to normal terminal velocity mid-plummet. Hitstun itself is deliberately uncapped; the fix is a Tumble state (uncapped post-hitstun fall, entered from Hitstun when knockback exceeded a threshold) so launches keep their speed until the player acts. Melee-canonical, and the missing piece that makes spikes read at low percents.
- **Sakurai angle.** Melee's authored angle `361` means "context-dependent launch" (mostly-horizontal grounded, steeper aerial). `computeKnockback` currently treats angles literally; 361 needs either a special case in the formula or an authoring rule that forbids it. Decide before authoring fighterB's moveset (14c) bakes in real angle data.

**The big architectural moves:**

**Per-aerial Land variants.** Five new Land states (LandLightNeutralAir, LandLightForwardAir, LandLightBackAir, LandLightUpAir, LandLightDownAir). Possibly doubled for Short and Normal variants (10 total) once L-cancel routing exists. Each has the same physics shape as today's Land, differs only in duration.

**L-cancel routing.** A new `landedWithShieldBuffered` condition (`wasPressedWithin(buf, 'shield', ~7)` AND `grounded`). Aerial states' `grounded` transition splits into two:
```
{ when: 'landedWithShieldBuffered', to: 'LandLightFAir_Short', effect: 'resetAirActions' },
{ when: 'grounded',                  to: 'LandLightFAir_Normal', effect: 'resetAirActions' },
```

The `shield` button is detected via buffer; the Shield STATE arrives in Phase 16. Press-detection works without state existence. Worth noting because if Phase 14a tries to depend on Shield-state, it'll get blocked. The decoupling is the right move.

**The character-tuned durations migration extends.** Movement state durations (Land variants here, then JumpSquat/Dash/etc. later) start needing per-character variation. The Phase 12.5 pattern applies: probably `fighter.config.landing.LandLightFAir_Normal.duration = 22`, etc. Or a unified `fighter.config.stateDurations` table. Either way, the lookup pattern in `durationElapsed` already supports this with optional chaining; just adds the new sub-namespace.

**Single-consumer pieces likely to land:**
- 5 (or 10) new Land variant states
- `landedWithShieldBuffered` condition
- Possibly `fighter.config.landing` or `fighter.config.stateDurations` sub-namespace

**Things to watch for:**
- The temptation to extract a `LandFromAerial` base shape and parameterize. Don't — each Land variant is a first-class state, even if they look nearly identical. Repetition is not a refactoring target.
- The L-cancel window (~7 frames in Melee) is character-tuneable but should probably stay universal unless evidence suggests otherwise. One less per-character knob until needed.

**Fast-fall during aerial substrate.** Currently fast-fall is a State; aerials can't preserve it. Phase 12's retro flagged this as deferred. Probably fits in 14a — decouple "fast-falling" (a velocity-modifier flag) from FastFall-as-a-state. Could be a fighter runtime flag (`fastFalling: true`) set by a fastFallTriggered effect from any airborne state, consumed by physics to set fallSpeedMax higher. Or a new horizontalMode variant. Not load-bearing for 14a's main thrust but worth bundling if scope allows.

---

### Phase 14b — Multihit + Sweet-Sour Hitboxes

The phase where hit detection grows real complexity.

**The big architectural moves:**

**`hitConnected` scoping changes.** Currently the design (from Phase 13) tracks "which victims has this attack hit" once per attack-state entry. Multihit attacks (jab combos, multi-hit aerials like Marth's f-air) need to hit the same victim multiple times — once per "hit pulse." Two reasonable shapes:
- Each hitbox in the list maintains its own (attacker, victim) consumed set. Authoring per-hitbox; new hitbox = new pulse.
- Hit pulses are recognized by hitbox-active-window transitions. When a hitbox's active window starts, the consumed set for that hitbox resets.

The first is more explicit, the second more emergent. Worth deciding before authoring multihit attacks.

**Sweet-sour priority.** When multiple hitboxes from the same attack overlap the same victim simultaneously, which one wins? Three options:
- List order (first in the `hitboxes: [...]` array wins) — implicit, easy to misread
- Explicit `priority` field — clear, more authoring
- Highest damage wins — emergent, may produce surprises

Worth flagging that this is a real decision; deferral risks accidental behavior baked in by whichever option happens to apply first.

**Sweeping hitboxes** turn out to be free — a list of hitboxes with non-overlapping (or barely-overlapping) active windows that march across positions over time is just data. No new substrate needed unless authoring ergonomics push for a "swept primitive" later.

**Single-consumer pieces likely to land:**
- Modified `hitConnected` scoping (per-hitbox or per-pulse)
- Maybe a `priority` field on hitboxes (or established list-order convention)
- Probably no new states or effects — this is substrate refinement inside hitDetectionSystem

**Things to watch for:**
- "Just add a flag" creep on hitbox shape. Each new field is a forever-after authoring overhead. Push back on anything that looks like a workaround for a missing primitive.
- The interaction between multihit and DI. DI in Phase 13/14 biases knockback vector once per hit. Multihit produces multiple hits in quick succession. Does the player DI each one separately? In Melee, yes. The substrate should support per-hit DI — each pendingHit gets its own DI evaluation.

---

### Phase 14c — FighterB's Moveset

Exercises the substrate from 14a/14b. The forking moment for character architecture.

**The big architectural question:**

**Do FighterA and FighterB share state shapes, or do they need different ones?**

Today all states are in one shared `world.states` table. Both fighters look up `LightNeutralGround` → same state-shape data. Only `fighter.config.attacks` differs (Phase 12.5 migration).

If FighterB's jab is "stationary swing with different timing/damage" — shared shape works. No migration.

If FighterB's jab is "lunge forward 20 pixels while attacking" — different physics, different transitions. Shared shape breaks down.

Three possible answers:
- **Character-scoped state names**: `FighterA_LightNeutralGround` vs `FighterB_LightNeutralGround`. Verbose but explicit. Each character's state names live in their config.
- **State physics overrides on character**: state declares default physics; character can override. Same pattern as the attacks migration but extended to physics modifiers.
- **States move entirely onto character config**: the most invasive — `fighter.config.states` rather than `world.states`. Universal state lookups become per-fighter.

The right choice depends on how much state-shape variation real characters need. Likely answer: most attacks share shape, a few characters have weird ones (Yoshi's down-air, Kirby's stone). Worth deferring the decision until FighterB is actually being authored and the divergences become concrete.

If most divergences turn out to be physics-shape (different friction, different horizontalMode), the second option (character physics overrides) is the cheapest. If divergences are transitions (different exit conditions), the first option (character-scoped names) is unavoidable. If divergences are both, the third option may be needed.

**Single-consumer pieces likely to land:**
- New file: `src/data/characters/fighterB.js`
- Possibly the state-physics-override migration
- Updates to main.js to spawn both fighters with their respective configs

**Things to watch for:**
- The temptation to make FighterB's moveset "just like FighterA's but with different numbers." That's not testing the substrate — it's authoring against the path of least resistance. FighterB should have at least one move that diverges in shape (multi-hit, sweeping, unusual physics) to validate that the substrate generalizes.

---

### Phase 15 — Roll Dodge + Spot Dodge + Frame-Windowed Invulnerability

Bounded substrate work that finishes the Phase 11 placeholder.

**The big architectural moves:**

**`intangible` migrates from boolean to object.** Phase 11 added `intangible: true` on AirDodge as a placeholder. Real Melee i-frames are frame-windowed (AirDodge: frames 4-19 of 29-frame state). The shape becomes `intangible: { start: 4, end: 19 }`. AirDodge's data updates; the hit-detection consumer (lands in Phase 13) reads the new shape.

This is a small migration but worth flagging: the boolean was a placeholder, replacing it is mechanical, but every consumer added between Phase 11 and now might have assumed the boolean shape. By Phase 15 the only consumer is hitDetectionSystem from Phase 13, so the migration is one site.

**New states with motion + i-frames.** RollForward, RollBack, SpotDodge. Roll has horizontal motion (like a brief Dash but with i-frames). SpotDodge is stationary i-frames.

Roll's physics: probably a new horizontalMode? Or reuse 'dash' with different speed? Worth checking what 'dash' currently does and whether a `rollSpeed` character constant is the cleaner addition. The pattern from DashAttack — `horizontalMode: 'none'` plus entry effect that sets vx — might apply.

**Single-consumer pieces likely to land:**
- `intangible` shape migration (boolean → window object)
- `RollForward`, `RollBack`, `SpotDodge` states
- `rollSpeed`, possibly `dodgeDuration` character config fields
- `applyRollImpulse` effect (if rolls use entry-effect velocity rather than horizontalMode)

**Things to watch for:**
- The "should rolls also be character-data-tuned" question. Yes, durations vary by character. Migrate to `fighter.config.dodges` sub-namespace or whatever pattern Phase 14a established.
- The discipline of i-frame windowing should generalize. When characters get special-move-state i-frames later (e.g., super armor on certain moves), the same `{ start, end }` shape applies. Don't over-extract until that consumer arrives, but design 15's shape with that future in mind.

---

### Phase 15.5 — Edge Mechanics

Added as a gap in the original plan. Substantial substrate phase.

**The big architectural moves:**

**Edge zones as a new collision concept.** Stages already declare blast zones (Phase 19's KO substrate); now also edge zones — the lip at the boundary between a platform's solid floor and the empty space below. Edge detection logic in the collision system: airborne fighter sweeping near an edge with no ground below grabs it.

**New states**: LedgeGrab (attached state, position locked), LedgeGetUp (variants: normal getup, getup attack, getup roll, jump from ledge), LedgeHang (idle on edge).

**Position attachment.** Fighter attached to ledge position. Like grab in this way — but the "other entity" is the stage, not another fighter, so the coupling pattern is one-sided.

**Multi-fighter edge competition.** Only one fighter can occupy a given ledge at a time. Melee's "trump" mechanic: a new grabber displaces the old, sending the displaced fighter into a brief vulnerable state. Inter-fighter interaction without combat — closer to grab in shape.

**Edge invulnerability windows.** Ledge-grab grants brief i-frames. Re-grabbing the same edge has reduced i-frames (anti-stall). A persistent fighter state: `lastEdgeGrabFrame` or similar, used by the i-frame logic.

**Single-consumer pieces likely to land:**
- Edge zone data on stages (`stage.edges`)
- Edge detection in collision system
- Multiple new states (LedgeGrab, LedgeGetUp variants, LedgeHang, LedgeJump)
- Inter-fighter trump mechanic
- `lastEdgeGrabFrame` runtime field

**Things to watch for:**
- The temptation to make every edge mechanic its own state. Some are. Some (like ledge-trump) are better as transitions between existing states. Default: more states, fewer special-case effects.
- Edge mechanics are a Melee-heavy decision space. Different fighting games handle edges very differently (Smash 4 ledge-snap, Ultimate intangibility, etc.). Worth deciding upfront which model to follow before authoring.

---

### Phase 16 — Shield

Runtime resource and committed state.

**The big architectural moves:**

**`shieldDepth` as a runtime resource.** A float that depletes on hit, recovers when held without damage, breaks when depleted. First time a fighter has a non-counter runtime resource (damage is a counter; shield depth is a recoverable resource).

**Shield states.** Shield (the held-shield state), ShieldStun (brief stun from being hit while shielding), ShieldBreak (long stun, vulnerable, comes from depleting shield). PowerShield (frame-perfect block) may be its own state or an emergent property of shield's i-frames.

**Shield-grab.** Pressing grab while shielding → Grab state. Phase 17's grab depends on shield existing. Phase 16 should ship grab-press detection in Shield (the transition is there even before Grab state exists — same decoupling pattern as L-cancel-before-Shield in Phase 14a).

**Buffered shield + landing connects to L-cancel.** Phase 14a's `landedWithShieldBuffered` condition works without Shield-state existing. By Phase 16, Shield-state exists — does the condition need to change? Probably not. Press detection is independent of state existence. Worth verifying when the time comes.

**Single-consumer pieces likely to land:**
- `Shield`, `ShieldStun`, `ShieldBreak` (possibly `PowerShield`) states
- `shieldDepth` runtime fighter field
- `applyShieldDamage` effect
- Various conditions: `shieldHeld`, `shieldReleased`, `shieldDepleted`, `grabPressedWhileShielding`
- Shield-related character config (initial depth, regen rate, etc.)

**Things to watch for:**
- The "should shield be a state or a flag" question. State is cleaner — transitions in and out work normally, hit detection consults state physics. Flag is fewer states but more conditional logic everywhere. Default to state.
- Shield interactions with everything: can you shield mid-attack? (No — committed.) Can you shield mid-roll? (No.) Can you shield mid-aerial? (No.) The pattern: shield is a grounded neutral action. Listing it on the right states matters.

---

### Phase 17 — Grab

The phase that breaks "each fighter ticks independently."

**The big architectural moves:**

**Inter-fighter state coupling.** Until now, fighter A's state never depended on fighter B's state. Grab changes this fundamentally — a grabbed fighter's state is determined by the grabber's actions (pummel, throw, release).

**The grab loop.** Grabber state: Grab (initial grab), Pummel (held action that does damage), Throw_Up/Throw_Down/Throw_Forward/Throw_Back. Victim state: Grabbed (passive). The victim's position follows the grabber's position. The victim transitions out of Grabbed only when the grabber transitions (release or throw).

**Reference passing.** New fighter runtime fields: `grabbedBy: fighterRef` (on victim) and `grabbing: fighterRef` (on grabber). Position update logic on the grabbed fighter reads the grabber's position.

**Tick order question.** When multiple fighters are coupled, order matters. The grabbed fighter's state depends on the grabber's actions resolved THIS frame. Probably: the existing `for fighter in world.fighters` loop in each system gets a sort, or the grabbed fighter's logic explicitly reads the grabber's post-tick state. Either way, the "independent fighter tick" property is gone here. Worth being deliberate about how it breaks.

**Throw as inter-state effect.** Throw transitions on grabber → victim enters Hitstun with throw-specific knockback. Cross-fighter effect: the effect runs on the grabber's transition but modifies the victim. New pattern; needs a clean implementation. Probably: throw effects take `(grabber, victim)` rather than just `(fighter)`.

**Grab escape.** Victim mashes buttons to escape; the grab-state has its own duration that scales with damage and mashing inputs. Another dynamic-duration scenario like Hitlag/Hitstun.

**Single-consumer pieces likely to land:**
- Many new states: Grab, Pummel, GrabRelease, Throw_Up/Down/Forward/Back, Grabbed
- Multiple new effects for throw-knockback (each direction is character-tuned)
- `grabbedBy`, `grabbing` fighter runtime fields
- `applyThrowKnockback` style effects that take grabber + victim
- Possibly modified tick order or sort-by-coupling

**Things to watch for:**
- The temptation to make the throw effects character-specific (`applyFalconThrowUp`, `applyFalconThrowDown`, etc.). Don't — throws are state with hitbox-like knockback data on character config. Same pattern as attacks: state is universal, tuning is character.
- The grab loop introduces real conceptual complexity. Two fighters in two states, coupled. The retro for this phase will be substantial.
- Inter-fighter effects are a new pattern. They should be named and discussed in the retro. May warrant their own sub-namespace in effects.js.

---

### Phase 18a — Projectiles

New entity type.

**The big architectural moves:**

**`world.projectiles` array.** First non-fighter entity in the world. The world shape grows.

**`projectileSystem` in tick.** Between physics and hitDetection. Updates projectile positions, handles projectile-stage collision (some pass through platforms, some don't), checks lifetime.

**Hit detection becomes more generic.** `hitDetectionSystem` evolves: not just fighter-vs-fighter, but projectile-vs-fighter, possibly projectile-vs-projectile (clanking). The system pattern might become "iterate all hitbox-bearing entities" rather than "iterate fighters." Worth refactoring early in 18a rather than after.

**Projectile-spawning effects.** Special-move states (Falco's blaster, Samus's missile) have entry effects that spawn projectiles. The effect creates a new entry in `world.projectiles` with appropriate position, velocity, hitbox, lifetime.

**Projectile shape.** A projectile is: position, velocity, hitbox, lifetime, owner (the fighter who spawned it, for ignoring self-hits), and possibly a state machine of its own (some projectiles transform — Samus's charge shot has stages). Likely smaller and more focused than the fighter shape.

**Hurtbox on projectiles?** Some projectiles can be hit and destroyed (Link's bombs). The hitDetectionSystem's hurtbox concept extends. Maybe `hurtbox` becomes a universal entity property.

**Single-consumer pieces likely to land:**
- `Projectile` entity shape
- `world.projectiles` array, lifecycle management
- `projectileSystem`
- `spawnProjectile` effect (or multiple variants)
- Refactor of hitDetectionSystem to be entity-generic

**Things to watch for:**
- The temptation to write per-projectile-type code. Projectiles should be data-driven like states — a projectile config table with type, hitbox, behavior. Falco's blaster bolt is data, not a `BlasterBoltProjectile` class.
- Projectile lifetime cleanup. When projectiles leave the screen or expire, they need to be removed from `world.projectiles` without breaking iteration. Standard pattern: filter at end of system.

---

### Phase 18b — Items

Similar entity infrastructure to projectiles, plus pickup/hold/throw mechanics.

**The big architectural moves:**

**Items as entities** with their own physics (gravity, bounce on landing) until picked up. Once held, attached to a fighter.

**Held-item state.** `fighter.heldItem: itemRef`. A new fighter runtime field. When holding an item, certain attacks change shape (the item becomes the weapon — itemForward becomes the f-tilt). This either:
- Replaces normal attack states with held-item versions (transitions route differently when holding)
- Or modifies hitbox geometry of normal attack states based on held item (uglier)

First option is cleaner — held-item states are first-class.

**Pickup mechanics.** A new transition in grounded states: `lightAttackPressed → PickupItem` when over an item, OR an automatic pickup on collision. Probably the former (player intent matters).

**Item-as-projectile when thrown.** Throwing an item makes it a projectile (with damage and trajectory). Item physics reuses Phase 18a's projectile substrate.

**Single-consumer pieces likely to land:**
- `Item` entity shape (similar to projectile but with pickup-able flag)
- `world.items` array
- `itemSystem` (probably folded into projectileSystem or peer)
- `heldItem` fighter runtime field
- Pickup/drop/throw transitions and effects
- Possibly held-item attack states (separate from regular ones)

**Things to watch for:**
- Authoring overhead if every attack has a held-item variant. Worth restricting which attacks can use items (probably just neutral / tilt / smash, not aerials or specials) to keep state count manageable.
- The visual feedback for held items requires render-side substrate that doesn't exist yet (rendering an item attached to a fighter). May be polished separately.

---

### Phase 19 — KO / Respawn / Stocks

Game-loop concerns enter.

**The big architectural moves:**

**KO detection.** A fighter outside `stage.blastZones` is KO'd. New system or condition. Probably a condition (`kOd: fighter.x outside blastzones || fighter.y outside blastzones`) that triggers a state transition to a KO state.

**KO state and respawn.** New state: KOd (or Respawning). The fighter freezes at the blast position briefly, then despawns, then respawns at a respawn platform with i-frames.

**Stock counter.** `fighter.stocks` runtime field. Decrements on KO. When 0, fighter is permanently out.

**Match state.** Overall match-state machinery: `world.matchState: 'playing' | 'ended' | 'paused'`. Match ends when all-but-one fighter have 0 stocks. This is game-loop, not fighter-loop — likely lives outside the fighter tick.

**Respawn i-frames.** Reuses Phase 15's `intangible: { start, end }` shape. The respawning fighter has i-frames for a fixed window after respawn, removed when they move or attack.

**Single-consumer pieces likely to land:**
- `KOd`, `Respawning` states
- `kOd` condition, `respawnComplete` condition
- `stocks` fighter runtime field
- `world.matchState` and related game-loop logic
- Stage data for respawn platforms

**Things to watch for:**
- Match-state vs fighter-state coupling. Match state lives in the world; fighter state lives on the fighter; the boundary needs clean handling. Probably a separate `matchSystem` in the tick.
- The "game over" screen is UI-adjacent. Worth flagging that some of Phase 19's work bleeds into rendering/UI work that isn't really substrate.
- Respawn platform position is stage data, but the respawn LOGIC (i-frames, position-setting) is fighter-state logic. Clean separation matters.

---

### Phase 20 — Controller (Gamepad)

The input expansion phase.

**The big architectural moves:**

**Snapshot shape extends — but how?** Today snapshots have digital `stickX/stickY` (-1, 0, 1) for keyboard. Controllers produce analog (-1.0 to 1.0). Three migration options:

- **Convert at input layer**: controller analog → digital at the input boundary. Snapshot shape unchanged. Loses analog nuance (smash-vs-tilt by stick magnitude, slow-walk by small stick deflection).
- **Make snapshot analog throughout**: floats everywhere. Every condition that compares `stickX !== 0` becomes `Math.abs(stickX) > deadzone`. Substantial change, lots of consumer updates.
- **Both**: snapshot has `stickX` (digital, derived) AND `stickXAnalog` (float). Existing consumers unchanged; new consumers (smash-vs-tilt) read analog. Forward-compatible, lowest migration cost.

The third option is the cheapest. Existing condition logic stays. New consumers that need analog opt in. Eventually, anything that benefits from analog can migrate.

**C-stick reaches its first consumer.** Phase 12's c-stick foresight (Squat's full directional family, side-tilt facing-commit) was forward-thinking. Phase 20 actually wires c-stick to drive attacks. The conditions need extension: `lightAttackPressedSide` becomes "main-stick side OR c-stick side." Could be a new condition or augmented existing ones.

**Multiple input devices.** The input pipeline takes from any of keyboard, controller A, controller B, etc. Each fighter is assigned an input source. New configuration concept: which device drives which fighter.

**Smash attacks.** Until now, only light attacks exist. Smashes (heavy ground attacks with charge mechanic) need:
- Analog stick magnitude detection at press (large deflection = smash, small = tilt)
- Charge state: holding the input charges damage/knockback
- Release timing matters

The smash-vs-tilt distinction at press frame uses `pressIndex` with stick magnitude — exactly the kind of analog-required mechanic.

**Single-consumer pieces likely to land:**
- Snapshot shape extension (analog fields added)
- Multiple-device input mapping
- C-stick conditions integrated with main-stick conditions
- Smash attack states (a new attack family)
- Smash charge mechanic (runtime field, charge effect)

**Things to watch for:**
- The temptation to migrate every condition to analog "for consistency." Don't. Existing digital comparisons work; the analog values are additive. Migration is per-consumer when motivated.
- Device-to-fighter mapping is a UI concern. The substrate should accept "fighter N's input source is device M" but the assignment logic is character-select-screen stuff.
- Smashes are the first attack family to use stick magnitude. The substrate piece (analog magnitude at press frame) becomes load-bearing here.

---

## Cross-cutting concerns

Things that span multiple phases.

### The fighter shape grows substantially

Today (post-13a): `x, y, vx, vy, facing, grounded, airJumpsUsed, airDodgesUsed, stateFrame, actionState, inputBuffer, config` — plus 13a's additions: `damage, hitConnected, pendingHit (object), pendingHitstunFrames`. (The once-predicted `pendingKnockbackVx/Vy` were never needed — knockback writes `vx`/`vy` directly at consumption.)

By Phase 19, also: `pendingHitlagFrames (13b), grabbedBy, grabbing, shieldDepth, heldItem, stocks, lastEdgeGrabFrame, fastFalling (maybe)`.

The fighter becomes a much more complex entity. Worth a documentation-friendly summary in the eventual rewrites of dataModel.md.

### The `fighter.config` sub-namespaces proliferate

Today: `physics, body, color, attacks`.

By Phase 19, also likely: `landing` (per-aerial Land durations), `dodges` (roll/spot dodge), `shield` (shield constants), `grab` (grab constants), `throws` (throw knockback per direction), `held` (item-modified moves), `weight` (for knockback scaling), plus extensions to `physics` and `attacks` as needed.

The pattern is well-established from Phase 12.5. Adding sub-namespaces is mechanical. The discipline: each sub-namespace is its own scope, consumed via optional chaining. No collisions, no implicit defaults that surprise.

### The state-machine interpreter changes once

Array-of-effects — now slated for Phase 13b, since 13a's consumers were satisfiable with composites and the change waits for hitlag, its first genuine forcing consumer. After that, probably no more interpreter changes through Phase 20. The interpreter has been remarkably stable — 13a added a cross-fighter system, six conditions, and three effects without touching it; the discipline of "data over code" has held.

### Hit detection becomes the largest system

Starts simple in 13. Grows in 14b (multihit/sweet-sour), 15 (i-frame windows), 16 (shield blocks hits with damage absorption), 17 (grab can't be hit normally during grab), 18a (projectiles), 19 (KO from off-stage). By Phase 19, hitDetectionSystem is probably ~200-400 lines and the engine's heaviest. Worth budgeting for documentation and possibly internal refactoring around Phase 17 or 18.

### Physics gains complexity at specific phases

15 adds roll motion. 17 adds grab attachment (a fighter follows another fighter's position — fundamentally different from any current motion). 18a adds projectile motion. Each addition should be a self-contained primitive that doesn't disrupt existing modes.

### Sound and animation hooks

Not phases on their own. Sound: triggers on transitions via effects (free once array-of-effects ships in Phase 13). Animation: state-to-animation mapping that doesn't exist yet — render-side substrate that probably accumulates as a polish concern. Worth flagging now: the engine is ready to accept sound effects via the existing effect system, no substrate change needed. Animation will need its own substrate piece (state-to-clip mapping plus interpolation state) when it arrives.

### Determinism must hold

The current engine is deterministic — no `Math.random()` or `Date.now()` in tick. Some additions tempt non-determinism:
- Knockback formulas with random angle variation (Melee's "DI bias") — keep deterministic, use hit-frame-derived pseudo-randomness if variation is wanted
- Particle effects — rendered, not simulated, so OK to be non-deterministic
- Item spawning — when items spawn from boxes, the choice should be deterministic from game state (so replays are exact)

The "tick is pure function of (world, inputs)" property is load-bearing for the engine's long-term properties (replays, netcode if it ever happens, determinism testing). Worth checking each phase that the discipline holds.

### Retros compound

Phase 12's retro was substantial. Phase 13's will be more so (new system, new patterns). Phase 17's will be the largest (inter-fighter coupling is the biggest architectural shift remaining). Worth budgeting time explicitly — each phase's effective scope is "the work plus the retro."

The retro discipline is what makes this project documentable for future contributors. Every phase that ships without a retro loses information.

---

## Discipline that needs to keep holding

The patterns from Phase 12 that should carry into the back half.

**Substrate over features.** No `function executeShield()` or `function resolveGrab()`. Every system reads data, writes data, runs as a stateless step in the tick. The temptation grows with each new system; the discipline shouldn't bend.

**Single-consumer pieces stay specifically named.** 13a shipped `applyHitReaction` with one consumer pattern (the universal `hitTaken` transition); its name says what it does, not what it might someday generalize to. The name shouldn't try to be generic. When 14b adds multihit-specific variants and 17 adds throw-knockback variants, the question of extraction becomes answerable with concrete consumers in hand.

**Data lives in the right layer.** Phase 12.5 established the layer hierarchy: state-data for action shape, character-data for character tuning. Stage-data for stage shape. Runtime fields for per-frame state. Each new field should be placed deliberately; "where does this belong" is a question worth asking, not a default.

**Investigate existing primitives before adding new ones.** The DashAttack pivot effect "would be needed" until physicsSystem.js was read. Combat substrate emerged smaller than expected because the existing engine composed well. Every new phase should start by checking what's already there.

**Forward-compatible shapes when the future is named.** Phase 12 designed for c-stick before c-stick existed. Phase 13 should design hit detection knowing projectiles and grabs are coming. Phase 14 should design landing-lag knowing shield-as-state arrives in 16. Forward-thinking for named future surfaces is cheap and right.

**Substrate bugs are latent until consumers exist.** Phase 12 found the air-mode facing bug after eight phases of inert wrongness. Other latent bugs likely exist in places where similar-shaped handlers copy-pasted lines. Be alert when a new consumer behaves unexpectedly that the substrate underneath might be the issue, not the new code.

**Repetition is not a refactoring target.** Twenty states needing `hitTaken` transitions is just twenty entries, not a candidate for extraction. The state machine doesn't do "global transitions" and shouldn't; the explicitness is the feature.

---

## Closing note

This document will need updates. Phases will reveal substrate questions not anticipated here. New deferrals will emerge. The shape of the back half is sketched, not solved.

The intent is that opening this document at the start of a phase gives Claude or the project lead enough context to recognize what's coming, identify what they'll need to design, and avoid the path-of-least-resistance solutions that would make later phases harder. Each phase's retrospective should update or annotate this document with what actually happened, what was different, and what new questions emerged.

The first half was an engine for movement. The second half is an engine for combat, interaction, and a complete fighting game. The substrate pattern that got us here should carry us through.

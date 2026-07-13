// hitDetectionSystem.js — Resolves attacker hitboxes against victim
// hurtboxes, writing the result to victim.pendingHit.
//
// Phase 13 step 3. The first cross-fighter interaction system in the
// engine — every prior system iterates fighters independently. The
// substrate is deliberately kept simple and self-contained: AABB and
// world-space-transform helpers live in this file rather than being
// abstracted into a shared geometry module, because Phase 17 (grab)
// and Phase 18 (projectiles) will each own their own contact-
// resolution flow with different result semantics (Grabbed state
// transition vs new pendingHit; entity-vs-fighter vs fighter-vs-
// fighter). Premature abstraction would force a shape on those
// systems before we know what shape they actually need.
//
// Tick position: AFTER collisionSystem. Hit detection tests overlap
// against final resolved positions. Running before collision would
// test pre-clamp positions — fighters mid-jump-into-platform would
// use their unresolved positions, producing false negatives on
// edge-of-platform contact and false positives mid-clip.
//
// Result of a hit:
//   - victim.pendingHit is set to a self-contained snapshot of the
//     hitbox's combat fields plus the attacker's positional index.
//     Self-contained (not a reference to the live hitbox object)
//     because character config is read-only-by-convention and
//     pendingHit represents a moment-in-time event with its own
//     lifetime, separable from the attack that produced it.
//   - attacker.hitConnected gains the victim's index, preventing
//     subsequent frames of the same active window from re-writing.
//
// The 1-frame lag between detection (end of tick N) and the state
// machine consuming pendingHit (start of tick N+1) is intentional.
// At 60Hz it's invisible. Trying to resolve hits immediately would
// require either reordering tick stages or running the state machine
// twice per tick — both introduce subtle ordering bugs.
//
// pendingHit is NOT cleared by this system. Step 3 has no consumer;
// the latest hit wins by overwrite. Step 4 (Knockback) will
// introduce the hitTaken transition's effect, which reads pendingHit
// and clears it on consumption.
//
// hitConnected reset semantics (hit-detection-internal scratchpad):
//
//   Reset condition: attacker.stateFrame === 0 AND attacker has
//   hitboxes for the current state.
//
//   Why this works: the state machine sets stateFrame to 0 on
//   transition and physics/collision/hit-detection all run before
//   the next stateSystem call increments it. So at hit-detection
//   time on the entry tick, stateFrame is 0 — this maps cleanly to
//   "the fighter just entered this state." On the SECOND tick of
//   that state, stateFrame is 1 — no reset, the in-progress attack's
//   hit record is preserved across its active window.
//
//   Why it's not a state-machine effect: hitConnected is never read
//   by any condition. Other reset counters (airJumpsUsed) ARE read
//   by conditions (canAirJump), so their resets must be visible to
//   the state machine via effects. hitConnected has no such
//   consumer, so the system that owns the field owns its lifecycle.
//   This also avoids editing ~20 attack-entry transitions and
//   compositing with existing facing-commit effects.
//
// Intangibility: a victim whose state has physics.intangible === true
// is skipped entirely — no hurtbox lookup, no AABB check, no
// pendingHit write. This is the second consumer of the Phase 11
// flag (the hurtbox debug viz being the first).
//
// First-overlap-wins ordering: the algorithm iterates the attacker's
// hitbox list in declaration order; for each active hitbox, iterates
// the victim's hurtbox list in declaration order. The first overlap
// found writes pendingHit and breaks both loops for that victim.
// This means authors can order hitboxes meaningfully — sweetspot
// before sourspot, etc. — to control which hitbox "wins" when both
// would overlap. Forward-compat for Phase 14b sweet/sour authoring.

export function hitDetectionSystem(world) {
  const fighters = world.fighters;

  for (let aIdx = 0; aIdx < fighters.length; aIdx++) {
    const attacker = fighters[aIdx];
    const attackerHitboxes =
      attacker.config.attacks?.[attacker.actionState]?.hitboxes;

    // Reset hitConnected on the entry tick of any state that has
    // hitboxes. Done BEFORE the no-hitboxes early-out so that even
    // an authored state with an active window starting at stateFrame
    // > 0 still gets a clean record on entry. A no-op on states
    // without hitboxes (no record to clear) — but we early-out
    // anyway right after to skip the inner loops.
    if (attacker.stateFrame === 0 && attackerHitboxes) {
      attacker.hitConnected.clear();
    }

    if (!attackerHitboxes) continue;

    for (let vIdx = 0; vIdx < fighters.length; vIdx++) {
      if (vIdx === aIdx) continue;
      if (attacker.hitConnected.has(vIdx)) continue;

      const victim = fighters[vIdx];
      const victimState = world.states[victim.actionState];
      if (victimState?.physics?.intangible === true) continue;

      const victimHurtboxes =
        victim.config.hurtboxes?.[victim.actionState]
        ?? victim.config.hurtboxes?.default;
      if (!victimHurtboxes) continue;

      // First overlap wins. The `hit` flag breaks out of both inner
      // loops without relying on labeled-break syntax — the inner
      // loop signals upward via the flag, the outer loop checks it
      // after each iteration.
      let hit = false;
      for (const hb of attackerHitboxes) {
        if (!isHitboxActive(hb, attacker.stateFrame)) continue;
        const hbRect = worldRect(attacker, hb.shape);

        for (const hx of victimHurtboxes) {
          const hxRect = worldRect(victim, hx.shape);
          if (aabbOverlap(hbRect, hxRect)) {
            victim.pendingHit = {
              attackerIndex:   aIdx,
              attackerFacing:  attacker.facing,
              damage:          hb.damage,
              angle:           hb.angle,
              baseKnockback:   hb.baseKnockback,
              knockbackGrowth: hb.knockbackGrowth,
              hitstun:         hb.hitstun,
            };
            attacker.hitConnected.add(vIdx);
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
    }
  }
}

// active is [firstFrame, lastFrame] inclusive. Matches the same check
// in debug/hitboxes.js — kept inline here so the system is self-
// contained (no shared dependency on the debug module).
function isHitboxActive(hb, stateFrame) {
  return stateFrame >= hb.active[0] && stateFrame <= hb.active[1];
}

// World-space center-anchored rect for AABB intersection. Same
// transform as debug/hitboxes.js and debug/hurtboxes.js use for
// rendering: facing-mirror on shape.x, additive shape.y, w/h
// unchanged. The debug viz needs bottom-left corner + dimensions for
// fillRect; this returns center-anchored because that's the natural
// shape for |dx| < (w1+w2)/2 AABB math. Same convention, different
// layout for the caller's needs.
//
// Three call sites now use this transform (two viz + this system).
// At a fourth, extract to core/geometry.js. Until then, duplication
// is cheap and keeps each module independently readable.
function worldRect(fighter, shape) {
  return {
    cx: fighter.x + fighter.facing * shape.x,
    cy: fighter.y + shape.y,
    w:  shape.w,
    h:  shape.h,
  };
}

// AABB overlap for center-anchored rectangles. Strict less-than:
// coincident edges (touching but not overlapping interiors) do not
// count as a hit. In practice the rectangles are positioned by
// floating-point math, so exact-edge equality is statistically rare;
// the strict-vs-non-strict distinction is documentation of intent
// more than a behavioral lever.
function aabbOverlap(a, b) {
  return (
    Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 &&
    Math.abs(a.cy - b.cy) < (a.h + b.h) / 2
  );
}

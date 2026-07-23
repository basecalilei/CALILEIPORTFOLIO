// blastZoneSystem.js — KO detection against the stage's blast zones.
//
// Checks each fighter's anchor point against stage.blastZones and writes
// fighter.pendingKO = true on a crossing. That's the whole job: this
// system DETECTS, it does not respawn. The state machine consumes the
// flag next tick through the kOd condition (first transition of every
// state) and runs the respawn effect — the same detect-flag-consume
// shape as hitDetectionSystem → hitTaken → applyHitReaction, and for
// the same reason: the detection needs world-level data (the stage)
// that conditions can't see, but state changes belong to the machine,
// never to a system.
//
// The 1-frame lag between flag and respawn is intentional and
// harmless: the fighter spends one more tick flying away off-screen
// before the machine consumes the flag. (pendingKO is idempotent — a
// second detection tick just rewrites true.)
//
// Anchor-point semantics: the fighter is KO'd when their bottom-center
// anchor crosses the boundary, not when the body fully exits. Simple,
// and consistent with how the anchor stands in for the fighter
// everywhere else. Crossing ANY side kills — a Melee simplification
// (real Melee's upper blast zone has knockback-dependent rules); if
// that nuance ever matters it lives here.
//
// Runs after collision (positions are final) and after hitDetection —
// the KO is the frame's last verdict. A pendingHit written this same
// tick is discarded by the respawn effect: you can't be launched out
// of death.

export function blastZoneSystem(world) {
  const bz = world.stage.blastZones;
  if (!bz) return;

  for (const fighter of world.fighters) {
    if (
      fighter.x < bz.left ||
      fighter.x > bz.right ||
      fighter.y < bz.top ||
      fighter.y > bz.bottom
    ) {
      fighter.pendingKO = true;
    }
  }
}

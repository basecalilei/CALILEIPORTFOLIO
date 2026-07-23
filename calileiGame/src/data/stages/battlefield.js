// battlefield.js — Stage geometry as pure data.
//
// Two collections, two collision behaviors:
//
//   solids     — axis-aligned rectangles. Cannot be passed through from
//                any side. Top is landable (zero vy on hit, grounded=true),
//                bottom causes head-bump (zero vy on hit, grounded=false),
//                sides stop horizontal motion (zero vx on hit, no state
//                change). For Battlefield: the main floor.
//
//   platforms  — one-way horizontal lines. Stop downward motion when
//                landing from above. Pass through from below, from the
//                sides, or by drop-through (Phase 9). For Battlefield:
//                the three suspended soft platforms.
//
// Coordinate convention: Y-down, origin top-left. solid.top is the
// smaller y; solid.bottom is the larger y.
//
// blastZones describes the kill-box surrounding the stage. Read by
// blastZoneSystem: an anchor point outside this rect flags the fighter
// for KO/respawn. Note bottom (640) equals the main floor's bottom — a
// fighter standing on the stage is inside the box; only leaving the
// stage's airspace crosses it.

export const battlefield = {
  solids: [
    // Main floor — fills the space below y=400, reaching down to the
    // bottom blast zone. Width matches the original main platform.
    { top: 400, bottom: 640, left: 180, right: 780 },
  ],

  platforms: [
    // Left soft platform.
    { y: 280, x1: 240, x2: 380 },
    // Right soft platform.
    { y: 280, x1: 580, x2: 720 },
    // Top soft platform.
    { y: 180, x1: 400, x2: 560 },
  ],

  blastZones: {
    left: -100,
    right: 1060,
    top: -100,
    bottom: 640,
  },
};

/* ==========================================================================
   desktopSubstrateSim.js — the substrate's behavior substrate.
   (desktopPanel family — sub-module of desktopSubstrate.js)

   A "pool" is a cluster of invisible blob centers crawling on the unit
   sphere. The renderer (desktopSubstrateScene.js) turns them into one
   hard-edged shape by thresholding a summed field, so everything
   liquid-looking — pooling, fusing, necking, snapping apart — is
   produced HERE, by how the centers move, not by anything drawn.

   PORTED from the standalone substrate project's sphereSim.js, kept
   byte-close on purpose so upstream improvements diff cleanly. The
   full port delta:
     1. IIFE + window.SphereSim  →  ES module with named exports.
     2. THREE arrives via the site importmap (the standalone loaded
        r128 from a script tag; the site pins 0.160).
     3. PoolSim honors opts.visible (one line, marked PORT) so the
        window's session snapshot can restore hidden pools.
   Everything else — schema, forces, integration — is verbatim.
   ========================================================================== */
import * as THREE from "three";

var MAX_BLOBS = 16;
var MAX_POOLS = 4; // per sphere — each pool is two hemisphere draws

/* One schema drives the simulation, the shader uniforms, the control
   panel, and the randomize button. `rand` is the range randomize draws
   from when it should be narrower than the slider itself. `fmt` is the
   number of decimals shown in the readout. */
var POOL_PARAMS = [
  { key: 'blobCount',    label: 'Blobs',          min: 1,    max: MAX_BLOBS, step: 1,    def: 7,    rand: [3, 12],      fmt: 0 },
  { key: 'blobSize',     label: 'Blob size',      min: 0.08, max: 0.9,  step: 0.01, def: 0.38, rand: [0.16, 0.58], fmt: 2 },
  { key: 'sizeVariance', label: 'Size variance',  min: 0,    max: 1,    step: 0.01, def: 0.35,                     fmt: 2 },
  { key: 'pulse',        label: 'Pulse',          min: 0,    max: 0.6,  step: 0.01, def: 0.12, rand: [0, 0.4],     fmt: 2 },
  { key: 'spread',       label: 'Spread',         min: 0.1,  max: 1.6,  step: 0.01, def: 0.7,  rand: [0.25, 1.2],  fmt: 2 },
  { key: 'cohesion',     label: 'Cohesion',       min: 0,    max: 2,    step: 0.01, def: 0.8,  rand: [0.3, 1.6],   fmt: 2 },
  { key: 'separation',   label: 'Separation',     min: 0,    max: 2,    step: 0.01, def: 0.5,                     fmt: 2 },
  { key: 'wander',       label: 'Wander',         min: 0,    max: 2,    step: 0.01, def: 0.9,  rand: [0.2, 1.6],   fmt: 2 },
  { key: 'swirl',        label: 'Swirl',          min: -2,   max: 2,    step: 0.01, def: 0.3,                     fmt: 2 },
  { key: 'speed',        label: 'Speed',          min: 0,    max: 2,    step: 0.01, def: 0.6,  rand: [0.2, 1.4],   fmt: 2 },
  { key: 'tension',      label: 'Surface tension',min: 0.2,  max: 1.4,  step: 0.01, def: 0.65, rand: [0.35, 1.1],  fmt: 2 },
  { key: 'cling',        label: 'Cling',          min: 0.4,  max: 2.4,  step: 0.01, def: 1.0,  rand: [0.6, 1.8],   fmt: 2 },
  { key: 'wobble',       label: 'Edge wobble',    min: 0,    max: 0.5,  step: 0.01, def: 0.12, rand: [0, 0.3],     fmt: 2 },
  { key: 'wobbleScale',  label: 'Wobble scale',   min: 0.5,  max: 8,    step: 0.1,  def: 3,                       fmt: 1 },
  { key: 'wobbleSpeed',  label: 'Wobble speed',   min: 0,    max: 2,    step: 0.01, def: 0.5,                     fmt: 2 },
  { key: 'opacity',      label: 'Opacity',        min: 0.05, max: 1,    step: 0.01, def: 1,    rand: [0.55, 1],    fmt: 2 }
];

/* ---------------------------------------------------------------- utils */

function rand(min, max) { return min + Math.random() * (max - min); }

function snapToStep(value, def) {
  var steps = Math.round((value - def.min) / def.step);
  var v = def.min + steps * def.step;
  return Math.min(def.max, Math.max(def.min, v));
}

function randomUnitVector(target) {
  var v = target || new THREE.Vector3();
  do {
    v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1));
  } while (v.lengthSq() < 1e-4 || v.lengthSq() > 1);
  return v.normalize();
}

/* A random point biased toward the camera-facing hemisphere, so a fresh
   pool is visible immediately instead of spawning behind the sphere. */
function frontBiasedPoint(target) {
  var v = randomUnitVector(target);
  v.z = Math.abs(v.z) + 0.5;
  return v.normalize();
}

function hslToHex(h, s, l) {
  var a = s * Math.min(l, 1 - l);
  function f(n) {
    var k = (n + h * 12) % 12;
    var c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  }
  return '#' + f(0) + f(8) + f(4);
}

/* Saturated, mid-value colors that hold a hard edge against white. */
function randomPoolColor() {
  return hslToHex(Math.random(), rand(0.6, 0.95), rand(0.36, 0.56));
}

/* Scratch vectors — reused every frame so the sim allocates nothing. */
var _centroid = new THREE.Vector3();
var _f = new THREE.Vector3();
var _t = new THREE.Vector3();
var _t2 = new THREE.Vector3();

function tangentProject(v, p) {
  // Remove the radial component of v at surface point p.
  return v.addScaledVector(p, -v.dot(p));
}

/* ---------------------------------------------------------------- blobs */

function makeBlob(center, spread) {
  var p = randomUnitVector(new THREE.Vector3());
  tangentProject(p, center);
  if (p.lengthSq() < 1e-6) {
    p.set(-center.y, center.x, 0);
    if (p.lengthSq() < 1e-6) p.set(1, 0, 0); // center on the z axis
  }
  p.normalize();
  var offset = rand(0, Math.max(0.05, spread * 0.5));
  p.multiplyScalar(Math.sin(offset)).addScaledVector(center, Math.cos(offset)).normalize();

  var v = randomUnitVector(new THREE.Vector3());
  tangentProject(v, p).multiplyScalar(rand(0, 0.15));

  return {
    p: p,
    v: v,
    r: 0.3,                       // effective radius, recomputed each frame
    seed: Math.random(),          // stable per-blob size factor
    pulsePhase: rand(0, Math.PI * 2),
    pulseRate: rand(0.5, 1.1),
    // Smooth pseudo-random wander: three sine channels per blob.
    wf: [rand(0.25, 1.2), rand(0.25, 1.2), rand(0.25, 1.2)],
    wp: [rand(0, Math.PI * 2), rand(0, Math.PI * 2), rand(0, Math.PI * 2)]
  };
}

/* -------------------------------------------------------------- PoolSim */

var _nextId = 1;

function PoolSim(opts) {
  opts = opts || {};
  this.id = _nextId++;
  this.name = opts.name || 'Pool ' + this.id;
  this.color = opts.color || randomPoolColor();
  /* PORT: opts.visible lets a session snapshot restore hidden pools
     (the standalone always booted pools visible). */
  this.visible = opts.visible !== false;

  /* Schema defaults, then any overrides from opts.params. Applied
     before reseed() below so blobCount and spread shape the very first
     cluster rather than being corrected a frame later. Unknown keys are
     ignored — the schema is the only contract. */
  this.params = {};
  for (var i = 0; i < POOL_PARAMS.length; i++) {
    var d = POOL_PARAMS[i];
    this.params[d.key] = d.def;
  }
  if (opts.params) {
    for (var k in opts.params) {
      if (Object.prototype.hasOwnProperty.call(this.params, k) &&
          opts.params[k] != null) {
        this.params[k] = opts.params[k];
      }
    }
  }

  this.swirlAxis = randomUnitVector(new THREE.Vector3());
  this.blobs = [];
  this.reseed(opts.centroid || null);
}

/* Scatter all blobs into a fresh cluster around `center`. */
PoolSim.prototype.reseed = function (center) {
  var c = center || frontBiasedPoint(_t);
  this.blobs.length = 0;
  for (var i = 0; i < this.params.blobCount; i++) {
    this.blobs.push(makeBlob(c, this.params.spread));
  }
};

PoolSim.prototype.centroid = function (target) {
  var c = target.set(0, 0, 0);
  for (var i = 0; i < this.blobs.length; i++) c.add(this.blobs[i].p);
  if (c.lengthSq() < 1e-6) c.copy(this.blobs[0].p);
  return c.normalize();
};

PoolSim.prototype.setParam = function (key, value) {
  this.params[key] = value;
  if (key === 'blobCount') this.syncCount();
};

/* Grow or shrink the blob list in place, without disturbing the rest. */
PoolSim.prototype.syncCount = function () {
  var want = Math.round(this.params.blobCount);
  if (this.blobs.length > want) {
    this.blobs.length = want;
  } else if (this.blobs.length < want) {
    var c = this.blobs.length ? this.centroid(_t) : frontBiasedPoint(_t);
    while (this.blobs.length < want) {
      this.blobs.push(makeBlob(c, this.params.spread));
    }
  }
};

PoolSim.prototype.randomize = function () {
  for (var i = 0; i < POOL_PARAMS.length; i++) {
    var d = POOL_PARAMS[i];
    var r = d.rand || [d.min, d.max];
    this.params[d.key] = snapToStep(rand(r[0], r[1]), d);
  }
  this.color = randomPoolColor();
  randomUnitVector(this.swirlAxis);
  this.reseed(null);
};

PoolSim.prototype.radiusOf = function (blob, t) {
  var P = this.params;
  var base = P.blobSize * (1 - P.sizeVariance * 0.7 * blob.seed);
  var pulse = 1 + P.pulse * 0.35 * Math.sin(t * blob.pulseRate + blob.pulsePhase);
  return Math.max(0.02, base * pulse);
};

/* One integration step. dt is already scaled by the global sim speed. */
PoolSim.prototype.update = function (dt, t) {
  var P = this.params;
  var blobs = this.blobs;
  var n = blobs.length;
  if (n === 0 || dt <= 0) return;

  var i, j, b;

  for (i = 0; i < n; i++) blobs[i].r = this.radiusOf(blobs[i], t);

  var centroid = this.centroid(_centroid);
  var ringR = P.spread * 0.45; // blobs spring toward a ring around the centroid
  var forceScale = 0.5 + P.speed * 1.3;
  var maxV = 0.12 + P.speed * 1.1;
  var damping = Math.exp(-1.6 * dt);

  for (i = 0; i < n; i++) {
    b = blobs[i];
    _f.set(0, 0, 0);

    /* Cohesion — a spring toward the cluster. Pulled in when strays too
       far, nudged out when crowding the exact center: the pool spreads
       instead of collapsing to a dot. */
    _t.copy(centroid).sub(b.p);
    tangentProject(_t, b.p);
    if (_t.lengthSq() > 1e-8) {
      var angToC = Math.acos(Math.min(1, Math.max(-1, b.p.dot(centroid))));
      _t.normalize();
      _f.addScaledVector(_t, P.cohesion * 1.8 * (angToC - ringR));
    }

    /* Wander — smooth per-blob noise. This is what keeps the mass
       redrawing itself instead of settling. */
    _t.set(
      Math.sin(t * b.wf[0] + b.wp[0]),
      Math.sin(t * b.wf[1] + b.wp[1]),
      Math.sin(t * b.wf[2] + b.wp[2])
    );
    tangentProject(_t, b.p);
    _f.addScaledVector(_t, P.wander * 0.9);

    /* Swirl — a steady vector field circling this pool's private axis. */
    _t.crossVectors(this.swirlAxis, b.p);
    _f.addScaledVector(_t, P.swirl * 0.7);

    b.v.addScaledVector(_f, dt * forceScale);
  }

  /* Separation — pairwise pushes where blobs overlap. Together with
     cohesion this is the fuse / neck / snap-apart cycle. */
  if (P.separation > 0 && n > 1) {
    for (i = 0; i < n; i++) {
      for (j = i + 1; j < n; j++) {
        var a = blobs[i], c = blobs[j];
        var ang = Math.acos(Math.min(1, Math.max(-1, a.p.dot(c.p))));
        var minD = (a.r + c.r) * 0.5;
        if (ang < minD && ang > 1e-5) {
          var push = P.separation * 2 * (minD - ang) / minD;
          _t.copy(a.p).sub(c.p);
          tangentProject(_t2.copy(_t), a.p);
          if (_t2.lengthSq() > 1e-10) a.v.addScaledVector(_t2.normalize(), push * dt * forceScale);
          tangentProject(_t2.copy(_t).negate(), c.p);
          if (_t2.lengthSq() > 1e-10) c.v.addScaledVector(_t2.normalize(), push * dt * forceScale);
        }
      }
    }
  }

  /* Integrate on the sphere. */
  for (i = 0; i < n; i++) {
    b = blobs[i];
    b.v.multiplyScalar(damping);
    tangentProject(b.v, b.p);
    var sp = b.v.length();
    if (sp > maxV) b.v.multiplyScalar(maxV / sp);
    b.p.addScaledVector(b.v, dt).normalize();
    tangentProject(b.v, b.p);
  }
};

/* Copy state into the shader's vec4 array: xyz = direction, w = radius. */
PoolSim.prototype.writeUniforms = function (vec4Array) {
  var n = Math.min(this.blobs.length, vec4Array.length);
  for (var i = 0; i < n; i++) {
    var b = this.blobs[i];
    vec4Array[i].set(b.p.x, b.p.y, b.p.z, b.r);
  }
  for (var k = n; k < vec4Array.length; k++) vec4Array[k].set(0, 0, 1, 0);
  return n;
};

export { MAX_BLOBS, MAX_POOLS, POOL_PARAMS, PoolSim, randomPoolColor };

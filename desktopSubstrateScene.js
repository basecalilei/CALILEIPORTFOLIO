/* ==========================================================================
   desktopSubstrateScene.js — the substrate's rendering substrate.
   (desktopPanel family — sub-module of desktopSubstrate.js)

   Nothing here is lit and no sphere surface is ever drawn. The stage
   holds concentric translucent sphere layers; each pool on a layer is
   TWO draws of a shared unit-sphere mesh — the far hemisphere (back
   faces, seen through the glass) and the near hemisphere (front faces).
   The fragment shader sums a spherical metaball field from the pool's
   blob centers and thresholds it: flat color where the field clears the
   surface tension, nothing everywhere else.

   Correct see-through blending is pure painter's order, recomposed every
   frame: back hemispheres outermost-first, then front hemispheres
   innermost-first. Nothing writes depth, so radii can cross freely.

   PORTED from the standalone substrate project's sphereScene.js, kept
   byte-close so upstream improvements diff cleanly. The full port
   delta (each site marked PORT inline):
     1. IIFE + window.SphereStage  →  ES module; THREE via the site
        importmap (0.160), MAX_BLOBS imported from the sim module.
     2. The constructor no longer owns a clock, an animation loop, or
        a window resize listener — the HOST (desktopSubstrate.js)
        drives tick(dt) and resize(); liveness and the resize channel
        are its concern, not the stage's.
     3. tick(dt) takes host-supplied seconds (the 50ms clamp stays).
     4. extensions.derivatives dropped — core GLSL under WebGL2.
     5. dispose() added — a window closes; the standalone never did.
     6. Pool colors are stored RAW — r152+ color management otherwise
        converts CSS hex into the linear working space, and this raw
        shader never converts back, so every pool rendered darker
        than its swatch (see setRawColor).
   Everything else — shaders, layers, painter's order — is verbatim.
   ========================================================================== */
import * as THREE from "three";
import { MAX_BLOBS } from "./desktopSubstrateSim.js";

var MAX_SPHERES = 4;

/* Layer-level schema, consumed by the control panel like POOL_PARAMS. */
var SPHERE_PARAMS = [
  { key: 'radius',      label: 'Radius',       min: 0.25, max: 1,  step: 0.01, def: 1, fmt: 2 },
  { key: 'spin',        label: 'Spin \u00D7',  min: -2,   max: 2,  step: 0.01, def: 1, fmt: 2 },
  { key: 'tiltOffset',  label: 'Tilt offset',  min: -45,  max: 45, step: 1,    def: 0, fmt: 0, unit: '\u00B0' },
  { key: 'backOpacity', label: 'Back side',    min: 0,    max: 1,  step: 0.01, def: 1, fmt: 2 }
];

var VERTEX_SHADER = [
  'varying vec3 vPos;',
  'void main() {',
  '  vPos = position;',
  '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
  '}'
].join('\n');

/* Ashima / Ian McEwan simplex noise (webgl-noise, MIT). Drives the
   edge wobble that keeps outlines from ever holding still. */
var NOISE_GLSL = [
  'vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }',
  'vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }',
  'vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }',
  'vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }',
  'float snoise(vec3 v) {',
  '  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);',
  '  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);',
  '  vec3 i = floor(v + dot(v, C.yyy));',
  '  vec3 x0 = v - i + dot(i, C.xxx);',
  '  vec3 g = step(x0.yzx, x0.xyz);',
  '  vec3 l = 1.0 - g;',
  '  vec3 i1 = min(g.xyz, l.zxy);',
  '  vec3 i2 = max(g.xyz, l.zxy);',
  '  vec3 x1 = x0 - i1 + C.xxx;',
  '  vec3 x2 = x0 - i2 + C.yyy;',
  '  vec3 x3 = x0 - D.yyy;',
  '  i = mod289(i);',
  '  vec4 p = permute(permute(permute(',
  '        i.z + vec4(0.0, i1.z, i2.z, 1.0))',
  '      + i.y + vec4(0.0, i1.y, i2.y, 1.0))',
  '      + i.x + vec4(0.0, i1.x, i2.x, 1.0));',
  '  float n_ = 0.142857142857;',
  '  vec3 ns = n_ * D.wyz - D.xzx;',
  '  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);',
  '  vec4 x_ = floor(j * ns.z);',
  '  vec4 y_ = floor(j - 7.0 * x_);',
  '  vec4 x = x_ * ns.x + ns.yyyy;',
  '  vec4 y = y_ * ns.x + ns.yyyy;',
  '  vec4 h = 1.0 - abs(x) - abs(y);',
  '  vec4 b0 = vec4(x.xy, y.xy);',
  '  vec4 b1 = vec4(x.zw, y.zw);',
  '  vec4 s0 = floor(b0) * 2.0 + 1.0;',
  '  vec4 s1 = floor(b1) * 2.0 + 1.0;',
  '  vec4 sh = -step(h, vec4(0.0));',
  '  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;',
  '  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;',
  '  vec3 p0 = vec3(a0.xy, h.x);',
  '  vec3 p1 = vec3(a0.zw, h.y);',
  '  vec3 p2 = vec3(a1.xy, h.z);',
  '  vec3 p3 = vec3(a1.zw, h.w);',
  '  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));',
  '  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;',
  '  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);',
  '  m = m * m;',
  '  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));',
  '}'
].join('\n');

var FRAGMENT_SHADER = [
  'uniform vec4 uBlobs[' + MAX_BLOBS + '];', // xyz = direction, w = angular radius
  'uniform int uCount;',
  'uniform vec3 uColor;',
  'uniform float uOpacity;',
  'uniform float uThreshold;',   // surface tension
  'uniform float uFalloff;',     // 1 / cling — kernel exponent
  'uniform float uWobAmp;',
  'uniform float uWobScale;',
  'uniform float uWobSpeed;',
  'uniform float uTime;',
  'varying vec3 vPos;',
  NOISE_GLSL,
  'void main() {',
  '  vec3 p = normalize(vPos);',
  '  float field = 0.0;',
  '  for (int i = 0; i < ' + MAX_BLOBS + '; i++) {',
  '    if (i >= uCount) break;',
  '    vec4 b = uBlobs[i];',
  '    float ang = acos(clamp(dot(p, b.xyz), -1.0, 1.0));',
  '    float x = ang / max(b.w, 1e-4);',
  '    float k = 1.0 - x * x;',
  '    if (k > 0.0) field += pow(k * k, uFalloff);',
  '  }',
  /* Wobble is gated by the field itself: full strength at the visible
     edge, zero where there is no pool — so outlines never hold still
     but empty white space stays perfectly empty. */
  '  if (uWobAmp > 0.0 && field > 0.0) {',
  '    float n = snoise(p * uWobScale + vec3(0.13, 0.29, 0.17) * (uTime * uWobSpeed));',
  '    field += uWobAmp * n * smoothstep(0.0, uThreshold, field);',
  '  }',
  /* Hard edge, antialiased over exactly one pixel of field gradient. */
  '  float w = fwidth(field) + 1e-4;',
  '  float alpha = smoothstep(uThreshold - w, uThreshold + w, field) * uOpacity;',
  '  if (alpha <= 0.003) discard;',
  '  gl_FragColor = vec4(uColor, alpha);',
  '}'
].join('\n');

/* PORT: color pass-through. three r152+ enables color management by
   default: new THREE.Color('#hex') converts the hex into the LINEAR
   working space — correct for built-in materials, whose shaders
   convert back to sRGB on output, but THIS shader writes uColor to
   the canvas raw, so the conversion was never undone and every pool
   rendered darker than its swatch (r128, which the standalone runs,
   has no color management at all). Declaring the input as Linear-sRGB
   makes the conversion a no-op: the hex bytes land in the uniform
   untouched and the canvas shows exactly the CSS color — the r128
   pipeline, blending included. NOT fixed via
   ColorManagement.enabled = false, which is module-global: the scroll
   scenes share this three instance. */
function setRawColor(color, style) {
  return color.setStyle(style, THREE.LinearSRGBColorSpace);
}

function SphereStage(container) {
  this.container = container;

  this.renderer = new THREE.WebGLRenderer({ antialias: true });
  this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  this.renderer.setClearColor(0xffffff, 1);
  container.appendChild(this.renderer.domElement);

  this.scene = new THREE.Scene();
  this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  this.camera.position.set(0, 0, 4.6);

  this.sharedGeometry = new THREE.SphereGeometry(1, 128, 96);

  /* Layers: { params, tiltGroup, spinGroup, pools: [] }. Each pool
     record: { sim, frontMesh, backMesh, frontMaterial, backMaterial,
     shared, lastColor }. */
  this.spheres = [];

  this.global = { rotation: 0.25, tilt: 12, timeScale: 1, paused: false };
  this.simTime = 0;

  /* PORT: the standalone build owned its clock (THREE.Clock +
     renderer.setAnimationLoop) and resized against the viewport. In
     a desktop window the HOST owns both — it drives tick(dt) from
     its focus-gated rAF loop and calls resize() from a
     ResizeObserver, because windows resize by drag and the viewport
     'resize' event never fires for that. */
  this.resize();
}

SphereStage.prototype.resize = function () {
  var w = this.container.clientWidth || 1;
  var h = this.container.clientHeight || 1;
  this.camera.aspect = w / h;
  this.camera.updateProjectionMatrix();
  this.renderer.setSize(w, h);
};

/* ------------------------------------------------------------- layers */

SphereStage.prototype.addSphere = function (params) {
  if (this.spheres.length >= MAX_SPHERES) return null;

  var layer = {
    params: {},
    tiltGroup: new THREE.Group(),  // global tilt + this layer's offset
    spinGroup: new THREE.Group(),  // this layer's own rotation + radius
    pools: []
  };
  for (var i = 0; i < SPHERE_PARAMS.length; i++) {
    var d = SPHERE_PARAMS[i];
    layer.params[d.key] = (params && params[d.key] != null) ? params[d.key] : d.def;
  }
  layer.tiltGroup.add(layer.spinGroup);
  this.scene.add(layer.tiltGroup);
  this.spheres.push(layer);
  return layer;
};

SphereStage.prototype.removeSphere = function (layer) {
  var i = this.spheres.indexOf(layer);
  if (i === -1) return;
  while (layer.pools.length) this.removePool(layer, layer.pools[0].sim);
  this.scene.remove(layer.tiltGroup);
  this.spheres.splice(i, 1);
};

/* -------------------------------------------------------------- pools */

SphereStage.prototype.addPool = function (layer, sim) {
  var blobArray = [];
  for (var i = 0; i < MAX_BLOBS; i++) blobArray.push(new THREE.Vector4(0, 0, 1, 0));

  /* Front and back hemisphere materials share every uniform entry by
     reference except opacity, so state is written exactly once. */
  var shared = {
    uBlobs: { value: blobArray },
    uCount: { value: 0 },
    uColor: { value: setRawColor(new THREE.Color(), sim.color) }, // PORT: raw
    uThreshold: { value: 0.65 },
    uFalloff: { value: 1 },
    uWobAmp: { value: 0 },
    uWobScale: { value: 3 },
    uWobSpeed: { value: 0.5 },
    uTime: { value: 0 }
  };

  function makeMaterial(side) {
    var m = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: Object.assign({ uOpacity: { value: 1 } }, shared),
      transparent: true,
      depthWrite: false,
      side: side
    });
    /* PORT: r128 needed extensions.derivatives for fwidth(); three
       0.160 renders under WebGL2, where derivatives are core GLSL. */
    return m;
  }

  var backMaterial = makeMaterial(THREE.BackSide);   // far hemisphere, seen through
  var frontMaterial = makeMaterial(THREE.FrontSide); // near hemisphere

  var backMesh = new THREE.Mesh(this.sharedGeometry, backMaterial);
  var frontMesh = new THREE.Mesh(this.sharedGeometry, frontMaterial);
  layer.spinGroup.add(backMesh);
  layer.spinGroup.add(frontMesh);

  layer.pools.push({
    sim: sim,
    frontMesh: frontMesh, backMesh: backMesh,
    frontMaterial: frontMaterial, backMaterial: backMaterial,
    shared: shared, lastColor: ''
  });
};

SphereStage.prototype.removePool = function (layer, sim) {
  for (var i = 0; i < layer.pools.length; i++) {
    if (layer.pools[i].sim === sim) {
      var rec = layer.pools[i];
      layer.spinGroup.remove(rec.frontMesh);
      layer.spinGroup.remove(rec.backMesh);
      rec.frontMaterial.dispose();
      rec.backMaterial.dispose();
      layer.pools.splice(i, 1);
      return;
    }
  }
};

/* Painter's order across every translucent surface, recomputed each
   frame so radius sliders can cross layers freely: back hemispheres
   from outermost to innermost, then front hemispheres from innermost
   to outermost. Nothing writes depth, so this order alone decides
   compositing. */
SphereStage.prototype.composeOrder = function () {
  var byRadius = this.spheres.slice().sort(function (a, b) {
    return b.params.radius - a.params.radius;
  });
  var order = 0, i, j, layer;
  for (i = 0; i < byRadius.length; i++) {
    layer = byRadius[i];
    for (j = 0; j < layer.pools.length; j++) layer.pools[j].backMesh.renderOrder = order++;
  }
  for (i = byRadius.length - 1; i >= 0; i--) {
    layer = byRadius[i];
    for (j = 0; j < layer.pools.length; j++) layer.pools[j].frontMesh.renderOrder = order++;
  }
};

SphereStage.prototype.setGlobal = function (key, value) {
  this.global[key] = value;
};

/* --------------------------------------------------------------- tick */

/* One frame: advance by dt SECONDS (host-supplied) and render. The
   0.05 clamp below is the source's own — a long gap never becomes a
   lurch. tick(0) is a pure repaint: uniforms rewritten, nothing
   advanced — the host uses it for frame zero and idle resizes. */
SphereStage.prototype.tick = function (dt) {
  var effDt = this.global.paused ? 0 : Math.min(dt, 0.05) * this.global.timeScale;
  this.simTime += effDt;

  for (var i = 0; i < this.spheres.length; i++) {
    var layer = this.spheres[i];
    var LP = layer.params;

    layer.tiltGroup.rotation.z = (this.global.tilt + LP.tiltOffset) * Math.PI / 180;
    layer.spinGroup.scale.setScalar(LP.radius);
    layer.spinGroup.rotation.y += this.global.rotation * LP.spin * effDt;

    for (var j = 0; j < layer.pools.length; j++) {
      var rec = layer.pools[j];
      var sim = rec.sim;
      var P = sim.params;
      var u = rec.shared;

      if (effDt > 0) sim.update(effDt, this.simTime);

      rec.frontMesh.visible = sim.visible;
      rec.backMesh.visible = sim.visible;

      u.uCount.value = sim.writeUniforms(u.uBlobs.value);
      u.uThreshold.value = P.tension;
      u.uFalloff.value = 1 / Math.max(P.cling, 0.05);
      u.uWobAmp.value = P.wobble;
      u.uWobScale.value = P.wobbleScale;
      u.uWobSpeed.value = P.wobbleSpeed;
      u.uTime.value = this.simTime;
      if (rec.lastColor !== sim.color) {
        setRawColor(u.uColor.value, sim.color); // PORT: raw
        rec.lastColor = sim.color;
      }
      rec.frontMaterial.uniforms.uOpacity.value = P.opacity;
      rec.backMaterial.uniforms.uOpacity.value = P.opacity * LP.backOpacity;
    }
  }

  this.composeOrder();
  this.renderer.render(this.scene, this.camera);
};

/* PORT: teardown for a desktop-window lifetime. The standalone page
   never closes; a window does — and browsers cap live WebGL
   contexts, so the context is released explicitly rather than left
   to GC. The canvas itself leaves with the window's DOM. */
SphereStage.prototype.dispose = function () {
  while (this.spheres.length) {
    this.removeSphere(this.spheres[this.spheres.length - 1]);
  }
  this.sharedGeometry.dispose();
  this.renderer.dispose();
  this.renderer.forceContextLoss();
};

/* Exposed for inspection and testing. */
SphereStage.MAX_SPHERES = MAX_SPHERES;
SphereStage.SPHERE_PARAMS = SPHERE_PARAMS;
SphereStage.VERTEX_SHADER = VERTEX_SHADER;
SphereStage.FRAGMENT_SHADER = FRAGMENT_SHADER;

export { SphereStage };
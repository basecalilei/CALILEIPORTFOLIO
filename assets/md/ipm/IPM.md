# ///// I.P.M

IPM — *the Iso-Parametric Patterning Methodology* — is a new framework for pattern making that merges fashion design, computational geometry, and **artificial intelligence**.

> CAL.CALILEI // 2025

The system is built on the principles of 3D modeling, *conformal mapping*, and *surface parameterization*. It redefines how soft goods are engineered — moving beyond traditional drape-based workflows to a system of mathematically precise *zero forms*.

The approach produces patterns that are **free of surface distortion**, predictive of drape, and optimized for manufacturing.

---

## [ CONFORMAL.MAPPING ]

*the mathematical core of IPM*

A class of surface parameterization methods that preserve *angles* when flattening 3D geometry into 2D domains.

In pattern making terms: a zero form can be translated into panels with **minimal shear and distortion**, ensuring the 2D pattern faithfully reconstructs the intended 3D shape.

By leveraging algorithms such as `LSCM` (least-squares conformal mapping) and related solvers, IPM achieves a level of geometric precision and repeatability that drape-based methods **cannot match**.

## [ ZERO.FORM ]

The pure, ideal geometry that defines a pattern's form *before* any external influence.

> no gravity, no fabric stretch, no drape — geometry only

Starting from a mathematically precise shape **removes guesswork and human error**: patterns are generated directly from the true geometric intent of the design.

To ensure maximum precision, the zero form is built as a quad-based mesh with clean topology, optimized for subdivision workflows. The structure provides smooth, predictable surfaces and establishes good *edge flow* — **critical for strategic seam placement**.

## [ IMAGE>PATTERN.AI.MODELS ]

By starting from a pure geometric basis and unwrapping into flat patterns, IPM creates a level of clarity and control that traditional methods **cannot provide**.

It is also a foundational bridge to neural-network-driven workflows: image-to-pattern models that generate size-graded, production-ready patterns for soft goods. AI-generated zero forms, optimal topology, seam graphs, and parameterized panels are exactly the structured data required to train and power the next generation of these models.

IPM is not simply an improvement on existing methods — it is a scientifically rigorous, AI-ready **paradigm shift** that positions pattern making as a domain of computational precision and future-oriented design.

---

## // THE.MATH

*conformal mapping and surface parameterization*

Conformal mapping and surface parameterization provide a mathematically controlled way to map a 3D surface `S` to a 2D domain `Omega` in the plane — the "pattern" — while **preserving angles and local shape** as much as possible. We seek a map `f : S -> Omega` whose differential is locally a *similarity* (rotation plus uniform scale), thereby minimizing shear and directional distortion.

This is the geometric foundation for turning clean, quad-dominant or triangulated zero forms into 2D cutting shapes for soft goods.

### [ ESSENTIAL.CONCEPT ] // GEOMETRIC.PRELIMINARIES

- *developability* — only developable surfaces (Gaussian curvature `K = 0`) admit true isometric flattenings. Garment-relevant surfaces have nonzero curvature, so some distortion is **unavoidable** — the goal is to control its type and magnitude.
- *conformality* — a map is conformal if it preserves angles. Locally its Jacobian `J` has equal singular values, `sigma1 = sigma2`: an isotropic scale with zero shear.
- *quasiconformality* — real designs often require area control. Quasiconformal maps admit a bounded eccentricity `kappa = sigma1 / sigma2`, enforceable via a Beltrami coefficient `mu` with `|mu| < 1`.

> conformal maps preserve angles, not area — expect area to vary

| *map*          | *preserves*   | *cost*             |
| isometric      | everything    | needs K = 0      |
| conformal      | angles        | area may vary    |
| quasiconformal | bounded kappa | controlled shear |

### // KEY.ALGORITHMS

- `LSCM` — least-squares conformal mapping. Casts discrete Cauchy-Riemann equations into a least-squares system; linear solves with two fixed vertices. **Excellent angle preservation**; area can vary, which is often desirable for low-shear garment panels.
- `ABF` / `ABF++` — angle-based flattening. Optimizes internal triangle angles to match 3D angles under feasibility constraints; very robust against inversion, highly conformal.
- `MIPS` — most isometric parameterization. Minimizes the ratio `sigma1 / sigma2` symmetrically; strong control of conformal distortion, configurable for bijectivity.
- `SCP` — spectral conformal. Eigen-based formulation; fast, and a good initialization for further nonlinear refinement.
- `Tutte` — barycentric embedding. Guarantees injectivity with positive weights and a convex boundary; less angle-faithful, but ideal as initialization.
- *Beltrami-driven* — quasiconformal methods that prescribe or optimize `mu` to control area and anisotropy, or to encode material metrics such as different warp / weft stretch.

### // ENERGY.MODELS

Let `f = (u, v)` be the UV map. Common energies:

- *conformal energy* (`LSCM` / `ABF++` / `SCP`) — minimize angular distortion; effectively enforce discrete Cauchy-Riemann conditions.
- `MIPS` — directly minimizes the condition number of `J`; **strongly punishes anisotropic stretch**, promoting conformality and bijectivity.
- *symmetric Dirichlet* / `ARAP` — balance angle and area distortion; symmetric Dirichlet adds flip barriers, `ARAP` preserves local rigidity.
- *harmonic / biharmonic* — minimize Dirichlet energy; with suitable boundary conditions, harmonic maps approximate conformality.

These energies are minimized subject to:

- *anchors* — at least two vertices fixed (`LSCM`) to remove rigid motions.
- *boundary conditions* — a convex boundary (`Tutte`) for injectivity, or a free boundary (`LSCM`) for lower angular bias.

### // DISCRETE.DIFFERENTIAL.GEOMETRY

- *mesh representation* — most solvers operate on triangulated meshes. Quad meshes are typically triangulated for parameterization, then mapped back to quads in UV space if needed.
- *operators* — the discrete Laplace-Beltrami operator (cotangent weights) encodes Dirichlet energy. Cross-fields or frame-fields can guide seams and axes: alignment with warp / weft or principal curvatures.
- *seams and topology* — to parameterize into a single chart, the surface is cut to disk topology; **higher-genus surfaces require an atlas of charts**.

> seam placement strongly influences both distortion and practical sewing

### // WHY.CONFORMAL.SUITS.IPM

- *angle fidelity = shape clarity* — preserving angles minimizes shear, yielding **clean, predictable panel geometries**.
- *robust, scalable solves* — `LSCM` / `ABF++` provide fast, stable mappings with minimal user input.
- *seam-centric control* — cuts become explicit design variables, letting you place distortion where it is most acceptable.
- *AI integration* — the UV map is a canonical 2D parameter domain, directly usable as supervision for image-to-pattern models, and its distortion tensors provide physically meaningful training targets.

### // MATERIAL-AWARE.PARAMETERIZATION

- *target metric fitting* — encode fabric anisotropy (warp / weft / bias moduli) as a desired 2D metric, and optimize `f` so the pulled-back metric approximates it. Computational stretch then **matches allowable fabric stretch**.
- *directional alignment* — align UV axes with warp / weft; penalize shear relative to fabric stiffness; tune energy weights to match mechanical tests (strip / biaxial).
- *strain-to-fit loop* — use UV-space strain maps as feedback for local thickening or relaxing, or for introducing darts and panels where concentrated curvature demands it.

### // ZERO.FORM>PATTERN.PIPELINE

1. *clean topology* — an all-quad, subdivided, manifold zero form
2. *seam charting* — designate seams per design intent, as allowed by the mesh edge flow
3. *initialization* — `Tutte` or harmonic map to a convex boundary, or direct `LSCM` with two anchors
4. *optimization* — run `LSCM` / `ABF++` / `MIPS`; optionally combine with `ARAP` or symmetric Dirichlet to reduce area extremes while **preserving angles**
5. *constraints* — match seam lengths edge-by-edge; align parametric axes with the desired fabric grainlines
6. *bijectivity* — check orientations (positive UV area per triangle); use barrier terms or step-size control to prevent flips
7. *distortion analysis* — per-triangle `J` gives singular values; report angular error, area scale, stretch tensors; visualize heatmaps
8. *atlas packing* — lay out charts without overlap; preserve seam allowance margins; nest by grain direction
9. *post-process* — curve fitting of polylines, notches, labels, darts / pleats; export to CAD with units and tolerances; shape-key interpolation for size grading

---

## // IPM.AND.AI

*neural networks and predictive patterning*

IPM is essential for AI-driven patterning. Image-to-pattern models struggle when interpreting clothing directly from photos: the visual input is distorted by drape, lighting, camera angle, and fabric behavior. The zero form step removes those variables and provides a **clean, mathematical representation** of the garment's true geometry — turning unreliable visual data into **predictable, manufacturing-ready designs**.

### // TARGET.SYSTEM

The target system is a **single forward pipeline**, image to pattern:

```
image / sketch
  -> perception encoder        : geometric cues + style semantics
  -> zero form generator       : ideal 3D mesh, no gravity, no drape
  -> field + topology planner  : cross-fields, quad flow, seam intent
  -> seam module               : user constraints -> cut graph
  -> IPM core                  : LSCM / ABF++ / MIPS flattening
  -> panel post-process        : allowances, notches, grainlines
  -> grading (optional)        : shape-key conditioned size series
```

### // WHY.IPM.IS.ESSENTIAL.FOR.GENERATIVE.PATTERNING

- *canonicalization (gauge fixing)* — IPM defines a unique, low-shear UV domain and seam graph for each zero form. This **removes ambiguity** in learned representations and keeps supervision consistent.
- *differentiable objectives* — IPM's energies become training losses and rewards; the model is pulled toward bijective, low-distortion, manufacturing-safe maps.
- *user-in-the-loop control* — seam directives map to hard constraints and soft regularizers inside the solve; the model learns to satisfy design intent while minimizing distortion.
- *topology and edge-flow optimality* — couple with frame-field-driven quad remeshing: the model predicts fields, IPM optimizes the cut graph and UV to align with them.
- *data efficiency* — deterministic solves produce labels (UVs, distortion tensors, seam matches) without manual annotation: `zero forms -> parameterize -> render -> train`.
- *manufacturing alignment* — IPM outputs exactly what downstream systems require (clean panels, grain, allowances), **closing the domain gap** between model outputs and production.

### // MODEL.LEARNING.TARGETS

- *geometry losses* — chamfer / normal / curvature match between the predicted zero form and ground truth or reconstruction.
- *field alignment* — cross-field consistency with predicted grainlines and feature axes; penalize singularities in sensitive regions.
- *seam losses* — path fairness (curvature regularization), seam length budgets, visibility and wear-zone costs, user constraint satisfaction.
- *parameterization losses* — conformality (angle error, `MIPS` condition number); areal control (target metric for fabric anisotropy); bijectivity barriers (**no flips**, positive UV areas); seam matching (edge-length and tangent continuity).

### // TOPOLOGY.FROM.IMAGES

- *backbone* — image / video encoder into a neural implicit (`SDF` / neural surface) or a direct mesh head.
- *mesh recovery* — differentiable marching or a template-free surface head; remesh to quad-dominant with frame-field alignment.
- *field regressor* — predict 4- or 6-rotational symmetry fields aligned to style semantics (center front / back, side seams).
- *seam proposal network* — outputs a probabilistic cut graph subject to user masks; post-optimized via shortest geodesics plus fairness energy.
- *IPM layer* — runs `LSCM` / `ABF++` / `MIPS`, either as a true differentiable solver or as a **learned surrogate** trained on IPM outputs.

### // TRAINING.DATA.STRATEGY

- *curated pairs* — existing CAD patterns and their corresponding 3D assemblies; back-solve zero forms via relaxation.
- *synthetic corpus* — programmatically generate zero forms, run IPM, render multi-view images with texture and pose variation.
- *self-supervision* — cycle consistency (`image -> zero form / UV -> render -> image`) with **distortion-aware perceptual losses**.

### // USER-DIRECTED.SEAM.PLACEMENT

- *hard constraints* — fixed vertex and edge sets, **forbidden regions**, required meeting angles at key points.
- *soft constraints* — costs for crossing feature lines, bending energy, distortion budgeting per panel.

The optimality loop:

```
[A] predict field / seams
[B] run IPM
[C] evaluate distortion / losses
[D] adjust cut graph + weights -> repeat until bounds are met
```

### // KEY.ADVANTAGES.OF.IPM-AI

- *interpretable and auditable* — every panel, seam, and distortion value has a measurable rationale.
- *low shear, high fidelity* — the conformal core yields panels that assemble into the intended zero form with **minimal warp**.
- *robust to style variation* — field and seam optimization handles novel geometries without heuristic failure cascades.
- *user control without fragility* — designer constraints are first-class citizens in the solve, not afterthought edits.
- *data and compute efficiency* — deterministic solves provide rich supervision; the model learns what works for manufacturing, not just what looks plausible.

---

## // IN.CONCLUSION

```
[1] input image(s) + optional seam hints
[2] zero form + field / topology prediction
[3] cut graph optimization under user constraints
[4] IPM flattening with conformal / area controls
[5] shape-key-conditioned grading for size series
[6] panelization + packing + export (DXF / AI / ASTM)
```

IPM turns the model's predictions into production-validated patterns by encoding seams, topology, and UV maps as a solved optimization problem under user constraints — a predictable, controllable, **manufacturing-ready system** that preserves design intent.

The pipeline is not just practical. It is **the scientifically correct way** to close the loop between computer vision and garment engineering.

---

## [ REFERENCES.CITED ]

> the papers behind the math

- F. Benmansour, G. Carlier, G. Peyré, and F. Santambrogio, *Derivatives with respect to metrics and applications: Subgradient marching algorithm*, Numer. Math., 116 (2010), pp. 357-381
- A. Ben-Tal and M. Zibulevsky, *Penalty/barrier multiplier methods for convex programming problems*, SIAM J. Optim., 7 (1997), pp. 347-366
- A. Bronstein, M. Bronstein, and R. Kimmel, *Weighted distance maps computation on parametric three-dimensional manifolds*, J. Comput. Phys., 225 (2006), pp. 771-784
- A. Bronstein, M. Bronstein, and R. Kimmel, *Numerical Geometry of Non-Rigid Shapes*, Springer, New York, 2008
- Y. S. Devir, G. Rosman, A. M. Bronstein, M. M. Bronstein, and R. Kimmel, *On reconstruction of non-rigid shapes with intrinsic regularization*, ICCV Workshops, 2009, pp. 272-279
- C. Frederick and E. L. Schwartz, *Conformal image warping*, IEEE Comput. Graph. Appl., 10 (1990), pp. 54-61
- X. Gu, S. Wang, J. Kim, Y. Zeng, Y. Wang, H. Qin, and D. Samaras, *Ricci flow for 3D shape analysis*, ICCV '07, 2007, pp. 1-8
- X. Gu, Y. Wang, T. F. Chan, P. M. Thompson, and S.-T. Yau, *Genus zero surface conformal mapping and its application to brain surface mapping*, IEEE Trans. Med. Imag., 23 (2004), pp. 949-957
- M. Jin, Y. Wang, S.-T. Yau, and X. Gu, *Optimal global conformal surface parameterization*, VIS '04, IEEE Computer Society, 2004, pp. 267-274
- R. Kimmel, *Numerical Geometry of Images: Theory, Algorithms, and Applications*, Springer-Verlag, New York, 2004
- R. Kimmel and J. A. Sethian, *Fast marching methods on triangulated domains*, Proc. Natl. Acad. Sci. USA, 95 (1998), pp. 8341-8435
- R. Kimmel and J. A. Sethian, *Optimal algorithm for shape from shading and path planning*, J. Math. Imaging Vision, 14 (2001), pp. 237-244
- Y. Lipman and I. Daubechies, *Conformal Wasserstein distances: Comparing surfaces in polynomial time*, Adv. Math., 227 (2011), pp. 1047-1077
- Y. Lipman and T. Funkhouser, *Möbius voting for surface correspondence*, ACM Trans. Graph., 28 (2009), 72
- F. Mémoli and G. Sapiro, *Fast computation of weighted distance functions and geodesics on implicit hyper-surfaces*, J. Comput. Phys., 173 (2001), pp. 730-764
- K. Polthier, *Conjugate Harmonic Maps and Minimal Surfaces*, Preprint 446, SFB 288, TU-Berlin, 2000
- E. Rouy and A. Tourin, *A viscosity solutions approach to shape-from-shading*, SIAM J. Numer. Anal., 29 (1992), pp. 867-884
- J. A. Sethian, *A fast marching level set method for monotonically advancing fronts*, Proc. Natl. Acad. Sci. USA, 93 (1996), pp. 1591-1595
- J. A. Sethian, *Fast marching methods*, SIAM Rev., 41 (1999), pp. 199-235
- A. Spira and R. Kimmel, *An efficient solution to the eikonal equation on parametric manifolds*, Interfaces Free Bound., 6 (2004), pp. 315-327
- V. Surazhsky and T. Surazhsky, *Fast exact and approximate geodesics on meshes*, ACM Trans. Graph., 24 (2005), pp. 553-560
- J. N. Tsitsiklis, *Efficient algorithms for globally optimal trajectories*, IEEE Trans. Automat. Control, 40 (1995), pp. 1528-1538
- O. Weber, Y. S. Devir, A. Bronstein, M. Bronstein, and R. Kimmel, *Parallel algorithms for approximation of distance maps on parametric surfaces*, ACM Trans. Graph., 27 (2008), 104
- W. Zeng, L. M. Lui, F. Luo, T. F. Chan, S.-T. Yau, and D. X. Gu, *Computing quasiconformal maps using an auxiliary metric and discrete curvature flow*, Numer. Math., 121 (2012), pp. 671-703
- M. Zibulevsky, *PBM Toolbox for Constrained Nonlinear and Semidefinite Optimization*, MATLAB toolbox


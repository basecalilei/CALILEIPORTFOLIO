/* =============================================================================
   pdfModal.js — the shared PDF READER modal (not a panel, not a sidebar view)
   -----------------------------------------------------------------------------
   A centered reading sheet that renders a PDF's pages as canvases via PDF.js,
   so documents read on the site's own surface — our scrollbar, our borders,
   our cursor — instead of the browser's embedded viewer chrome.

   Opened from a "document card" (see pdfModalStyles.css → .pdf-card) authored
   anywhere on the site: a project's media stack, a sidebar view, a desktop
   window. Cards opt in with data attributes; this module owns the click
   delegation, so authoring a card requires no imports and no wiring:

     <a class="pdf-card"
        href="assets/docs/paper.pdf"                 ← no-JS / middle-click fallback
        data-pdf-src="assets/docs/paper.pdf"
        data-pdf-title="PAPER TITLE"
        data-pdf-meta="Authors — Venue 2022">
       <span class="pdf-card-kicker">DOCUMENT — PDF</span>
       <span class="pdf-card-title">Paper title, sentence case</span>
       <span class="pdf-card-meta">Authors — Venue 2022</span>
       <span class="pdf-card-open">OPEN READER</span>
     </a>

   Deleting this module (file + import line + stylesheet link) leaves cards
   inert anchors that open the raw PDF — a silent, graceful no-op, per the
   project's deletability rule.

   USAGE (programmatic, optional)
     import { openPdfModal } from "./pdfModal.js";
     openPdfModal("assets/docs/paper.pdf", {
       title:  "PAPER TITLE",
       meta:   "Authors — Venue 2022",
       origin: clickedElement,          // FLIP grows from this rect if given
     });

   Importing the module at all (main.js: `import "./pdfModal.js";`) installs
   the card delegation — the same import-time side-effect pattern panel types
   use to register themselves.

   Z-INDEX — ABOVE THE OTHER MODALS, ON PURPOSE
     z:12 — .pdf-modal-scrim
     z:13 — .pdf-modal-sheet
     Document cards live INSIDE project modals (z:10–11), so this reader must
     stack above them: open a paper from a project's media stack and the
     reader covers the project sheet; closing returns you to the project
     exactly where you left it. Same layering relationship the project modal
     has with the sidebar (z:9). The cursor (z:10000) stays above everything.

   CAPTURE-PHASE LISTENERS — WHY (load-bearing, do not "simplify" to bubble)
     1. CARD CLICKS. projectModal's scrim handler stopPropagation()s every
        click that originates inside its sheet (a deliberate boundary so
        in-modal clicks don't read as ambient page clicks to the sidebar's
        outside-click dismissal). A bubble-phase listener on document would
        therefore NEVER see a card clicked inside a project's media stack.
        The delegation here runs in the CAPTURE phase — document capture
        fires on the way DOWN, before the scrim's bubble handler exists in
        the event's path — so cards work everywhere, including inside other
        modals. We do NOT stop propagation on card clicks: the click should
        still reach the project scrim's own guard (which only closes when
        the click target is the scrim itself, so it's a no-op) exactly as
        if the card were any other in-sheet element.
     2. ESCAPE. When this reader is open above the project modal, both have
        document keydown listeners and Escape would close BOTH. Ours runs
        in the capture phase and calls stopPropagation() when it handles
        the key, shielding the project modal's bubble-phase handler. One
        Escape closes one layer, top-down — standard modal-stack behavior.

   PDF.JS — LAZY, PINNED, DELETABLE
     The renderer is Mozilla's pdfjs-dist, dynamically imported from the CDN
     on FIRST OPEN only — a visitor who never opens a document never loads
     it. The version is pinned in the two constants below (this module is
     the library's only consumer, so the pin lives here rather than in
     index.html's importmap, keeping the module deletable in isolation; the
     importmap stays the pin-point for shared libraries like three).
     If the import or the document load fails (offline, CDN blocked, bad
     path), the reader degrades to an error state whose RAW link opens the
     PDF in the browser's native viewer — the reading path never dead-ends.

   RENDERING MODEL
     Pages render sequentially into <canvas> elements appended to the
     scrollable column, sized to the column's CSS width × a capped device-
     pixel-ratio supersample (see PAGE_PIXEL_CAP). First pages appear while
     later ones are still rendering, so a long paper reads immediately.
     A monotonically increasing render token cancels an in-flight render
     when the modal closes or a different document opens mid-render.

     Canvases are NOT cached across closes: close() clears the column and
     destroys the PDF.js document, returning the memory. Re-opening
     re-renders (a second or two) — the honest trade against holding tens
     of MB of page bitmaps for a modal the user closed. Pages render at
     open-time width; on window resize they stretch via CSS (slightly soft
     until reopened) rather than re-rendering — a deliberate simplification.

   FLIP ANIMATION
     Same open/close pattern as projectModal.js / gridModal.js: grow from
     the clicked card's rect, shrink back to it on close. See
     applyFlipFromRect() — the math is identical by design; if a bug is
     found in one modal's FLIP, fix all of them.

   COUPLED WITH
     - pdfModalStyles.css: emits every .pdf-modal-* and .pdf-card* class.
     - cancels.js: createCancelGroup() for the title scramble.
     - textScramble.js: startScramble for the title, matching the site's
       text-reveal language.
     - Any module that authors a .pdf-card — coupled only through the data
       attributes, never through imports.
   ========================================================================== */

import { startScramble }     from "./textScramble.js";
import { createCancelGroup } from "./cancels.js";

/* -----------------------------------------------------------------------------
   TUNABLES
   --------------------------------------------------------------------------- */

// FLIP animation duration. MUST match the CSS transitions on
// .pdf-modal-sheet (transform) and .pdf-modal-scrim::before in
// pdfModalStyles.css. Named here only for the close-completion timeout;
// the visible timing's source of truth is the CSS.
const MODAL_ANIM_MS = 450;

// pdfjs-dist, pinned. unpkg to match how index.html pins three. Bump both
// together — the worker version must match the main library exactly.
const PDFJS_URL        = "https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDFJS_WORKER_URL = "https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

// Supersampling cap. Pages render at column-CSS-width × devicePixelRatio,
// but DPR is clamped and the final pixel width capped so an 8-page paper
// on a 3x display doesn't allocate hundreds of MB of canvas. 1600px wide
// is crisp for a ~900px reading column.
const PAGE_DPR_CAP   = 2;
const PAGE_PIXEL_CAP = 1600;

/* -----------------------------------------------------------------------------
   MODULE-LEVEL STATE
   -----------------------------------------------------------------------------
   Singleton — one reader exists, opened and closed by the exported function
   and the card delegation. All references private; the external surface is
   openPdfModal() plus the data-attribute contract.
   --------------------------------------------------------------------------- */

let mounted = false;
let isOpen  = false;

let scrim    = null;   // full-viewport backdrop; click outside sheet closes
let sheet    = null;   // the centered reading window
let closeBtn = null;   // × pinned in the header
let kickerEl = null;   // "DOCUMENT" eyebrow in the header
let titleEl  = null;   // <h2>, scrambled in per open
let metaEl   = null;   // authors/venue + page count line
let rawLink  = null;   // "RAW ↗" — opens the actual PDF in a new tab
let pagesEl  = null;   // the scrollable column the page canvases render into
let statusEl = null;   // loading / error line inside the column

// The card element the modal grew from; close shrinks back to it.
let originEl = null;

// Escape handler — attached on open in the CAPTURE phase (see file header),
// removed on close.
let escapeHandler = null;

// Pending close-completion timeout; cleared on rapid reopen mid-close.
let closeTimer = null;

// Cancellables for in-modal animations (the title scramble).
const cancels = createCancelGroup();

// The lazy pdf.js import — a cached promise so concurrent/repeat opens
// share one network fetch.
let pdfjsPromise = null;

// The currently open PDF.js document, destroyed on close to free the
// worker's memory.
let pdfDoc = null;

// Render generation token. Every open() and close() bumps it; the async
// page loop re-checks it between pages and abandons work when stale.
let renderToken = 0;

// The meta text authored on the card, kept so the page count can be
// appended to it once the document reports its length.
let baseMeta = "";

/* =============================================================================
   PUBLIC API
   ========================================================================== */

export function openPdfModal(src, opts = {}) {
  if (!src) return;
  if (!mounted) build();

  // Re-opening mid-close: cancel the close cleanup, clear the half-way
  // transform so the new open's FLIP starts from rest.
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
    sheet.style.transform = "";
  }

  // Fresh open = fresh scramble; stop any previous one.
  cancels.cancelAll();

  // Populate the header. The title falls back to the filename so a card
  // authored with only data-pdf-src still reads sensibly.
  baseMeta = opts.meta || "";
  titleEl.textContent = opts.title || src.split("/").pop();
  metaEl.textContent  = baseMeta;
  rawLink.href        = src;

  // Reset the reading column to a clean loading state. Clearing innerHTML
  // drops any previous document's canvases (and their memory) immediately.
  pagesEl.innerHTML = "";
  statusEl = makeStatus("LOADING DOCUMENT…");
  pagesEl.appendChild(statusEl);
  pagesEl.scrollTop = 0;

  isOpen   = true;
  originEl = opts.origin || null;

  // Show the scrim; force layout so the FLIP measures a laid-out sheet.
  scrim.classList.add("is-visible");
  // eslint-disable-next-line no-unused-expressions
  sheet.offsetHeight;

  // FLIP from the card's rect (same choreography as projectModal — see its
  // file header for the transition-disable rationale).
  if (originEl) {
    sheet.style.transition = "none";
    applyFlipFromRect(originEl.getBoundingClientRect());
    // eslint-disable-next-line no-unused-expressions
    sheet.offsetHeight;
  }

  requestAnimationFrame(() => {
    sheet.style.transition = "";
    sheet.style.transform  = "";
    scrim.classList.add("is-open");
  });

  // Title scramble — resolves (~260ms) before the FLIP (450ms) settles.
  if (titleEl.textContent) {
    cancels.add(startScramble(titleEl));
  }

  // Escape closes THIS layer only — capture + stopPropagation shields the
  // project modal's bubble-phase handler underneath. See file header.
  escapeHandler = (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    closePdfModal();
  };
  document.addEventListener("keydown", escapeHandler, { capture: true });

  // Kick off the async render under a fresh token.
  renderDocument(src, ++renderToken);
}

export function closePdfModal() {
  if (!isOpen) return;
  isOpen = false;

  // Invalidate any in-flight page loop; it checks this between pages.
  renderToken++;

  cancels.cancelAll();

  if (escapeHandler) {
    document.removeEventListener("keydown", escapeHandler, { capture: true });
    escapeHandler = null;
  }

  // FLIP back to the card. Re-measure at close time — the project sheet
  // may have been scrolled since open. A zero-size rect (card scrolled out
  // of a wiped media stack) skips the FLIP; the fade alone reads fine.
  if (originEl) {
    const r = originEl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      applyFlipFromRect(r);
    }
  }
  scrim.classList.remove("is-open");

  closeTimer = setTimeout(() => {
    scrim.classList.remove("is-visible");
    sheet.style.transform = "";
    originEl = null;
    closeTimer = null;

    // Free the document AFTER the close motion so the shrinking sheet
    // still shows rendered pages, not a blank column.
    pagesEl.innerHTML = "";
    statusEl = null;
    if (pdfDoc) {
      pdfDoc.destroy();
      pdfDoc = null;
    }
  }, MODAL_ANIM_MS + 20);
}

/* =============================================================================
   PRIVATE — document rendering
   -----------------------------------------------------------------------------
   Lazy-import pdf.js, load the document, render pages sequentially. The
   token guard makes the whole pipeline abandonable: close or a new open
   bumps renderToken and the loop quietly stops appending.
   ========================================================================== */

async function renderDocument(src, token) {
  try {
    const pdfjs = await loadPdfjs();
    if (token !== renderToken) return;

    const doc = await pdfjs.getDocument({ url: src }).promise;
    if (token !== renderToken) { doc.destroy(); return; }

    // Replace any previous document only once the new one is live, so a
    // failed load never leaves us having destroyed a working doc.
    if (pdfDoc) pdfDoc.destroy();
    pdfDoc = doc;

    metaEl.textContent = baseMeta
      ? `${baseMeta} — ${doc.numPages} PAGES`
      : `${doc.numPages} PAGES`;

    // Column width drives render scale. Measured once per open; the FLIP
    // transform doesn't affect layout, so this is stable even while the
    // open animation is still running.
    const cssWidth = Math.max(pagesEl.clientWidth, 1);
    const dpr      = Math.min(window.devicePixelRatio || 1, PAGE_DPR_CAP);

    for (let n = 1; n <= doc.numPages; n++) {
      if (token !== renderToken) return;

      const page = await doc.getPage(n);
      if (token !== renderToken) return;

      const base    = page.getViewport({ scale: 1 });
      const pixelW  = Math.min(cssWidth * dpr, PAGE_PIXEL_CAP);
      const scale   = pixelW / base.width;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.className = "pdf-modal-page";
      canvas.width  = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      // Bitmap pixels ≠ CSS pixels on purpose (supersampling); CSS width
      // pins the layout size, height follows the page's aspect.
      canvas.style.width = "100%";

      await page.render({
        canvasContext: canvas.getContext("2d"),
        viewport,
      }).promise;
      if (token !== renderToken) return;

      // First page replaces the loading line; later pages just append.
      if (statusEl) {
        statusEl.remove();
        statusEl = null;
      }
      pagesEl.appendChild(canvas);
    }
  } catch (err) {
    if (token !== renderToken) return;
    console.error("pdfModal: failed to load document:", src, err);
    showError();
  }
}

function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS_URL).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return pdfjs;
    }).catch((err) => {
      // Reset so a later open retries the import (e.g. the network came
      // back) instead of caching the failure forever.
      pdfjsPromise = null;
      throw err;
    });
  }
  return pdfjsPromise;
}

function showError() {
  pagesEl.innerHTML = "";
  statusEl = makeStatus(
    "COULD NOT RENDER THIS DOCUMENT — USE THE RAW LINK ABOVE TO OPEN IT IN " +
    "THE BROWSER'S OWN VIEWER."
  );
  statusEl.classList.add("is-error");
  pagesEl.appendChild(statusEl);
}

function makeStatus(text) {
  const el = document.createElement("p");
  el.className = "pdf-modal-status";
  el.textContent = text;
  return el;
}

/* =============================================================================
   PRIVATE — FLIP transform from a target rect
   -----------------------------------------------------------------------------
   Identical math to projectModal.js's applyFlipFromRect — independent X/Y
   scales because the card and the sheet have different aspect ratios, so a
   single scale would land wrong at one endpoint. Transition handling lives
   at the call sites (open disables it for the snap; close leaves it on so
   setting the transform IS the animation). Kept as a copy, not a shared
   import: the modals stay deletable in isolation, and the function is
   eight lines. If a FLIP bug is found in one modal, fix all of them.
   ========================================================================== */
function applyFlipFromRect(originRect) {
  const targetRect = sheet.getBoundingClientRect();
  const scaleX = originRect.width  / targetRect.width;
  const scaleY = originRect.height / targetRect.height;
  const dx = (originRect.left + originRect.width  / 2) -
             (targetRect.left + targetRect.width  / 2);
  const dy = (originRect.top  + originRect.height / 2) -
             (targetRect.top  + targetRect.height / 2);

  sheet.style.transform = `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`;
}

/* =============================================================================
   PRIVATE — DOM construction (lazy, once on first open)
   ========================================================================== */

function build() {
  mounted = true;

  scrim = document.createElement("div");
  scrim.className = "pdf-modal-scrim";
  scrim.setAttribute("aria-hidden", "true");

  sheet = document.createElement("aside");
  sheet.className = "pdf-modal-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Document reader");

  // ---- header: kicker / title / meta on the left, RAW + close on the right
  const header = document.createElement("header");
  header.className = "pdf-modal-header";

  const headText = document.createElement("div");
  headText.className = "pdf-modal-header-text";

  kickerEl = document.createElement("span");
  kickerEl.className = "pdf-modal-kicker";
  kickerEl.textContent = "DOCUMENT";

  titleEl = document.createElement("h2");
  titleEl.className = "pdf-modal-title";

  metaEl = document.createElement("span");
  metaEl.className = "pdf-modal-meta";

  headText.appendChild(kickerEl);
  headText.appendChild(titleEl);
  headText.appendChild(metaEl);

  rawLink = document.createElement("a");
  rawLink.className = "pdf-modal-raw";
  rawLink.textContent = "RAW ↗";
  rawLink.target = "_blank";
  rawLink.rel = "noopener";
  rawLink.setAttribute("aria-label", "Open the raw PDF in a new tab");

  closeBtn = document.createElement("button");
  closeBtn.className = "pdf-modal-close";
  closeBtn.setAttribute("aria-label", "Close document reader");
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", closePdfModal);

  header.appendChild(headText);
  header.appendChild(rawLink);
  header.appendChild(closeBtn);

  // ---- the scrollable reading column
  pagesEl = document.createElement("div");
  pagesEl.className = "pdf-modal-pages";

  sheet.appendChild(header);
  sheet.appendChild(pagesEl);
  scrim.appendChild(sheet);
  document.body.appendChild(scrim);

  // Scrim click closes — same boundary rationale as projectModal's scrim
  // handler (see its build() comment): clicks that originate inside this
  // dialog must not read as ambient page clicks to document-level
  // listeners (the sidebar's outside-click dismissal, our own card
  // delegation's capture pass has already run by now).
  scrim.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target === scrim) closePdfModal();
  });
}

/* =============================================================================
   CARD DELEGATION — import-time side effect
   -----------------------------------------------------------------------------
   One capture-phase listener on document opens the reader from any element
   carrying data-pdf-src, wherever it was authored — including inside the
   project modal, whose scrim stopPropagation()s bubble-phase clicks (the
   whole reason this runs in capture; see file header).

   preventDefault() stops an <a>-based card from also navigating to the raw
   PDF. Middle-click / ctrl-click / no-JS still open the href natively —
   auxclick and modified clicks are deliberately left alone, and if this
   module never loads the card is a plain link. Left alone too: propagation,
   so enclosing modals' own guards keep working unchanged.
   ========================================================================== */

document.addEventListener("click", (e) => {
  const card = e.target.closest("[data-pdf-src]");
  if (!card) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // native behaviors
  e.preventDefault();

  openPdfModal(card.dataset.pdfSrc, {
    title:  card.dataset.pdfTitle,
    meta:   card.dataset.pdfMeta,
    origin: card,
  });
}, { capture: true });

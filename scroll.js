(() => {
  const root = document.querySelector('.carousel');
  const track = root.querySelector('.carousel-track');
  const slides = Array.from(track.children);
  const prevBtn = root.querySelector('.prev');
  const nextBtn = root.querySelector('.next');

  let index = 0;
  const last = slides.length - 1;

  function update() {
    track.style.transition = 'transform 300ms ease';
    track.style.transform = `translateX(${-index * 100}%)`;
    slides.forEach((li, i) => {
      const active = i === index;
      li.classList.toggle('is-active', active);
      li.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function go(delta) {
    index = (index + delta + slides.length) % slides.length;
    update();
  }

  // BUTTONS
  prevBtn.addEventListener('click', () => go(-1));
  nextBtn.addEventListener('click', () => go(1));

  // KEYBOARD: ARROWS, HOME, END
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    if (e.key === 'Home') { e.preventDefault(); index = 0; update(); }
    if (e.key === 'End')  { e.preventDefault(); index = last; update(); }
  });
  root.tabIndex = 0; // MAKE WHOLE CAROUSEL FOCUSABLE

  // TOUCH / DRAG SWIPE
  let startX = 0, currX = 0, dragging = false;
  const threshold = 30; // PX BEFORE WE CONSIDER IT A SWIPE

  function onStart(clientX) {
    dragging = true;
    startX = currX = clientX;
    track.style.transition = 'none';
  }
  function onMove(clientX) {
    if (!dragging) return;
    currX = clientX;
    const dx = currX - startX;
    track.style.transform = `translateX(calc(${-index * 100}% + ${dx}px))`;
  }
  function onEnd() {
    if (!dragging) return;
    const dx = currX - startX;
    // SNAP
    if (dx > threshold) go(-1);
    else if (dx < -threshold) go(1);
    else update();
    dragging = false;
  }

  // MOUSE
  track.addEventListener('mousedown', (e) => onStart(e.clientX));
  window.addEventListener('mousemove', (e) => onMove(e.clientX));
  window.addEventListener('mouseup', onEnd);

  // TOUCH
  track.addEventListener('touchstart', (e) => onStart(e.touches[0].clientX), { passive: true });
  track.addEventListener('touchmove',  (e) => onMove(e.touches[0].clientX), { passive: true });
  track.addEventListener('touchend', onEnd);

  // INITIAL PAINT
  update();
})();

// PROJECTS BANNER — CROSSFADE WITH SMART HIDE/RESHOW
(() => {
  const banner = document.querySelector('.projects-banner');
  if (!banner) return;

  let layerA = banner.querySelector('.banner-image');
  if (!layerA) return;

  let layerB = banner.querySelector('.banner-image-b');
  if (!layerB) {
    layerB = document.createElement('div');
    layerB.className = 'banner-image-b';
    banner.appendChild(layerB);
  }

  const triggers = document.querySelectorAll('.projects-abc [data-banner]');

  // ACCESSIBILITY / FOCUS
  triggers.forEach(el => {
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    el.setAttribute('aria-haspopup', 'false');
  });

  // STATE
  let topIsA = false;   // WHICH LAYER IS CURRENTLY ON TOP
  let lastSrc = '';     // LAST SHOWN IMAGE URL
  let isVisible = false; // WHETHER ANY IMAGE IS CURRENTLY VISIBLE

  const setOpacity = (el, v) => { el.style.opacity = v; };
  const setBg = (el, src) => { el.style.backgroundImage = `url("${src}")`; };

  // PRELOAD (OPTIONAL)
  triggers.forEach(el => {
    const src = el.getAttribute('data-banner');
    if (src) { const i = new Image(); i.src = src; }
  });

  const crossfadeTo = (src, force = false) => {
    // IF VISIBLE AND SAME SRC AND NOT FORCED → NO-OP
    if (!src) return;
    if (!force && isVisible && src === lastSrc) return;

    const top = topIsA ? layerA : layerB; // CURRENT
    const bot = topIsA ? layerB : layerA; // NEXT

    setBg(bot, src);
    // FORCE REFLOW TO RELIABLY TRIGGER OPACITY TRANSITION
    // eslint-disable-next-line no-unused-expressions
    bot.offsetWidth;

    // FADE NEW IN, OLD OUT
    setOpacity(bot, 1);
    setOpacity(top, 0);

    topIsA = !topIsA;
    lastSrc = src;
    isVisible = true;
    banner.classList.add('show-image');
  };

  const show = (el) => {
    const src = el.getAttribute('data-banner');
    // FORCE IF CURRENTLY HIDDEN, SO SAME SRC FADES BACK IN
    crossfadeTo(src, !isVisible);
  };

  const hideAll = () => {
    // FADE OUT BOTH LAYERS; KEEP lastSrc SO RE-ENTER CAN SHOW SAME SRC
    setOpacity(layerA, 0);
    setOpacity(layerB, 0);
    banner.classList.remove('show-image');
    isVisible = false;
  };

  // EVENTS — NO PER-CELL LEAVE HIDES (PREVENTS SNAP BETWEEN CELLS)
  triggers.forEach(el => {
    el.addEventListener('pointerenter', () => show(el));
    el.addEventListener('mouseenter', () => show(el));  // LEGACY
    el.addEventListener('click', () => show(el));       // TOUCH/TAP
    el.addEventListener('focus', () => show(el));       // KEYBOARD

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(el); }
    });
  });

  // OPTIONAL GLOBAL CLEAR: ONLY WHEN LEAVING THE ENTIRE INTERACTIVE AREA
  // THIS AVOIDS THE A→B SNAP, AND WITH isVisible/force LOGIC, RE-ENTERING
  // THE SAME CELL FADES BACK IN.
  const boundarySelector = '.projects-abc, [data-banner], .projects-banner';
  const insideBoundary = (t) => !!(t && t.closest(boundarySelector));
  let wasInside = false;

  document.addEventListener('pointermove', (e) => {
    const nowInside = insideBoundary(e.target);
    if (!nowInside && wasInside) {
      hideAll();
    }
    wasInside = nowInside;
  });
})();


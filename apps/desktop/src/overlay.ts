// Renderer for the floating icon: status display plus drag-to-move.
(() => {
  const icon = document.getElementById('icon') as HTMLDivElement;
  const label = document.getElementById('label') as HTMLSpanElement;
  const status = document.getElementById('status')!;
  const pill = icon.querySelector<HTMLElement>('.pill')!;
  const bars = Array.from(icon.querySelectorAll<SVGRectElement>('.g-bars rect'));
  const LABEL: Record<string, string> = {
    listening: 'Listening',
    processing: 'Working on it',
    done: 'Inserted',
    error: 'Something went wrong',
  };
  const STATES = ['idle', 'listening', 'processing', 'done', 'error', 'reminder'];
  const IDLE_FADE_MS = 5000;
  let state = 'idle';
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleFade(): void {
    clearTimeout(fadeTimer);
    if (state !== 'idle' || icon.matches(':hover') || start) return;
    fadeTimer = setTimeout(() => {
      if (state !== 'idle' || icon.matches(':hover') || start) return;
      icon.classList.add('faded');
      flowApi.overlay.interactive(false);
    }, IDLE_FADE_MS);
  }

  // --- status ---
  const recent = bars.map(() => 0); // trailing loudness, newest last: the bars read as a waveform
  const paint = () =>
    bars.forEach((b, i) => (b.style.transform = `scaleY(${(0.2 + 0.8 * recent[i]).toFixed(2)})`));

  const resetWaveform = () => {
    recent.fill(0);
    bars.forEach((bar) => bar.style.removeProperty('transform'));
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const motion = getComputedStyle(document.documentElement);
  const dotWidth = 40;
  // The label starts 37px in, after the glyph and gap, with 13px of space at the end.
  const labelClearance = 50;
  let pillWidth = dotWidth;
  let resize: Animation | undefined;

  function fitLabel(text: string): void {
    if (label.textContent === text) return;
    const value = document.createElement('span');
    value.className = 'label-in';
    value.textContent = text;
    label.replaceChildren(value);
    icon.classList.toggle('open', text !== '');

    // Measure only when the message changes. Animate the rendered shell from its current size.
    const nextWidth = text ? label.offsetWidth + labelClearance : dotWidth;
    if (nextWidth === pillWidth) return;
    const transform = getComputedStyle(pill).transform;
    const previousWidth =
      pillWidth * (transform === 'none' ? 1 : new DOMMatrixReadOnly(transform).a);
    resize?.cancel();
    pillWidth = nextWidth;
    icon.style.setProperty('--pill-width', `${nextWidth}px`);
    icon.style.setProperty('--glyph-x', `${(dotWidth - nextWidth) / 2}px`);
    if (!reduced.matches) {
      resize = pill.animate(
        [{ transform: `scaleX(${previousWidth / nextWidth})` }, { transform: 'none' }],
        {
          duration: parseFloat(motion.getPropertyValue('--motion-slow')),
          easing: motion.getPropertyValue('--ease-enter').trim(),
        },
      );
    }
  }

  flowApi.overlay.onStatus((s) => {
    const previous = state;
    state = s.state === 'hidden' ? 'idle' : s.state;
    clearTimeout(fadeTimer);
    icon.classList.remove('faded');
    if (state !== previous) {
      icon.classList.remove(...STATES);
      icon.classList.add(state);
    }
    const text = state === 'idle' ? '' : (s.message ?? LABEL[state] ?? '');
    fitLabel(text);
    const announcement =
      state === 'reminder' ? (text ? `${text} reminders due` : 'One reminder due') : text;
    if (status.textContent !== announcement) status.textContent = announcement;
    if (previous === 'listening' && state !== 'listening') resetWaveform();
    if (icon.matches(':hover')) flowApi.overlay.interactive(true);
    scheduleFade();
  });
  flowApi.overlay.onLevel((v) => {
    if (state !== 'listening' || reduced.matches) return;
    recent.shift();
    recent.push(v);
    paint();
  });
  reduced.addEventListener('change', () => {
    resize?.cancel();
    resetWaveform();
  });

  // --- drag to move (the window is click-through everywhere except over the icon) ---
  let start: { x: number; y: number } | null = null;
  let moved = false;

  icon.addEventListener('pointerenter', () => {
    clearTimeout(fadeTimer);
    if (!icon.classList.contains('faded')) flowApi.overlay.interactive(true);
    flowApi.overlay.hover(true);
  });
  icon.addEventListener('pointerleave', () => {
    if (!start) flowApi.overlay.interactive(false);
    flowApi.overlay.hover(false);
    scheduleFade();
  });

  icon.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    clearTimeout(fadeTimer);
    icon.setPointerCapture(e.pointerId);
    start = { x: e.screenX, y: e.screenY };
    moved = false;
    flowApi.overlay.dragStart();
  });
  icon.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.screenX - start.x;
    const dy = e.screenY - start.y;
    if (!moved && Math.hypot(dx, dy) < 4) return; // a click, not a drag
    moved = true;
    icon.classList.add('dragging');
    flowApi.overlay.drag(dx, dy);
  });
  const end = () => {
    if (!start) return;
    start = null;
    icon.classList.remove('dragging');
    if (moved) flowApi.overlay.dragEnd();
    else flowApi.overlay.click();
    if (!icon.matches(':hover')) flowApi.overlay.interactive(false);
    scheduleFade();
  };
  icon.addEventListener('pointerup', end);
  icon.addEventListener('pointercancel', end);
})();

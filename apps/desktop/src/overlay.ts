// Renderer for the floating icon: status display plus drag-to-move.
(() => {
  const icon = document.getElementById('icon') as HTMLDivElement;
  const label = document.getElementById('label') as HTMLSpanElement;
  const bars = Array.from(icon.querySelectorAll<SVGRectElement>('.g-bars rect'));
  const LABEL: Record<string, string> = {
    listening: 'Listening',
    processing: 'Working on it',
    done: 'Inserted',
    error: 'Something went wrong',
  };
  const STATES = ['idle', 'listening', 'processing', 'done', 'error'];
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

  flowApi.overlay.onStatus((s) => {
    state = s.state === 'hidden' ? 'idle' : s.state;
    clearTimeout(fadeTimer);
    icon.classList.remove('faded');
    icon.classList.remove(...STATES);
    icon.classList.add(state);
    const text = state === 'idle' ? '' : (s.message ?? LABEL[state] ?? '');
    label.textContent = text;
    icon.classList.toggle('open', text !== '');
    if (state !== 'listening') {
      recent.fill(0);
      paint();
    }
    scheduleFade();
  });
  flowApi.overlay.onLevel((v) => {
    recent.shift();
    recent.push(v);
    paint();
  });

  // --- drag to move (the window is click-through everywhere except over the icon) ---
  let start: { x: number; y: number } | null = null;
  let moved = false;

  icon.addEventListener('pointerenter', () => {
    clearTimeout(fadeTimer);
    if (!icon.classList.contains('faded')) flowApi.overlay.interactive(true);
  });
  icon.addEventListener('pointerleave', () => {
    if (!start) flowApi.overlay.interactive(false);
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

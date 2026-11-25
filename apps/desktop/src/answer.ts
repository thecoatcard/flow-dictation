// Renderer for the card that grows out of the icon. Text is only ever set with textContent, so an answer or a
// reminder cannot inject markup.
(() => {
  const card = document.getElementById('card') as HTMLDivElement;
  const a = document.getElementById('a') as HTMLParagraphElement;
  const meta = document.getElementById('meta') as HTMLElement;
  const copy = document.getElementById('copy') as HTMLButtonElement;
  const speak = document.getElementById('speak') as HTMLButtonElement;

  const SHOW_MS = 8_000; // an answer fades by itself after this long if the pointer is not on it
  const AFTER_HOVER_MS = 5_000; // and this long after the pointer leaves
  const FADE_MS = 440;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hovering = false;
  let speaking = false;
  let reminder = false; // a reminder card stays while the pointer is on the icon or card; the app closes it

  const fade = () => {
    card.classList.add('out');
    flowApi.answer.interactive(false);
    timer = setTimeout(() => flowApi.answer.close(), FADE_MS);
  };
  /** Starts the countdown for an answer; it waits while the pointer is on the card or the answer is being read. */
  const arm = (ms: number) => {
    clearTimeout(timer);
    if (reminder) return;
    timer = setTimeout(() => (hovering || speaking ? arm(AFTER_HOVER_MS) : fade()), ms);
  };
  const setSpeaking = (on: boolean) => {
    speaking = on;
    speak.classList.toggle('on', on);
    speak.title = on ? 'Stop' : 'Read aloud';
    if (!on && !hovering) arm(AFTER_HOVER_MS);
  };

  flowApi.answer.onShow((d) => {
    clearTimeout(timer);
    const wasShown = card.classList.contains('in') && !card.classList.contains('out');
    reminder = d.kind === 'reminder';
    document.body.classList.toggle('down', !d.up);
    // A reminder card that is already open just swaps its text, so clearing one by one does not flicker.
    card.className = reminder ? 'reminder' : '';
    a.textContent = d.answer;
    a.scrollTop = 0;
    meta.textContent = d.meta ?? '';
    card.title = d.question;
    copy.classList.remove('done');
    setSpeaking(false);
    // Grow out of the icon: the card's origin is the icon's centre, on the edge facing it.
    card.style.transformOrigin = `${d.originX - card.offsetLeft}px ${d.up ? '100%' : '0%'}`;
    if (!(reminder && wasShown)) void card.offsetWidth; // start from the small state, then open
    card.classList.add('in');
    if (hovering) flowApi.answer.interactive(true);
    arm(SHOW_MS);
  });
  flowApi.answer.onSpeechEnd(() => setSpeaking(false));
  flowApi.answer.onFade(() => fade());

  card.addEventListener('pointerenter', () => {
    hovering = true;
    clearTimeout(timer);
    card.classList.remove('out');
    card.classList.add('in');
    flowApi.answer.interactive(true);
    flowApi.answer.hover(true);
  });
  card.addEventListener('pointerleave', () => {
    hovering = false;
    flowApi.answer.interactive(false);
    flowApi.answer.hover(false);
    if (!speaking) arm(AFTER_HOVER_MS);
  });

  // Drag the card by any part of it except the buttons; it stays where it is dropped.
  let drag: { x: number; y: number } | null = null;
  let dragged = false;
  card.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    card.setPointerCapture(e.pointerId);
    drag = { x: e.screenX, y: e.screenY };
    dragged = false;
    const r = card.getBoundingClientRect();
    flowApi.answer.dragStart({ left: r.left, top: r.top, width: r.width, height: r.height });
  });
  card.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.screenX - drag.x;
    const dy = e.screenY - drag.y;
    if (!dragged && Math.hypot(dx, dy) < 4) return; // a click, not a drag
    dragged = true;
    card.classList.add('dragging');
    flowApi.answer.drag(dx, dy);
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    card.classList.remove('dragging');
    if (dragged) flowApi.answer.dragEnd();
  };
  card.addEventListener('pointerup', endDrag);
  card.addEventListener('pointercancel', endDrag);

  copy.addEventListener('click', () => {
    flowApi.answer.copy();
    copy.classList.add('done');
    setTimeout(() => copy.classList.remove('done'), 1200);
  });
  speak.addEventListener('click', () => {
    if (speaking) flowApi.answer.stop();
    else flowApi.answer.speak();
    setSpeaking(!speaking);
  });
  document.getElementById('done')?.addEventListener('click', () => flowApi.answer.reminderDone());
  document.getElementById('snooze')?.addEventListener('click', () => flowApi.answer.reminderSnooze());
})();

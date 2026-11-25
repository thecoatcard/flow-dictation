/** One piece of an answer, as the app sends it: prose, or a fenced code block with its language. */
type AnswerPartDto = { kind: 'text'; text: string } | { kind: 'code'; text: string; lang: string };

// Renderer for the card that grows out of the icon. Text is only ever set with textContent, so an answer or a
// reminder cannot inject markup.
(() => {
  const card = document.getElementById('card') as HTMLDivElement;
  const a = document.getElementById('a') as HTMLDivElement;
  const meta = document.getElementById('meta') as HTMLElement;
  const copy = document.getElementById('copy') as HTMLButtonElement;
  const speak = document.getElementById('speak') as HTMLButtonElement;

  const SHOW_MS = 8_000; // an answer fades by itself after this long if the pointer is not on it
  const AFTER_HOVER_MS = 5_000; // and this long after the pointer leaves
  const content = document.getElementById('body')!;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const tokens = getComputedStyle(document.documentElement);
  const duration = (speed: 'base' | 'slow') =>
    parseFloat(tokens.getPropertyValue(reduced.matches ? '--motion-fast' : `--motion-${speed}`));
  let entrance: Animation | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hovering = false;
  let speaking = false;
  let reminder = false; // a reminder card stays while the pointer is on the icon or card; the app closes it

  const fade = () => {
    if (card.classList.contains('out')) return;
    clearTimeout(timer);
    entrance?.cancel();
    card.classList.add('out');
    timer = setTimeout(() => flowApi.answer.close(), duration('base'));
  };
  /** Starts the countdown for an answer; it waits while the pointer is on the card or the answer is being read. */
  const arm = (ms: number) => {
    if (reminder || card.classList.contains('out')) return;
    clearTimeout(timer);
    timer = setTimeout(() => (hovering || speaking ? arm(AFTER_HOVER_MS) : fade()), ms);
  };
  const setSpeaking = (on: boolean) => {
    speaking = on;
    speak.classList.toggle('on', on);
    speak.title = on ? 'Stop reading' : 'Read aloud';
    speak.setAttribute('aria-label', on ? 'Stop reading the answer' : 'Read the answer aloud');
    if (!on && !hovering) arm(AFTER_HOVER_MS);
  };

  /** `code` spans inside a line of prose; everything is set with textContent, so nothing can become markup. */
  const prose = (text: string): HTMLParagraphElement => {
    const p = document.createElement('p');
    p.className = 'prose';
    text.split(/(`[^`\n]+`)/g).forEach((piece) => {
      if (piece.length > 2 && piece.startsWith('`') && piece.endsWith('`')) {
        const c = document.createElement('code');
        c.className = 'inline';
        c.textContent = piece.slice(1, -1);
        p.append(c);
      } else if (piece) {
        p.append(document.createTextNode(piece));
      }
    });
    return p;
  };
  /** A code block: its language, a Copy button that copies just this code, and the code in a monospace box. */
  const codeBlock = (lang: string, code: string): HTMLDivElement => {
    const box = document.createElement('div');
    box.className = 'code';
    const head = document.createElement('div');
    head.className = 'code-head';
    const label = document.createElement('span');
    label.className = 'lang';
    label.textContent = lang || 'code';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', `Copy the ${lang || 'code'} code`);
    button.addEventListener('click', () => {
      flowApi.answer.copyText(code);
      button.textContent = 'Copied';
      button.classList.add('done');
      setTimeout(() => {
        button.textContent = 'Copy';
        button.classList.remove('done');
      }, 1400);
    });
    head.append(label, button);
    const pre = document.createElement('pre');
    const body = document.createElement('code');
    body.textContent = code;
    pre.append(body);
    box.append(head, pre);
    return box;
  };
  const renderParts = (parts: AnswerPartDto[] | undefined, fallback: string) => {
    const list = parts?.length ? parts : [{ kind: 'text' as const, text: fallback }];
    a.replaceChildren(
      ...list.map((p) => (p.kind === 'code' ? codeBlock(p.lang, p.text) : prose(p.text))),
    );
    card.classList.toggle('wide', list.some((p) => p.kind === 'code'));
  };

  // The app tells the page where the pointer really is, so fading and hover never depend on pointer events
  // that a click-through window may not receive.
  const setHovering = (on: boolean) => {
    hovering = on;
    if (on) {
      clearTimeout(timer);
      if (card.classList.contains('out')) card.classList.add('returning');
      card.classList.remove('out');
      card.classList.add('in');
    } else if (!speaking) {
      arm(AFTER_HOVER_MS);
    }
  };
  flowApi.answer.onPointer(setHovering);
  // Which side of the card the icon is on can change when the card is placed to fit the screen.
  flowApi.answer.onOrigin((o) => {
    card.style.transformOrigin = `${o.originX - card.offsetLeft}px ${o.up ? "100%" : "0%"}`;
  });
  // Tell the app how big the card is whenever that changes, so the window is placed to fit it.
  const report = () =>
    flowApi.answer.rect({
      left: card.offsetLeft,
      top: card.offsetTop,
      width: card.offsetWidth,
      height: card.offsetHeight,
    });
  new ResizeObserver(report).observe(card);

  flowApi.answer.onShow((d) => {
    clearTimeout(timer);
    const swapping =
      reminder &&
      d.kind === 'reminder' &&
      card.classList.contains('in') &&
      !card.classList.contains('out');
    const changed = a.textContent !== d.answer || meta.textContent !== (d.meta ?? '');
    reminder = d.kind === 'reminder';
    document.body.classList.toggle('down', !d.up);
    card.classList.toggle('reminder', reminder);
    card.classList.remove('out', 'returning');
    if (changed) {
      renderParts(d.parts, d.answer);
      a.scrollTop = 0;
      meta.textContent = d.meta ?? '';
    }
    copy.classList.remove('done');
    setSpeaking(false);
    card.style.transformOrigin = `${d.originX - card.offsetLeft}px ${d.up ? '100%' : '0%'}`;
    card.classList.add('in');
    if (!swapping || changed) {
      entrance?.cancel();
      const first = reduced.matches
        ? { opacity: 0 }
        : swapping
          ? { opacity: 0, transform: 'translateY(3px)' }
          : { opacity: 0, transform: 'scale(.76)' };
      entrance = (swapping ? content : card).animate([first, { opacity: 1, transform: 'none' }], {
        duration: duration(swapping ? 'base' : 'slow'),
        easing: tokens.getPropertyValue('--ease-enter').trim(),
      });
    }
    arm(SHOW_MS);
  });
  flowApi.answer.onSpeechEnd(() => setSpeaking(false));
  flowApi.answer.onFade(() => fade());

  card.addEventListener('pointerenter', () => setHovering(true));
  card.addEventListener('pointerleave', () => setHovering(false));

  // Drag the card by any part of it except the buttons; it stays where it is dropped.
  let drag: { x: number; y: number } | null = null;
  let dragged = false;
  card.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    card.setPointerCapture(e.pointerId);
    drag = { x: e.screenX, y: e.screenY };
    dragged = false;
    if (entrance?.pending || entrance?.playState === 'running') entrance.finish();
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
  card.addEventListener('lostpointercapture', endDrag);
  // Report the card at the start of a drag too, so it is kept on screen by its real size.

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
  document
    .getElementById('snooze')
    ?.addEventListener('click', () => flowApi.answer.reminderSnooze());
})();

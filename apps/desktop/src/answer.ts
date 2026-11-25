// Renderer for the answer popup. Text is only ever set with textContent, so an answer cannot inject markup.
(() => {
  const card = document.getElementById('card') as HTMLDivElement;
  const a = document.getElementById('a') as HTMLParagraphElement;
  const copy = document.getElementById('copy') as HTMLButtonElement;
  const speak = document.getElementById('speak') as HTMLButtonElement;

  const SHOW_MS = 15_000; // fades by itself after this long if nobody is looking at it
  const AFTER_HOVER_MS = 5_000; // and this long after the pointer leaves
  const FADE_MS = 440;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hovering = false;
  let speaking = false;

  const fade = () => {
    card.classList.add('out');
    flowApi.answer.interactive(false);
    timer = setTimeout(() => flowApi.answer.close(), FADE_MS);
  };
  /** Starts the countdown; it waits while the pointer is on the card or the answer is being read. */
  const arm = (ms: number) => {
    clearTimeout(timer);
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
    hovering = false;
    document.body.classList.toggle('down', !d.up);
    card.className = '';
    a.textContent = d.answer;
    a.scrollTop = 0;
    card.title = d.question;
    copy.classList.remove('done');
    setSpeaking(false);
    // Grow out of the icon: the card's origin is the icon's centre, on the edge facing it.
    card.style.transformOrigin = `${d.originX - card.offsetLeft}px ${d.up ? '100%' : '0%'}`;
    void card.offsetWidth; // start from the small state, then open
    card.classList.add('in');
    arm(SHOW_MS);
  });
  flowApi.answer.onSpeechEnd(() => setSpeaking(false));

  card.addEventListener('pointerenter', () => {
    hovering = true;
    clearTimeout(timer);
    card.classList.remove('out');
    card.classList.add('in');
    flowApi.answer.interactive(true);
  });
  card.addEventListener('pointerleave', () => {
    hovering = false;
    flowApi.answer.interactive(false);
    if (!speaking) arm(AFTER_HOVER_MS);
  });

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
})();

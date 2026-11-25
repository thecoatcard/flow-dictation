// Renderer for the answer popup. Text is only ever set with textContent, so an answer cannot inject markup.
(() => {
  const q = document.getElementById('q') as HTMLParagraphElement;
  const a = document.getElementById('a') as HTMLParagraphElement;
  const speak = document.getElementById('speak') as HTMLButtonElement;
  let speaking = false;

  const setSpeaking = (on: boolean) => {
    speaking = on;
    speak.textContent = on ? 'Stop' : 'Read aloud';
  };

  flowApi.answer.onShow((d) => {
    q.textContent = d.question;
    q.title = d.question;
    a.textContent = d.answer;
    a.scrollTop = 0;
    setSpeaking(false);
    document.getElementById('close')?.focus();
  });
  flowApi.answer.onSpeechEnd(() => setSpeaking(false));

  document.getElementById('copy')?.addEventListener('click', (e) => {
    flowApi.answer.copy();
    (e.target as HTMLButtonElement).textContent = 'Copied';
    setTimeout(() => ((e.target as HTMLButtonElement).textContent = 'Copy'), 1200);
  });
  speak.addEventListener('click', () => {
    if (speaking) flowApi.answer.stop();
    else flowApi.answer.speak();
    setSpeaking(!speaking);
  });
  document.getElementById('close')?.addEventListener('click', () => flowApi.answer.close());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') flowApi.answer.close();
  });
})();

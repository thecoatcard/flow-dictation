(() => {
  const api = flowApi.settings;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const on = (id: string, ev: string, fn: (e: Event) => void) => $(id).addEventListener(ev, fn);
  const say = (el: HTMLElement, text: string, err = false) => {
    el.textContent = text;
    el.classList.toggle('err', err);
  };

  // Wait for this element's CSS motion, including when it is cancelled by navigation.
  const afterMotion = async (el: HTMLElement) => {
    await Promise.allSettled(el.getAnimations().map((animation) => animation.finished));
  };
  const failure = (text: string) => () => toast(text, 'err');

  // ---------- toasts ----------
  const CHECK = '<svg aria-hidden="true" viewBox="0 0 20 20"><path d="M4 10.5l4 4 8-9"/></svg>';
  const WARN = '<svg aria-hidden="true" viewBox="0 0 20 20"><path d="M10 4v7M10 15.5v.5"/></svg>';
  function toast(text: string, kind: 'ok' | 'err' = 'ok'): void {
    const host = $('toasts');
    while (host.children.length >= 3) host.firstElementChild?.remove();
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.innerHTML = kind === 'ok' ? CHECK : WARN; // static markup only; the message is added as text
    t.append(document.createTextNode(text));
    host.append(t);
    setTimeout(
      () => {
        t.classList.add('leaving');
        void afterMotion(t).then(() => t.remove());
      },
      kind === 'err' ? 4200 : 2200,
    );
  }

  const busy = (btn: HTMLElement, v: boolean) => {
    btn.classList.toggle('busy', v);
    (btn as HTMLButtonElement).disabled = v;
    btn.setAttribute('aria-busy', String(v));
  };

  // ---------- navigation ----------
  const nav = $('nav');
  const navButtons = Array.from(nav.querySelectorAll<HTMLButtonElement>('button'));
  const indicator = nav.querySelector<HTMLElement>('.nav-ind')!;
  const pageHooks: Record<string, () => void> = {};

  const main = $('settings-main');
  const exitLayer = $('page-exit');
  const motion = getComputedStyle(document.documentElement);
  let activePage = $('page-dictation');
  let finishExit: (() => void) | undefined;

  // Keep navigation motion inside the pane so dialogs and toasts can animate independently.
  function showPage(section: HTMLElement): void {
    if (activePage === section) return;
    finishExit?.();
    const previous = activePage;
    const scroll = main.scrollTop;
    exitLayer.hidden = false;
    exitLayer.append(previous);
    exitLayer.scrollTop = scroll;
    section.hidden = false;
    activePage = section;

    const fade = exitLayer.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: parseFloat(motion.getPropertyValue('--motion-fast')),
      easing: motion.getPropertyValue('--ease-exit').trim(),
      fill: 'forwards',
    });
    const finish = () => {
      if (finishExit !== finish) return;
      finishExit = undefined;
      exitLayer.hidden = true;
      previous.hidden = true;
      main.append(previous);
      fade.cancel();
    };
    finishExit = finish;
    void fade.finished.then(finish, finish);
  }

  function go(page: string, focusContent = false): void {
    if (!navButtons.some((button) => button.dataset.page === page)) return;
    navButtons.forEach((button, index) => {
      if (button.dataset.page === page) {
        button.setAttribute('aria-current', 'page');
        indicator.style.setProperty('--nav-index', String(index));
      } else button.removeAttribute('aria-current');
    });
    const section = $('page-' + page);
    showPage(section);
    main.scrollTop = 0;
    if (focusContent) {
      const heading = section.querySelector('h1')!;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    pageHooks[page]?.();
  }
  navButtons.forEach((b) =>
    b.addEventListener('click', (e) => go(b.dataset.page!, e.detail === 0)),
  );

  // ---------- segmented controls ----------
  function seg(id: string, pick: (v: string) => void): (v: string) => void {
    const el = $(id);
    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('button'));
    el.style.setProperty('--count', String(buttons.length));
    const paint = (value: string) => {
      const selected = buttons.findIndex((b) => b.dataset.v === value);
      buttons.forEach((b, index) => {
        b.setAttribute('aria-checked', String(index === selected));
        b.tabIndex = index === Math.max(0, selected) ? 0 : -1;
      });
      el.toggleAttribute('data-ready', selected >= 0);
      el.style.setProperty('--selected', String(Math.max(0, selected)));
    };
    const choose = (button: HTMLButtonElement) => {
      if (button.getAttribute('aria-checked') === 'true') return;
      const value = button.dataset.v!;
      paint(value);
      pick(value);
    };
    buttons.forEach((button, index) => {
      button.addEventListener('click', () => choose(button));
      button.addEventListener('keydown', (event) => {
        const previous = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
        if (!previous && event.key !== 'ArrowRight' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const next = buttons[(index + (previous ? -1 : 1) + buttons.length) % buttons.length]!;
        next.focus();
        choose(next);
      });
    });
    paint('');
    return paint;
  }

  // ---------- settings ----------
  const hotkey = $<HTMLSelectElement>('hotkey');
  const mic = $<HTMLSelectElement>('mic');
  const autostart = $('autostart');
  const save = (patch: Partial<SettingsDto['app']>, message = 'Saved') =>
    void api
      .set(patch)
      .then((s) => {
        apply(s);
        toast(message);
      })
      .catch(() => {
        if (latest) apply(latest);
        toast('Could not save this setting. Try again.', 'err');
      });

  const setMode = seg('mode', (v) => save({ mode: v as 'hold' | 'toggle' }));
  const setOverlay = seg('overlay', (v) => save({ overlay: v as 'always' | 'active' }));

  function apply(s: SettingsDto): void {
    const custom = !s.hotkeys.some((h) => h.id === s.app.hotkey);
    hotkey.replaceChildren(
      ...s.hotkeys.map((h) => new Option(h.label, h.id, false, h.id === s.app.hotkey)),
      ...(custom ? [new Option(`Custom: ${s.app.hotkey}`, s.app.hotkey, false, true)] : []),
    );
    setMode(s.app.mode);
    setOverlay(s.app.overlay);
    autostart.setAttribute('aria-checked', String(s.app.autostart));
    $('keephistory').setAttribute('aria-checked', String(s.app.keepHistory));
    $('askusesnotes').setAttribute('aria-checked', String(s.app.askUsesNotes));
    latest = s;
    renderGuide();
    $('usecontext').setAttribute('aria-checked', String(s.app.useWindowContext));
    $('cmdkey').textContent = s.app.commandHotkey || 'Off';
    if (!s.app.commandHotkey && document.activeElement === $('cmdoff')) $('reccmd').focus();
    $('cmdoff').style.display = s.app.commandHotkey ? '' : 'none';
    $('askkey').textContent = s.app.askHotkey || 'Off';
    if (!s.app.askHotkey && document.activeElement === $('askoff')) $('recask').focus();
    $('askoff').style.display = s.app.askHotkey ? '' : 'none';
    $('soundcues').setAttribute('aria-checked', String(s.app.soundCues));
    $('mutewhile').setAttribute('aria-checked', String(s.app.muteWhileDictating));
    $('autonote').textContent = s.packaged
      ? 'Launch Flow quietly in the tray when you sign in.'
      : 'Works in the built app only, not in development runs.';
    if (s.app.micDeviceId && !Array.from(mic.options).some((o) => o.value === s.app.micDeviceId))
      mic.add(new Option('Saved microphone (not found right now)', s.app.micDeviceId));
    mic.value = s.app.micDeviceId;
    $<HTMLInputElement>('rate').value = String(s.app.sttUsdPerHour);

    $('keychip').className = `chip ${s.hasKey ? 'ok' : 'warn'}`;
    $('keychiptext').textContent = s.hasKey ? 'Key saved' : 'No key yet';
    ($('savekey') as HTMLButtonElement).disabled = !s.secureStorage;
    if (!s.secureStorage)
      say(
        $('keymsg'),
        'Secure storage is not available on this PC, so a key cannot be saved.',
        true,
      );

    const label =
      s.hotkeys.find((h) => h.id === s.app.hotkey)?.label ?? s.app.hotkey ?? 'your hotkey';
    $('raildot').className = `dot ${s.hasKey ? 'ok' : 'warn'}`;
    $('railtext').textContent = s.hasKey
      ? `${s.app.hotkey === 'F23' ? 'Tap' : s.app.mode === 'hold' ? 'Hold' : 'Press'} ${label} to dictate`
      : 'Add your API key to start';
  }

  hotkey.addEventListener('change', () => save({ hotkey: hotkey.value }, 'Hotkey saved'));

  // Test my key: some keys (a laptop Copilot key) report press and release together and cannot be held.
  const keyTestBtn = $<HTMLButtonElement>('keytestbtn');
  const keyTestMsg = $('keytestmsg');
  let keyTestActive = false;
  let keyDownAt = 0;
  let keyRepeats = 0;
  let keyTestTimer: ReturnType<typeof setTimeout> | undefined;
  const endKeyTest = () => {
    keyTestActive = false;
    clearTimeout(keyTestTimer);
    keyTestBtn.textContent = 'Test my key';
  };
  api.onKeyTest((e) => {
    if (!keyTestActive) return;
    if (e.type === 'down') {
      if (keyDownAt)
        keyRepeats++; // the system repeats a key that is really being held
      else keyDownAt = e.at;
      say(keyTestMsg, 'Holding…');
      return;
    }
    if (!keyDownAt) return;
    const ms = e.at - keyDownAt;
    endKeyTest();
    if (ms < 150 && keyRepeats === 0)
      say(
        keyTestMsg,
        `This key sent press and release together (${ms} ms), so it cannot be held. It works as tap to start and tap again to stop. For hold-to-talk, choose another key such as Right Ctrl.`,
        true,
      );
    else
      say(
        keyTestMsg,
        `Held for ${(ms / 1000).toFixed(1)} seconds. This key works for hold-to-talk.`,
      );
  });
  keyTestBtn.addEventListener('click', () => {
    if (keyTestActive) return endKeyTest();
    keyTestActive = true;
    keyDownAt = 0;
    keyRepeats = 0;
    keyTestBtn.textContent = 'Cancel test';
    say(keyTestMsg, 'Press and hold your hotkey for two seconds, then let go.');
    void api.startKeyTest();
    keyTestTimer = setTimeout(() => {
      endKeyTest();
      say(keyTestMsg, 'No key press was seen. Check that the right hotkey is selected.', true);
    }, 20_000);
  });

  // Record a combination: hold modifiers, press a key. Esc cancels.
  const keyName = (code: string): string | undefined => {
    const m = /^Key([A-Z])$/.exec(code) ?? /^Digit(\d)$/.exec(code);
    if (m) return m[1];
    if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
    const named = new Set([
      'Space',
      'Enter',
      'Tab',
      'Backspace',
      'Delete',
      'Insert',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
    ]);
    return named.has(code) ? code : undefined;
  };
  /** Wires a "Record shortcut" button to a setting that holds a combination like Ctrl+Alt+D. */
  function shortcutRecorder(
    button: HTMLButtonElement,
    field: 'hotkey' | 'commandHotkey' | 'askHotkey',
  ): void {
    const idle = 'Record shortcut';
    const stop = () => {
      button.textContent = idle;
      window.removeEventListener('keydown', onKey, true);
    };
    function onKey(e: KeyboardEvent): void {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return stop();
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return; // wait for the real key
      const mods = [
        e.ctrlKey && 'Ctrl',
        e.altKey && 'Alt',
        e.shiftKey && 'Shift',
        e.metaKey && 'Win',
      ];
      const name = keyName(e.code);
      if (!name) return toast('That key cannot be used in a shortcut', 'err');
      if (!mods.some(Boolean)) return toast('Hold Ctrl, Alt or Shift with the key', 'err');
      stop();
      const combo = [...mods.filter(Boolean), name].join('+');
      save({ [field]: combo }, 'Shortcut saved');
    }
    button.addEventListener('click', () => {
      if (button.textContent !== idle) return stop();
      button.textContent = 'Press your shortcut… (Esc to cancel)';
      window.addEventListener('keydown', onKey, true);
    });
  }
  shortcutRecorder($<HTMLButtonElement>('rechotkey'), 'hotkey');
  shortcutRecorder($<HTMLButtonElement>('reccmd'), 'commandHotkey');
  on('cmdoff', 'click', () => save({ commandHotkey: '' }, 'Command Mode is off'));
  shortcutRecorder($<HTMLButtonElement>('recask'), 'askHotkey');
  on('askoff', 'click', () => save({ askHotkey: '' }, 'Ask is off'));
  mic.addEventListener('change', () => save({ micDeviceId: mic.value }, 'Microphone saved'));
  autostart.addEventListener('click', () =>
    save({ autostart: autostart.getAttribute('aria-checked') !== 'true' }),
  );
  on('resetpos', 'click', () => save({ overlayPos: null }, 'Icon moved back'));
  on('refreshmics', 'click', () => {
    const btn = $('refreshmics');
    busy(btn, true);
    void api
      .listMics()
      .then((list) => {
        const keep = mic.value;
        mic.replaceChildren(
          new Option('System default', ''),
          ...list.map((d) => new Option(d.label, d.id)),
        );
        mic.value = keep;
        toast(
          list.length
            ? `Found ${list.length} microphone${list.length === 1 ? '' : 's'}`
            : 'No microphones found',
          list.length ? 'ok' : 'err',
        );
      })
      .catch(failure('Could not find microphones. Try again.'))
      .finally(() => busy(btn, false));
  });

  // ---------- API key ----------
  const keyInput = $<HTMLInputElement>('key');
  on('showkey', 'click', () => {
    const show = keyInput.type === 'password';
    keyInput.type = show ? 'text' : 'password';
    $('showkey').textContent = show ? 'Hide' : 'Show';
    $('showkey').setAttribute('aria-pressed', String(show));
  });
  on('savekey', 'click', () => {
    void api.setKey(keyInput.value).then(async (r) => {
      if (!r.ok) return say($('keymsg'), r.error ?? 'Could not save the key.', true);
      keyInput.value = '';
      say($('keymsg'), '');
      apply(await api.get());
      toast('Key saved');
    });
  });
  on('testkey', 'click', () => {
    const btn = $('testkey');
    busy(btn, true);
    say($('keymsg'), '');
    void api
      .testKey()
      .then((r) => {
        $('keychip').className = `chip ${r.ok ? 'ok' : 'bad'}`;
        $('keychiptext').textContent = r.ok ? 'Key works' : 'Key rejected';
        say($('keymsg'), r.ok ? 'Key works.' : r.message, !r.ok);
        if (r.ok) return api.set({ keyTested: true }).then(apply);
      })
      .catch(() => say($('keymsg'), 'Could not test the key. Try again.', true))
      .finally(() => busy(btn, false));
  });
  on('clearkey', 'click', () => {
    void api.clearKey().then(async () => {
      apply(await api.get());
      toast('Key removed');
    });
  });

  // ---------- microphone check: a live trace of the real mic level ----------
  const BARS = 64;
  const levels: number[] = new Array<number>(BARS).fill(0);
  let lastPush = 0;
  let recording = false;
  let frame = 0;
  const canvas = $<HTMLCanvasElement>('wave');
  const g = canvas.getContext('2d')!;

  function draw(): void {
    frame = 0;
    if (canvas.closest('.page')?.hasAttribute('hidden')) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    g.fillStyle = css.getPropertyValue(recording ? '--rec' : '--accent').trim();
    const step = w / BARS;
    const slide = reducedMotion.matches ? 0 : Math.min(1, (performance.now() - lastPush) / 100); // glide between 100 ms samples
    for (let i = 0; i < BARS; i++) {
      const bh = Math.max(2, levels[i]! * h * 0.92);
      g.globalAlpha = 0.25 + 0.75 * (i / BARS);
      g.beginPath();
      g.roundRect((i - slide) * step + step * 0.2, (h - bh) / 2, step * 0.6, bh, step * 0.3);
      g.fill();
    }
    g.globalAlpha = 1;
    // keep animating while recording or while the trace is still sliding out
    if (recording || performance.now() - lastPush < BARS * 100) frame = requestAnimationFrame(draw);
  }
  const kick = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  api.onLevel((v) => {
    levels.push(v);
    levels.shift();
    lastPush = performance.now();
    kick();
  });
  window.addEventListener('resize', kick);
  requestAnimationFrame(draw);

  on('rec', 'click', () => {
    const btn = $('rec');
    const scope = $('scope');
    $('recresult').replaceChildren();
    btn.textContent = 'Listening…';
    (btn as HTMLButtonElement).disabled = true;
    scope.classList.add('live');
    recording = true;
    kick();
    void api.recordDebug(5).then((r) => {
      recording = false;
      scope.classList.remove('live');
      (btn as HTMLButtonElement).disabled = false;
      btn.textContent = 'Check again';
      const box = document.createElement('div');
      box.className = `result${r.ok ? '' : ' err'}`;
      if (!r.ok) {
        box.textContent = r.error ?? 'The check failed.';
      } else if (!r.text) {
        box.textContent = 'No speech heard. Check that the right microphone is selected.';
      } else {
        box.textContent = r.text;
        void api.set({ micChecked: true }).then(apply);
        const small = document.createElement('small');
        small.textContent = `Transcribed in ${r.finalizeMs} ms${r.timedOut ? ' (partial text: the final one was late)' : ''}`;
        box.append(small);
      }
      $('recresult').replaceChildren(box);
    });
  });

  // ---------- words and tone ----------
  const TONES: Tone[] = ['casual', 'professional', 'literal', 'code'];
  const toneSelect = (sel: HTMLSelectElement, value?: Tone) =>
    sel.replaceChildren(
      ...TONES.map((t) => new Option(t[0]!.toUpperCase() + t.slice(1), t, false, t === value)),
    );
  let personal: PersonalDto;
  const cleanupHelp: Record<CleanupLevel, string> = {
    none: 'Paste the raw transcript. Spoken line breaks and saved snippets still work.',
    auto: 'Leave clean speech alone; use Light for small fixes and Medium only when wording is tangled.',
    light:
      'Remove fillers, accidental repeats and clear false starts; fix grammar with minimal rewriting.',
    medium: 'Also reword tangled phrases for clarity and concision while keeping your meaning.',
  };
  const setCleanupLevel = seg('cleanupLevel', (value) => {
    $('cleanupHelp').textContent = cleanupHelp[value as CleanupLevel];
    savePersonal({ cleanupLevel: value as CleanupLevel }, '', 'Cleanup level saved');
  });
  const hindiHelp: Record<HindiOutput, string> = {
    hinglish: 'Hindi speech is typed in English letters, like “main kal office jaunga”.',
    devanagari: 'Hindi speech is typed in Devanagari, like “मैं कल ऑफिस जाऊँगा”.',
  };
  const setHindiOutput = seg('hindiOutput', (value) => {
    $('hindiHelp').textContent = hindiHelp[value as HindiOutput];
    savePersonal({ hindiOutput: value as HindiOutput }, '', 'Hindi style saved');
  });
  on('smartformat', 'click', () =>
    savePersonal(
      { smartFormatting: $('smartformat').getAttribute('aria-checked') !== 'true' },
      '',
      'Formatting saved',
    ),
  );
  $<HTMLSelectElement>('outputLanguage').addEventListener('change', (e) =>
    savePersonal(
      { outputLanguage: (e.target as HTMLSelectElement).value },
      '',
      'Writing language saved',
    ),
  );
  let fresh = ''; // key of the row the user just added, so only that row animates in

  function listRow(
    key: string,
    name: string,
    note: string | undefined,
    onRemove: () => Promise<void>,
    extra?: HTMLElement,
  ): HTMLLIElement {
    const li = document.createElement('li');
    li.dataset.key = key;
    if (key === fresh) li.classList.add('in');
    const d = document.createElement('div');
    const n = document.createElement('span');
    n.className = 'name';
    n.textContent = name;
    if (note) {
      const s = document.createElement('small');
      s.textContent = note;
      n.append(s);
    }
    d.append(n);
    if (extra) d.append(extra);
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn quiet';
    rm.textContent = 'Remove';
    rm.setAttribute('aria-label', `Remove ${name}`);
    rm.addEventListener('click', () => removeRow(li, onRemove));
    d.append(rm);
    li.append(d);
    return li;
  }
  const emptyRow = (text: string) => {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = text;
    return li;
  };
  const listFallback: Record<string, string> = {
    apptones: 'appname',
    dict: 'term',
    snips: 'trigger',
    histlist: 'histq',
    remlist: 'page-memory',
    notelist: 'page-memory',
  };
  const focusListFallback = (list: HTMLElement) => {
    const target = $(listFallback[list.id]!);
    if (!target) return;
    if (target.tagName === 'SECTION') target.tabIndex = -1;
    target.focus({ preventScroll: true });
  };
  const replaceRows = (list: HTMLElement, ...rows: HTMLElement[]) => {
    const active = document.activeElement as HTMLElement | null;
    const row = active?.closest<HTMLLIElement>('li');
    const index = row?.parentElement === list ? Array.from(list.children).indexOf(row) : -1;
    const controlType = 'button, select, textarea';
    const control =
      row && active ? Array.from(row.querySelectorAll(controlType)).indexOf(active) : -1;
    list.replaceChildren(...rows);
    if (index < 0) return;
    const replacement =
      rows.find((item) => row?.dataset.key && item.dataset.key === row.dataset.key) ??
      rows[Math.min(index, rows.length - 1)];
    const options = replacement?.querySelectorAll<HTMLElement>(controlType);
    const next = options?.[control] ?? options?.[0];
    if (next) next.focus({ preventScroll: true });
    else focusListFallback(list);
  };
  async function removeRow(li: HTMLElement, remove: () => void | Promise<void>): Promise<void> {
    if (li.inert) return;
    const list = li.parentElement!;
    if (li.contains(document.activeElement)) {
      const next = (li.nextElementSibling ?? li.previousElementSibling)?.querySelector('button');
      if (next) next.focus({ preventScroll: true });
      else focusListFallback(list);
    }
    li.inert = true;
    li.classList.add('out');
    await afterMotion(li);
    try {
      await remove();
    } catch {
      li.inert = false;
      li.classList.remove('out');
      toast('Could not remove this item. Try again.', 'err');
    }
  }
  const storePersonal = (patch: Partial<PersonalDto>, key = '', message = '') =>
    api.setPersonal(patch).then((p) => {
      fresh = key;
      showPersonal(p);
      fresh = '';
      if (message) toast(message);
    });
  const savePersonal = (patch: Partial<PersonalDto>, key = '', message = '') =>
    void storePersonal(patch, key, message).catch(
      failure('Could not save your changes. Try again.'),
    );

  function showPersonal(p: PersonalDto): void {
    personal = p;
    setCleanupLevel(p.cleanupLevel);
    $('cleanupHelp').textContent = cleanupHelp[p.cleanupLevel];
    setHindiOutput(p.hindiOutput);
    $('hindiHelp').textContent = hindiHelp[p.hindiOutput];
    $<HTMLSelectElement>('outputLanguage').value = p.outputLanguage;
    $('smartformat').setAttribute('aria-checked', String(p.smartFormatting));
    toneSelect($<HTMLSelectElement>('deftone'), p.defaultTone);
    toneSelect($<HTMLSelectElement>('apptone'), 'professional');
    $('recent').replaceChildren(...p.recentApps.map((a) => new Option(a, a)));
    $<HTMLTextAreaElement>('style').value = p.style;

    const apps = Object.entries(p.appTones);
    replaceRows(
      $('apptones'),
      ...(apps.length
        ? apps.map(([app, tone]) => {
            const sel = document.createElement('select');
            toneSelect(sel, tone);
            sel.setAttribute('aria-label', `Tone for ${app}`);
            sel.addEventListener('change', () =>
              savePersonal(
                { appTones: { ...p.appTones, [app]: sel.value as Tone } },
                '',
                'Tone saved',
              ),
            );
            return listRow(
              `app:${app}`,
              app,
              undefined,
              () => {
                const next = { ...p.appTones };
                delete next[app];
                return storePersonal({ appTones: next });
              },
              sel,
            );
          })
        : [emptyRow('No app has its own tone yet.')]),
    );
    replaceRows(
      $('dict'),
      ...(p.dictionary.length
        ? p.dictionary.map((d, i) =>
            listRow(`term:${d.term}`, d.term, d.hint, () =>
              storePersonal({ dictionary: p.dictionary.filter((_, j) => j !== i) }),
            ),
          )
        : [emptyRow('No terms yet.')]),
    );
    replaceRows(
      $('snips'),
      ...(p.snippets.length
        ? p.snippets.map((s, i) =>
            listRow(`snip:${s.trigger}`, `“${s.trigger}”`, `types ${s.expansion}`, () =>
              storePersonal({ snippets: p.snippets.filter((_, j) => j !== i) }),
            ),
          )
        : [emptyRow('No snippets yet.')]),
    );
  }

  const field = (id: string) => $<HTMLInputElement>(id);
  const adder = (inputs: string[], button: string, run: () => void) => {
    on(button, 'click', run);
    for (const id of inputs)
      on(id, 'keydown', (e) => (e as KeyboardEvent).key === 'Enter' && run());
  };
  const appKey = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/\.exe$/, '');

  on('deftone', 'change', () =>
    savePersonal({ defaultTone: $<HTMLSelectElement>('deftone').value as Tone }, '', 'Tone saved'),
  );
  adder(['appname'], 'addapp', () => {
    const app = appKey(field('appname').value);
    if (!app) return field('appname').focus();
    const tone = $<HTMLSelectElement>('apptone').value as Tone;
    savePersonal({ appTones: { ...personal.appTones, [app]: tone } }, `app:${app}`);
    field('appname').value = '';
  });
  adder(['term', 'hint'], 'addterm', () => {
    const term = field('term').value.trim();
    if (!term) return field('term').focus();
    savePersonal(
      { dictionary: [...personal.dictionary, { term, hint: field('hint').value.trim() }] },
      `term:${term}`,
    );
    field('term').value = field('hint').value = '';
    field('term').focus();
  });
  adder(['trigger', 'expansion'], 'addsnip', () => {
    const trigger = field('trigger').value.trim();
    const expansion = field('expansion').value;
    if (!trigger) return field('trigger').focus();
    if (!expansion) return field('expansion').focus();
    savePersonal({ snippets: [...personal.snippets, { trigger, expansion }] }, `snip:${trigger}`);
    field('trigger').value = field('expansion').value = '';
    field('trigger').focus();
  });

  // ---------- writing style ----------
  on('savestyle', 'click', () =>
    savePersonal({ style: $<HTMLTextAreaElement>('style').value }, '', 'Style saved'),
  );
  on('learn', 'click', () => {
    const btn = $('learn');
    const samples = $<HTMLTextAreaElement>('samples')
      .value.split(/\n\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!samples.length)
      return say($('stylemsg'), 'Paste at least one piece of your writing first.', true);
    busy(btn, true);
    say($('stylemsg'), '');
    void api
      .learnStyle(samples)
      .then((r) => {
        if (!r.ok) return say($('stylemsg'), r.error ?? 'Could not draft a style.', true);
        $<HTMLTextAreaElement>('style').value = r.style ?? '';
        $<HTMLTextAreaElement>('samples').value = ''; // never kept
        say($('stylemsg'), 'Drafted in the box above. Edit it if you like, then save.');
        $('style').scrollIntoView({ block: 'center' });
        $('style').focus({ preventScroll: true });
      })
      .catch(() => say($('stylemsg'), 'Could not draft a style. Try again.', true))
      .finally(() => busy(btn, false));
  });

  // ---------- usage ----------
  const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
  function renderUsage(): void {
    const summary = $('usage-summary');
    const status = $('usage-status');
    if (summary.hidden) say(status, 'Loading usage…');
    void api
      .usage()
      .then((u) => {
        const [y, m] = u.month.split('-').map(Number);
        $('usagesub').textContent = new Date(y!, m! - 1, 1).toLocaleDateString(undefined, {
          month: 'long',
          year: 'numeric',
        });
        $('u-dict').textContent = String(u.totals.dictations);
        $('u-min').textContent = (u.totals.audioSeconds / 60).toFixed(1);
        $('u-cost').textContent = usd(u.cost.total);
        $('u-stt').textContent = `Speech ${usd(u.cost.stt)}`;
        $('u-cleanup').textContent = `Cleanup ${usd(u.cost.cleanup)}`;
        const total = u.cost.stt + u.cost.cleanup;
        const bars = [u.cost.stt, u.cost.cleanup].map((cost) => {
          const bar = document.createElement('i');
          bar.style.width = total > 0 ? `${(cost / total) * 100}%` : '0%';
          return bar;
        });
        $('u-chart').replaceChildren(...bars);
        summary.hidden = false;
        summary.classList.add('usage-ready');
        say(status, total > 0 ? '' : 'No estimated costs this month.');
        $('u-detail').textContent =
          `${u.totals.inputTokens} tokens in and ${u.totals.outputTokens} out. ` +
          'Cleanup uses Google’s list price of $0.30 / $2.50 per million tokens.';
      })
      .catch(() => say(status, 'Could not load usage. Try opening this page again.', true));
  }
  pageHooks['usage'] = renderUsage;
  on('saverate', 'click', () => {
    const rate = Number($<HTMLInputElement>('rate').value);
    if (!Number.isFinite(rate) || rate < 0) return toast('Enter a price of zero or more', 'err');
    void api
      .set({ sttUsdPerHour: rate })
      .then((s) => {
        apply(s);
        renderUsage();
        toast('Price saved');
      })
      .catch(failure('Could not save the price.'));
  });

  // ---------- permissions ----------
  const STATUS = { ok: 'Allowed', missing: 'Not allowed', manual: 'Cannot be checked' } as const;
  function renderPermissions(): void {
    const status = $('permissions-status');
    say(status, 'Checking permissions…');
    void api
      .permissions()
      .then((rows) => {
        say(status, rows.length ? 'Permissions checked.' : 'There are no permissions to check.');
        $('perms').replaceChildren(
          ...rows.map((r) => {
            const row = document.createElement('div');
            row.className = 'row perm';
            const left = document.createElement('div');
            const t = document.createElement('div');
            t.className = 't';
            const dot = document.createElement('span');
            dot.className = `dot ${r.status === 'ok' ? 'ok' : 'warn'}`;
            t.append(dot, `${r.name}: ${STATUS[r.status]}`);
            const d = document.createElement('div');
            d.className = 'd';
            d.textContent = r.help;
            left.append(t, d);
            const ctl = document.createElement('div');
            ctl.className = 'ctl';
            if (r.status !== 'ok') {
              const b = document.createElement('button');
              b.className = 'btn';
              b.textContent = 'Open system settings';
              b.addEventListener('click', () => api.openPermission(r.name));
              ctl.append(b);
            }
            row.append(left, ctl);
            return row;
          }),
        );
      })
      .catch(() => say(status, 'Could not check permissions. Try again.', true));
  }
  pageHooks['access'] = renderPermissions;
  on('recheck', 'click', renderPermissions);

  // ---------- backup ----------
  on(
    'export',
    'click',
    () =>
      void api
        .exportPersonal()
        .then((r) => {
          if (r.ok) toast('Backup exported');
        })
        .catch(failure('Could not export your backup.')),
  );
  on(
    'import',
    'click',
    () =>
      void api
        .importPersonal()
        .then((r) => {
          if (r.ok && r.personal) {
            showPersonal(r.personal);
            toast('Imported');
          } else if (r.error) toast(r.error, 'err');
        })
        .catch(failure('Could not import your backup.')),
  );

  on('playcue', 'click', () => void api.testCue());
  on('usecontext', 'click', () =>
    save({ useWindowContext: $('usecontext').getAttribute('aria-checked') !== 'true' }),
  );
  on('soundcues', 'click', () =>
    save({ soundCues: $('soundcues').getAttribute('aria-checked') !== 'true' }),
  );
  on('mutewhile', 'click', () =>
    save({ muteWhileDictating: $('mutewhile').getAttribute('aria-checked') !== 'true' }),
  );

  // ---------- first-run guide ----------
  let latest: SettingsDto | undefined;
  let dictations = 0;
  let showTips = false;
  const guide = $('guide');
  const guideSteps = $('guidesteps');
  function renderGuide(): void {
    const s = latest;
    if (!s || s.app.guideDismissed) {
      guide.hidden = true;
      return;
    }
    guide.hidden = false;
    const key = s.hotkeys.find((h) => h.id === s.app.hotkey)?.label ?? s.app.hotkey;
    interface Step {
      title: string;
      desc: string;
      done: boolean;
      action?: { label: string; disabled?: boolean; run: () => void };
    }
    const steps: Step[] = [
      {
        title: 'Add your Google API key',
        desc: 'Flow talks straight to Google with your own key. Paste it in the box below and press Save key.',
        done: s.hasKey,
        action: {
          label: 'Go to the key box',
          run: () => {
            $('key').scrollIntoView({ block: 'center' });
            $('key').focus();
          },
        },
      },
      {
        title: 'Test the key',
        desc: 'Make sure Google accepts it.',
        done: s.app.keyTested,
        action: { label: 'Test key', disabled: !s.hasKey, run: () => $('testkey').click() },
      },
      {
        title: 'Check your microphone',
        desc: 'Speak for five seconds and your words should appear.',
        done: s.app.micChecked,
        action: {
          label: 'Start the check',
          run: () => {
            $('rec').scrollIntoView({ block: 'center' });
            $('rec').click();
          },
        },
      },
      {
        title: 'Dictate once',
        desc:
          s.app.mode === 'toggle' || s.app.hotkey === 'F23'
            ? `In a text box, tap ${key}, say “Hello Flow”, then tap again.`
            : `In a text box, hold ${key}, say “Hello Flow”, then let go.`,
        done: dictations > 0,
      },
      {
        title: 'Try Ask and Command Mode',
        desc: 'Ask a question, set a reminder or rewrite selected text.',
        done: s.app.tipsSeen,
        action: {
          label: showTips ? 'Got it' : 'Show tips',
          run: () => {
            if (showTips) {
              showTips = false;
              void api
                .set({ tipsSeen: true })
                .then(apply)
                .catch(failure('Could not save your setup progress.'));
            } else {
              showTips = true;
              renderGuide();
            }
          },
        },
      },
    ];
    const finished = steps.filter((x) => x.done).length;
    $('guidesub').textContent =
      finished === steps.length
        ? "You're all set."
        : `${finished} of ${steps.length} setup steps complete`;
    $('guidehide').textContent = finished === steps.length ? 'Done' : 'Hide guide';
    const focusedStep = Array.from(guideSteps.children).findIndex((li) =>
      li.contains(document.activeElement),
    );
    guideSteps.replaceChildren(
      ...steps.map((st, i) => {
        const li = document.createElement('li');
        li.classList.toggle('done', st.done);
        const tick = document.createElement('span');
        tick.className = 'tick';
        tick.textContent = st.done ? '\u2713' : String(i + 1);
        tick.setAttribute('aria-label', st.done ? 'Complete' : 'Incomplete');
        tick.setAttribute('role', 'img');
        const body = document.createElement('div');
        body.className = 'body';
        const t = document.createElement('div');
        t.className = 't';
        t.textContent = st.title;
        const d = document.createElement('div');
        d.className = 'd';
        d.textContent = st.desc;
        body.append(t, d);
        if (i === steps.length - 1 && showTips) {
          const tips = document.createElement('ul');
          tips.className = 'tips';
          for (const text of [
            s.app.askHotkey
              ? `Hold ${s.app.askHotkey} to ask a question or say “Remind me to call Sam at four”.`
              : 'Record an Ask shortcut below to ask questions or set reminders.',
            'When the bell appears, hover over the floating icon, then choose Snooze or Done.',
            s.app.commandHotkey
              ? `Select text, hold ${s.app.commandHotkey}, then say “Make this shorter”.`
              : 'Record a Command Mode shortcut below to rewrite selected text with your voice.',
          ]) {
            const item = document.createElement('li');
            item.textContent = text;
            tips.append(item);
          }
          body.append(tips);
        }
        li.append(tick, body);
        if (st.action && !st.done) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn';
          b.textContent = st.action.label;
          b.disabled = !!st.action.disabled;
          b.addEventListener('click', st.action.run);
          li.append(b);
        }
        return li;
      }),
    );
    if (focusedStep >= 0) {
      const actions = Array.from(guideSteps.children).slice(focusedStep);
      const next = actions
        .map((li) => li.querySelector<HTMLButtonElement>('button:not(:disabled)'))
        .find(Boolean);
      (next ?? $('guidehide')).focus({ preventScroll: true });
    }
  }
  const refreshGuide = () =>
    void api
      .usage()
      .then((u) => {
        dictations = u.totals.dictations;
        renderGuide();
      })
      .catch(() => {
        /* Setup can still be used if the usage summary is unavailable. */
      });
  on(
    'guidehide',
    'click',
    () =>
      void api
        .set({ guideDismissed: true })
        .then((state) => {
          const returnFocus = guide.contains(document.activeElement);
          apply(state);
          if (returnFocus) {
            const heading = $('page-dictation').querySelector('h1')!;
            heading.tabIndex = -1;
            heading.focus();
          }
        })
        .catch(failure('Could not hide the setup guide.')),
  );
  on(
    'guideshow',
    'click',
    () =>
      void api
        .set({ guideDismissed: false })
        .then((state) => {
          apply(state);
          $('guidehide').focus();
        })
        .catch(failure('Could not open the setup guide.')),
  );
  pageHooks['dictation'] = () => {
    requestAnimationFrame(draw);
    refreshGuide();
  };
  refreshGuide();

  /** Asks before something destructive. Cancel has focus, Esc cancels, Tab stays inside the dialog. */
  function confirmDialog(
    title: string,
    message: string,
    okLabel: string,
    danger = true,
  ): Promise<boolean> {
    const dlg = $('dialog');
    const ok = $<HTMLButtonElement>('dlgok');
    const cancel = $<HTMLButtonElement>('dlgcancel');
    $('dlgtitle').textContent = title;
    $('dlgbody').textContent = message;
    ok.textContent = okLabel;
    ok.className = `btn ${danger ? 'danger' : 'primary'}`;
    const before = document.activeElement as HTMLElement | null;
    const shell = document.querySelector<HTMLElement>('.shell')!;
    shell.inert = true;
    dlg.hidden = false;
    cancel.focus();
    return new Promise((resolve) => {
      const close = async (answer: boolean) => {
        dlg.classList.add('closing');
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        dlg.removeEventListener('mousedown', onBackdrop);
        window.removeEventListener('keydown', onKey, true);
        await afterMotion(dlg);
        dlg.hidden = true;
        dlg.classList.remove('closing');
        shell.inert = false;
        before?.focus({ preventScroll: true });
        resolve(answer);
      };
      const onOk = () => close(true);
      const onCancel = () => close(false);
      const onBackdrop = (e: MouseEvent) => {
        if (e.target === dlg) close(false);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close(false);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          (document.activeElement === cancel ? ok : cancel).focus();
        }
      };
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
      dlg.addEventListener('mousedown', onBackdrop);
      window.addEventListener('keydown', onKey, true);
    });
  }

  // ---------- notes and reminders ----------
  const whenText = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  function memoryRow(
    id: string,
    text: string,
    note: string,
    onRemove: () => Promise<void>,
  ): HTMLLIElement {
    const li = document.createElement('li');
    li.dataset.key = id;
    const d = document.createElement('div');
    const n = document.createElement('span');
    n.className = 'name';
    n.textContent = text;
    const small = document.createElement('small');
    small.textContent = note;
    n.append(small);
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn quiet';
    rm.textContent = 'Delete';
    rm.setAttribute('aria-label', `Delete ${text}`);
    rm.addEventListener('click', () => void removeRow(li, onRemove));
    d.append(n, rm);
    li.append(d);
    return li;
  }
  function showMemory(m: MemoryDto): void {
    const now = Date.now();
    const rems = [...m.reminders].sort(
      (a, b) => Date.parse(a.snoozedUntil ?? a.due) - Date.parse(b.snoozedUntil ?? b.due),
    );
    replaceRows(
      $('remlist'),
      ...(rems.length
        ? rems.map((r) => {
            const at = r.snoozedUntil ?? r.due;
            const repeat =
              r.repeat === 'none' ? '' : r.repeat === 'daily' ? ' · every day' : ' · every week';
            const state = Date.parse(at) <= now ? 'Due now' : whenText(at);
            return memoryRow(r.id, r.text, `${state}${repeat}`, () =>
              api.removeReminder(r.id).then(showMemory),
            );
          })
        : [emptyRow('No reminders. Ask Flow to remind you of something.')]),
    );
    replaceRows(
      $('notelist'),
      ...(m.notes.length
        ? m.notes.map((n) =>
            memoryRow(n.id, n.text, whenText(n.at), () => api.removeNote(n.id).then(showMemory)),
          )
        : [emptyRow('No notes. Ask Flow to remember something.')]),
    );
  }
  const renderMemory = () => {
    const status = $('memory-status');
    if (!$('remlist').childElementCount) say(status, 'Loading notes and reminders…');
    void api
      .getMemory()
      .then((memory) => {
        showMemory(memory);
        say(status, '');
      })
      .catch(() =>
        say(status, 'Could not load notes and reminders. Try opening this page again.', true),
      );
  };
  pageHooks['memory'] = renderMemory;
  on('askusesnotes', 'click', () =>
    save({ askUsesNotes: $('askusesnotes').getAttribute('aria-checked') !== 'true' }),
  );

  // ---------- history ----------
  const histq = $<HTMLInputElement>('histq');
  const histlist = $('histlist');
  const when = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const animateHistoryResults = () => {
    const animation = histlist.getAnimations()[0];
    if (animation) {
      animation.currentTime = 0;
      animation.play();
    }
  };
  let historyRequest = 0;
  function renderHistory(): void {
    const query = histq.value;
    const request = ++historyRequest;
    const status = $('history-status');
    if (!histlist.childElementCount) say(status, 'Loading history…');
    histlist.setAttribute('aria-busy', 'true');
    void api
      .listHistory(query)
      .then((items) => {
        if (request !== historyRequest) return;
        histlist.setAttribute('aria-busy', 'false');
        say(status, query && items.length ? `${items.length} results` : '');
        histlist.classList.toggle('history-results', document.activeElement === histq);
        if (!items.length) {
          replaceRows(
            histlist,
            emptyRow(query ? 'No matching dictations.' : 'Your dictations will appear here.'),
          );
          animateHistoryResults();
          return;
        }
        replaceRows(
          histlist,
          ...items.map((e) => {
            const li = document.createElement('li');
            li.dataset.key = e.id;
            const d = document.createElement('div');
            const n = document.createElement('span');
            n.className = 'name';
            n.textContent = e.text;
            const small = document.createElement('small');
            small.textContent = e.app ? `${when(e.at)} · ${e.app}` : when(e.at);
            n.append(small);
            const copy = document.createElement('button');
            copy.type = 'button';
            copy.className = 'btn quiet';
            copy.textContent = 'Copy';
            copy.addEventListener(
              'click',
              () =>
                void api
                  .copyHistory(e.id)
                  .then((copied) => {
                    if (copied) toast('Dictation copied');
                    else toast('This dictation is no longer available.', 'err');
                  })
                  .catch(failure('Could not copy the dictation.')),
            );
            const rm = document.createElement('button');
            rm.type = 'button';
            rm.className = 'btn quiet';
            rm.textContent = 'Delete';
            rm.addEventListener(
              'click',
              () => void removeRow(li, () => api.removeHistory(e.id).then(renderHistory)),
            );
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'btn quiet';
            edit.textContent = 'Fix';
            edit.addEventListener('click', () => beginFix(li, e));
            d.append(n, copy, edit, rm);
            li.append(d);
            return li;
          }),
        );
        animateHistoryResults();
      })
      .catch(() => {
        if (request !== historyRequest) return;
        histlist.setAttribute('aria-busy', 'false');
        say(status, 'Could not load history. Try again.', true);
      });
  }
  /** Edit an entry in place; the words the fix adds are offered for the dictionary. */
  function beginFix(li: HTMLLIElement, e: HistoryEntryDto): void {
    const box = document.createElement('div');
    box.style.cssText = 'display:block;width:100%';
    const ta = document.createElement('textarea');
    ta.rows = 3;
    ta.value = e.text;
    ta.setAttribute('aria-label', 'Corrected text');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;margin-top:8px';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn primary';
    ok.textContent = 'Save fix';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn quiet';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      ta.focus({ preventScroll: true });
      renderHistory();
    });
    ok.addEventListener(
      'click',
      () =>
        void api
          .correctHistory(e.id, ta.value)
          .then((terms) => {
            renderHistory();
            toast('Correction saved');
            offerTerms(terms);
          })
          .catch(failure('Could not save the correction.')),
    );
    row.append(ok, cancel);
    box.append(ta, row);
    li.replaceChildren(box);
    ta.focus();
  }

  const histlearn = $('histlearn');
  function offerTerms(terms: string[]): void {
    histlearn.replaceChildren();
    if (!terms.length) return;
    histlearn.append(document.createTextNode('Add to your dictionary: '));
    for (const term of terms) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.style.marginRight = '6px';
      b.textContent = term;
      b.addEventListener('click', () => {
        savePersonal({ dictionary: [...personal.dictionary, { term }] }, '', `Added ${term}`);
        b.remove();
        if (histlearn.querySelectorAll('button').length === 0) histlearn.replaceChildren();
      });
      histlearn.append(b);
    }
  }
  pageHooks['history'] = renderHistory;
  histq.addEventListener('input', renderHistory);
  on('keephistory', 'click', () =>
    save({ keepHistory: $('keephistory').getAttribute('aria-checked') !== 'true' }),
  );
  on(
    'histclear',
    'click',
    () =>
      void confirmDialog(
        'Clear all history?',
        'This deletes every saved dictation from this PC. It cannot be undone.',
        'Delete all',
      ).then((yes) => {
        if (!yes) return;
        void api
          .clearHistory()
          .then(() => {
            renderHistory();
            toast('History cleared');
          })
          .catch(failure('Could not clear history.'));
      }),
  );

  // ---------- updates ----------
  const paintUpdate = (u: UpdateStatusDto): void => {
    $('upd-version').textContent = u.version;
    const check = $<HTMLButtonElement>('upd-check');
    const install = $<HTMLButtonElement>('upd-install');
    install.style.display = u.state === 'ready' ? '' : 'none';
    check.style.display = u.state === 'ready' ? 'none' : '';
    busy(check, u.state === 'checking' || u.state === 'downloading');
    check.disabled = check.disabled || u.state === 'unavailable';
    const detail: Record<UpdateStatusDto['state'], string> = {
      idle: 'Installed version. Updates are checked at startup and once a day.',
      checking: 'Checking GitHub for a newer version…',
      downloading: `Downloading version ${u.latest ?? ''}${u.percent === undefined ? '' : ` (${u.percent}%)`}…`,
      ready: `Version ${u.latest ?? ''} is ready. It installs when you quit Flow, or restart now.`,
      uptodate: 'You have the latest version.',
      error: 'Installed version.',
      unavailable: 'Installed version.',
    };
    $('upd-detail').textContent = detail[u.state];
    say(
      $('upd-msg'),
      u.state === 'error' || u.state === 'unavailable' ? (u.message ?? '') : '',
      u.state === 'error',
    );
  };
  on(
    'upd-check',
    'click',
    () => void api.checkUpdate().catch(failure('Could not check for updates.')),
  );
  on('upd-install', 'click', () => void api.installUpdate());
  api.onUpdate(paintUpdate);
  api.onPage((page) => go(page));
  pageHooks['updates'] = () =>
    void api
      .getUpdate()
      .then(paintUpdate)
      .catch(() => say($('upd-msg'), 'Could not load update status.', true));
  void api
    .getUpdate()
    .then(paintUpdate)
    .catch(() => say($('upd-msg'), 'Could not load update status.', true));

  // ---------- boot ----------
  void api
    .get()
    .then(apply)
    .catch(() => {
      $('railtext').textContent = 'Settings unavailable';
      toast('Could not load settings. Close and reopen this window.', 'err');
    });
  void api.getPersonal().then(showPersonal).catch(failure('Could not load words and style.'));
})();

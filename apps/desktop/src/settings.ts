(() => {
  const api = flowApi.settings;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const on = (id: string, ev: string, fn: (e: Event) => void) => $(id).addEventListener(ev, fn);
  const say = (el: HTMLElement, text: string, err = false) => {
    el.textContent = text;
    el.classList.toggle('err', err);
  };

  // ---------- toasts ----------
  const CHECK = '<svg viewBox="0 0 20 20"><path d="M4 10.5l4 4 8-9"/></svg>';
  const WARN = '<svg viewBox="0 0 20 20"><path d="M10 4v7M10 15.5v.5"/></svg>';
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
        setTimeout(() => t.remove(), 200);
      },
      kind === 'err' ? 4200 : 2200,
    );
  }

  const busy = (btn: HTMLElement, v: boolean) => {
    btn.classList.toggle('busy', v);
    (btn as HTMLButtonElement).disabled = v;
  };

  // ---------- navigation ----------
  const nav = $('nav');
  const navButtons = Array.from(nav.querySelectorAll<HTMLButtonElement>('button'));
  const indicator = nav.querySelector<HTMLElement>('.nav-ind')!;
  const moveIndicator = (b: HTMLElement) => {
    indicator.style.setProperty('--y', `${b.offsetTop}px`);
    indicator.style.height = `${b.offsetHeight}px`;
  };
  const pageHooks: Record<string, () => void> = {};
  const segs: Array<() => void> = [];
  const refreshSegs = () => segs.forEach((f) => f());

  function go(page: string): void {
    for (const b of navButtons) {
      if (b.dataset.page === page) {
        b.setAttribute('aria-current', 'page');
        moveIndicator(b);
      } else b.removeAttribute('aria-current');
    }
    for (const p of Array.from(document.querySelectorAll<HTMLElement>('.page'))) {
      const show = p.id === `page-${page}`;
      p.hidden = !show;
      p.classList.remove('enter');
      if (show) {
        void p.offsetWidth; // restart the entrance
        p.classList.add('enter');
      }
    }
    $('page-' + page).parentElement!.scrollTop = 0;
    refreshSegs();
    pageHooks[page]?.();
  }
  navButtons.forEach((b) => b.addEventListener('click', () => go(b.dataset.page!)));
  indicator.style.transition = 'none'; // the first placement should not animate
  moveIndicator(navButtons[0]!);
  requestAnimationFrame(() => (indicator.style.transition = ''));

  // ---------- segmented controls ----------
  function seg(id: string, pick: (v: string) => void): (v: string) => void {
    const el = $(id);
    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('button'));
    const thumb = el.querySelector<HTMLElement>('.thumb')!;
    let value = '';
    const paint = () => {
      const a = buttons.find((b) => b.dataset.v === value);
      buttons.forEach((b) => b.setAttribute('aria-checked', String(b === a)));
      if (a && a.offsetWidth) {
        thumb.style.setProperty('--x', `${a.offsetLeft}px`);
        thumb.style.setProperty('--w', `${a.offsetWidth}px`);
      }
    };
    segs.push(paint);
    buttons.forEach((b) =>
      b.addEventListener('click', () => {
        value = b.dataset.v!;
        paint();
        pick(value);
      }),
    );
    return (v) => {
      value = v;
      paint();
    };
  }
  window.addEventListener('resize', refreshSegs);

  // ---------- settings ----------
  const hotkey = $<HTMLSelectElement>('hotkey');
  const mic = $<HTMLSelectElement>('mic');
  const autostart = $('autostart');
  const save = (patch: Partial<SettingsDto['app']>, message = 'Saved') =>
    void api.set(patch).then((s) => {
      apply(s);
      toast(message);
    });

  const setMode = seg('mode', (v) => save({ mode: v as 'hold' | 'toggle' }));
  const setOverlay = seg('overlay', (v) => save({ overlay: v as 'always' | 'active' }));

  function apply(s: SettingsDto): void {
    hotkey.replaceChildren(
      ...s.hotkeys.map((h) => new Option(h.label, h.id, false, h.id === s.app.hotkey)),
    );
    setMode(s.app.mode);
    setOverlay(s.app.overlay);
    autostart.setAttribute('aria-checked', String(s.app.autostart));
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

    const label = s.hotkeys.find((h) => h.id === s.app.hotkey)?.label ?? 'your hotkey';
    $('raildot').className = `dot ${s.hasKey ? 'ok' : 'warn'}`;
    $('railtext').textContent = s.hasKey
      ? `${s.app.mode === 'hold' ? 'Hold' : 'Press'} ${label} to dictate`
      : 'Add your API key to start';
  }

  hotkey.addEventListener('change', () => save({ hotkey: hotkey.value }, 'Hotkey saved'));
  mic.addEventListener('change', () => save({ micDeviceId: mic.value }, 'Microphone saved'));
  autostart.addEventListener('click', () =>
    save({ autostart: autostart.getAttribute('aria-checked') !== 'true' }),
  );
  on('resetpos', 'click', () => save({ overlayPos: null }, 'Icon moved back'));
  on('refreshmics', 'click', () => {
    const btn = $('refreshmics');
    busy(btn, true);
    void api.listMics().then((list) => {
      busy(btn, false);
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
    });
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
    void api.testKey().then((r) => {
      busy(btn, false);
      $('keychip').className = `chip ${r.ok ? 'ok' : 'bad'}`;
      $('keychiptext').textContent = r.ok ? 'Key works' : 'Key rejected';
      say($('keymsg'), r.ok ? '' : r.message, !r.ok);
    });
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
    const slide = Math.min(1, (performance.now() - lastPush) / 100); // glide between 100 ms samples
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
  pageHooks['dictation'] = () => requestAnimationFrame(draw);
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
  let fresh = ''; // key of the row the user just added, so only that row animates in

  function listRow(
    key: string,
    name: string,
    note: string | undefined,
    onRemove: () => void,
    extra?: HTMLElement,
  ): HTMLLIElement {
    const li = document.createElement('li');
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
    rm.addEventListener('click', () => {
      li.classList.add('out'); // collapse first, then drop it from the saved list
      setTimeout(onRemove, 170);
    });
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
  const savePersonal = (patch: Partial<PersonalDto>, key = '', message = '') => {
    fresh = key;
    void api.setPersonal(patch).then((p) => {
      showPersonal(p);
      fresh = '';
      if (message) toast(message);
    });
  };

  function showPersonal(p: PersonalDto): void {
    personal = p;
    setCleanupLevel(p.cleanupLevel);
    $('cleanupHelp').textContent = cleanupHelp[p.cleanupLevel];
    toneSelect($<HTMLSelectElement>('deftone'), p.defaultTone);
    toneSelect($<HTMLSelectElement>('apptone'), 'professional');
    $('recent').replaceChildren(...p.recentApps.map((a) => new Option(a, a)));
    $<HTMLTextAreaElement>('style').value = p.style;

    const apps = Object.entries(p.appTones);
    $('apptones').replaceChildren(
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
                savePersonal({ appTones: next });
              },
              sel,
            );
          })
        : [emptyRow('No app has its own tone yet.')]),
    );
    $('dict').replaceChildren(
      ...(p.dictionary.length
        ? p.dictionary.map((d, i) =>
            listRow(`term:${d.term}`, d.term, d.hint, () =>
              savePersonal({ dictionary: p.dictionary.filter((_, j) => j !== i) }),
            ),
          )
        : [emptyRow('No terms yet.')]),
    );
    $('snips').replaceChildren(
      ...(p.snippets.length
        ? p.snippets.map((s, i) =>
            listRow(`snip:${s.trigger}`, `“${s.trigger}”`, `types ${s.expansion}`, () =>
              savePersonal({ snippets: p.snippets.filter((_, j) => j !== i) }),
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
    savePersonal({ snippets: [...personal.snippets, { trigger, expansion }] }, `snip:“${trigger}”`);
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
    void api.learnStyle(samples).then((r) => {
      busy(btn, false);
      if (!r.ok) return say($('stylemsg'), r.error ?? 'Could not draft a style.', true);
      $<HTMLTextAreaElement>('style').value = r.style ?? '';
      $<HTMLTextAreaElement>('samples').value = ''; // never kept
      say($('stylemsg'), 'Drafted in the box above. Edit it if you like, then save.');
      $('style').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  // ---------- usage ----------
  const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
  function renderUsage(): void {
    void api.usage().then((u) => {
      const [y, m] = u.month.split('-').map(Number);
      $('usagesub').textContent = new Date(y!, m! - 1, 1).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      });
      $('u-dict').textContent = String(u.totals.dictations);
      $('u-min').textContent = (u.totals.audioSeconds / 60).toFixed(1);
      $('u-cost').textContent = usd(u.cost.total);
      $('u-detail').textContent =
        `Speech ${usd(u.cost.stt)}, cleanup ${usd(u.cost.cleanup)} (${u.totals.inputTokens} tokens in, ${u.totals.outputTokens} out). ` +
        'Cleanup uses Google’s list price of $0.30 / $2.50 per million tokens.';
    });
  }
  pageHooks['usage'] = renderUsage;
  on('saverate', 'click', () => {
    const rate = Number($<HTMLInputElement>('rate').value);
    if (!Number.isFinite(rate) || rate < 0) return toast('Enter a price of zero or more', 'err');
    void api.set({ sttUsdPerHour: rate }).then((s) => {
      apply(s);
      renderUsage();
      toast('Price saved');
    });
  });

  // ---------- permissions ----------
  const STATUS = { ok: 'Allowed', missing: 'Not allowed', manual: 'Cannot be checked' } as const;
  function renderPermissions(): void {
    void api.permissions().then((rows) => {
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
    });
  }
  pageHooks['access'] = renderPermissions;
  on('recheck', 'click', () => {
    renderPermissions();
    toast('Checked');
  });

  // ---------- backup ----------
  on('export', 'click', () => void api.exportPersonal().then((r) => r.ok && toast('Exported')));
  on(
    'import',
    'click',
    () =>
      void api.importPersonal().then((r) => {
        if (r.ok && r.personal) {
          showPersonal(r.personal);
          toast('Imported');
        } else if (r.error) toast(r.error, 'err');
      }),
  );

  // ---------- boot ----------
  void api.get().then(apply);
  void api.getPersonal().then(showPersonal);
})();

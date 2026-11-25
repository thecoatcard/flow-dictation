/**
 * Notes and reminders, kept on the device only. Everything here is pure: the caller supplies the clock and
 * the ids, and stores the result. Times are stored as ISO strings (UTC) and shown in the device's local time.
 */
export interface Note {
  id: string;
  text: string;
  /** When it was saved. */
  at: string;
}

export type Repeat = 'none' | 'daily' | 'weekly';

export interface Reminder {
  id: string;
  text: string;
  /** When it is due next (ISO, UTC). For a repeating reminder this is the next occurrence. */
  due: string;
  repeat: Repeat;
  createdAt: string;
  /** Set when snoozed: the reminder fires again at this time, and `due` keeps the repeat schedule. */
  snoozedUntil?: string;
}

export interface MemoryData {
  notes: Note[];
  reminders: Reminder[];
}

export const MAX_NOTES = 200;
export const MAX_REMINDERS = 100;
export const MAX_NOTE_CHARS = 500;
/** How many notes Ask is shown, newest first: enough to answer from, small enough to stay quick and cheap. */
export const NOTES_IN_ASK = 60;

export const emptyMemory = (): MemoryData => ({ notes: [], reminders: [] });

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const validDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const clean = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_CHARS);

/** Turns anything read from disk into valid memory. Bad entries are dropped, never trusted. */
export function migrateMemory(raw: unknown): MemoryData {
  const out = emptyMemory();
  if (!isObj(raw)) return out;
  if (Array.isArray(raw.notes))
    for (const n of raw.notes)
      if (isObj(n) && typeof n.id === 'string' && n.id && typeof n.text === 'string' && clean(n.text))
        out.notes.push({ id: n.id, text: clean(n.text), at: validDate(n.at) ? n.at : new Date(0).toISOString() });
  if (Array.isArray(raw.reminders))
    for (const r of raw.reminders)
      if (
        isObj(r) &&
        typeof r.id === 'string' &&
        r.id &&
        typeof r.text === 'string' &&
        clean(r.text) &&
        validDate(r.due)
      )
        out.reminders.push({
          id: r.id,
          text: clean(r.text),
          due: r.due,
          repeat: r.repeat === 'daily' || r.repeat === 'weekly' ? r.repeat : 'none',
          createdAt: validDate(r.createdAt) ? r.createdAt : r.due,
          ...(validDate(r.snoozedUntil) ? { snoozedUntil: r.snoozedUntil } : {}),
        });
  out.notes = out.notes.slice(0, MAX_NOTES);
  out.reminders = out.reminders.slice(0, MAX_REMINDERS);
  return out;
}

export function addNote(m: MemoryData, text: string, now: Date, id: string): MemoryData {
  const t = clean(text);
  if (!t) return m;
  const notes = [{ id, text: t, at: now.toISOString() }, ...m.notes].slice(0, MAX_NOTES);
  return { ...m, notes };
}

export function addReminder(
  m: MemoryData,
  text: string,
  due: Date,
  repeat: Repeat,
  now: Date,
  id: string,
): MemoryData {
  const t = clean(text);
  if (!t || Number.isNaN(due.getTime())) return m;
  const reminders = [...m.reminders, { id, text: t, due: due.toISOString(), repeat, createdAt: now.toISOString() }]
    .sort((a, b) => Date.parse(effectiveDue(a)) - Date.parse(effectiveDue(b)))
    .slice(0, MAX_REMINDERS);
  return { ...m, reminders };
}

/** When the reminder will next fire: the snooze time if it was snoozed, otherwise its due time. */
export const effectiveDue = (r: Reminder): string => r.snoozedUntil ?? r.due;

/** Reminders that are due now, oldest first. These form the queue the user clears one by one. */
export function dueReminders(m: MemoryData, now: Date): Reminder[] {
  return m.reminders
    .filter((r) => Date.parse(effectiveDue(r)) <= now.getTime())
    .sort((a, b) => Date.parse(effectiveDue(a)) - Date.parse(effectiveDue(b)));
}

/** Reminders still to come, soonest first. */
export function upcomingReminders(m: MemoryData, now: Date): Reminder[] {
  return m.reminders
    .filter((r) => Date.parse(effectiveDue(r)) > now.getTime())
    .sort((a, b) => Date.parse(effectiveDue(a)) - Date.parse(effectiveDue(b)));
}

/** The time the next not-yet-due reminder fires, or null. Used to set an alarm. */
export function nextDueAt(m: MemoryData, now: Date): number | null {
  const next = upcomingReminders(m, now)[0];
  return next ? Date.parse(effectiveDue(next)) : null;
}

/** Next occurrence of a repeating reminder strictly after `now`. */
function advance(due: Date, repeat: Repeat, now: Date): Date {
  const step = repeat === 'daily' ? 1 : 7;
  const d = new Date(due);
  while (d.getTime() <= now.getTime()) d.setDate(d.getDate() + step);
  return d;
}

/** The user cleared it. A one-off disappears; a repeating one moves to its next occurrence. */
export function clearReminder(m: MemoryData, id: string, now: Date): MemoryData {
  return {
    ...m,
    reminders: m.reminders.flatMap((r) => {
      if (r.id !== id) return [r];
      if (r.repeat === 'none') return [];
      const { snoozedUntil: _gone, ...rest } = r;
      return [{ ...rest, due: advance(new Date(r.due), r.repeat, now).toISOString() }];
    }),
  };
}

/** Ask again later. The repeat schedule is kept. */
export function snoozeReminder(m: MemoryData, id: string, now: Date, minutes: number): MemoryData {
  const until = new Date(now.getTime() + minutes * 60_000).toISOString();
  return { ...m, reminders: m.reminders.map((r) => (r.id === id ? { ...r, snoozedUntil: until } : r)) };
}

export const removeReminder = (m: MemoryData, id: string): MemoryData => ({
  ...m,
  reminders: m.reminders.filter((r) => r.id !== id),
});
export const removeNote = (m: MemoryData, id: string): MemoryData => ({
  ...m,
  notes: m.notes.filter((n) => n.id !== id),
});

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);

/** Items whose text contains every word of `match` (an item can match by any order). `*` matches everything. */
function matching<T extends { text: string }>(items: T[], match: string): T[] {
  if (match.trim() === '*') return items;
  const wanted = words(match);
  if (!wanted.length) return [];
  return items.filter((i) => {
    const have = new Set(words(i.text));
    return wanted.every((w) => have.has(w) || i.text.toLowerCase().includes(w));
  });
}

export interface Resolved<T> {
  /** Removed: exactly one match, or all of them for `*`. */
  removed: T[];
  /** More than one match and the user did not say all: nothing was removed, these are the candidates. */
  ambiguous: T[];
}

function resolve<T extends { text: string; id: string }>(items: T[], match: string): Resolved<T> {
  const found = matching(items, match);
  if (match.trim() === '*' || found.length === 1) return { removed: found, ambiguous: [] };
  return { removed: [], ambiguous: found };
}

/** Which reminders a "cancel ..." refers to. Several matches are never removed on a guess. */
export const resolveReminders = (m: MemoryData, match: string): Resolved<Reminder> =>
  resolve(m.reminders, match);
export const resolveNotes = (m: MemoryData, match: string): Resolved<Note> => resolve(m.notes, match);

export function withoutIds(m: MemoryData, reminderIds: string[], noteIds: string[]): MemoryData {
  return {
    notes: m.notes.filter((n) => !noteIds.includes(n.id)),
    reminders: m.reminders.filter((r) => !reminderIds.includes(r.id)),
  };
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const two = (n: number) => String(n).padStart(2, '0');

function clock(d: Date): string {
  const h = d.getHours();
  return `${h % 12 || 12}:${two(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}`;
}
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Today 5:00 pm", "Tomorrow 9:00 am", "Thu 27 Nov, 5:00 pm" (with the year when it is not this year). */
export function formatWhen(due: Date, now: Date): string {
  if (sameDay(due, now)) return `Today ${clock(due)}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(due, tomorrow)) return `Tomorrow ${clock(due)}`;
  const year = due.getFullYear() === now.getFullYear() ? '' : ` ${due.getFullYear()}`;
  return `${DAYS[due.getDay()]!.slice(0, 3)} ${due.getDate()} ${MONTHS[due.getMonth()]!.slice(0, 3)}${year}, ${clock(due)}`;
}

/** "Thursday 26 November 2026, 23:50 (UTC+05:30)": the clock the model computes times from. */
export function describeNow(now: Date, offsetMinutes = -now.getTimezoneOffset()): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return (
    `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}, ` +
    `${two(now.getHours())}:${two(now.getMinutes())} (UTC${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)})`
  );
}

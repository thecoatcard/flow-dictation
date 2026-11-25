import { describe, expect, it } from 'vitest';
import {
  addNote,
  addReminder,
  clearReminder,
  describeNow,
  dueReminders,
  emptyMemory,
  formatWhen,
  migrateMemory,
  nextDueAt,
  resolveNotes,
  resolveReminders,
  snoozeReminder,
  upcomingReminders,
  withoutIds,
} from './memory';

const now = new Date(2026, 10, 26, 23, 50); // Thursday 26 November 2026, 23:50
const at = (d: number, h: number, mi = 0) => new Date(2026, 10, d, h, mi);

describe('reminders', () => {
  const base = () =>
    addReminder(
      addReminder(emptyMemory(), 'call Dhriti', at(27, 17), 'none', now, 'a'),
      'take the tablet',
      at(27, 9),
      'none',
      now,
      'b',
    );

  it('keeps reminders ordered by time and splits due from upcoming', () => {
    const m = base();
    expect(m.reminders.map((r) => r.id)).toEqual(['b', 'a']);
    expect(dueReminders(m, now)).toEqual([]);
    expect(upcomingReminders(m, now).map((r) => r.id)).toEqual(['b', 'a']);
    expect(nextDueAt(m, now)).toBe(at(27, 9).getTime());
    expect(dueReminders(m, at(27, 10)).map((r) => r.id)).toEqual(['b']);
    expect(dueReminders(m, at(27, 18)).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('clears a one-off reminder and moves a repeating one to its next time', () => {
    const m = addReminder(base(), 'stand up', at(26, 9), 'daily', at(25, 8), 'c');
    const cleared = clearReminder(m, 'c', now);
    const next = cleared.reminders.find((r) => r.id === 'c')!;
    expect(new Date(next.due).getTime()).toBe(at(27, 9).getTime());
    expect(clearReminder(base(), 'a', now).reminders.map((r) => r.id)).toEqual(['b']);
  });

  it('skips missed occurrences of a repeating reminder', () => {
    const m = addReminder(emptyMemory(), 'weekly review', at(5, 10), 'weekly', at(1, 8), 'w');
    const next = clearReminder(m, 'w', now).reminders[0]!;
    // 5, 12, 19 and 26 November at 10:00 have all passed by 23:50 on the 26th: the next one is 3 December.
    expect(new Date(next.due).getTime()).toBe(new Date(2026, 11, 3, 10).getTime());
  });

  it('snoozing moves when it fires but keeps the repeat schedule', () => {
    const m = addReminder(emptyMemory(), 'stand up', at(26, 9), 'daily', at(25, 8), 'c');
    expect(dueReminders(m, now).map((r) => r.id)).toEqual(['c']);
    const snoozed = snoozeReminder(m, 'c', now, 10);
    expect(dueReminders(snoozed, now)).toEqual([]);
    expect(dueReminders(snoozed, new Date(now.getTime() + 11 * 60_000)).map((r) => r.id)).toEqual(['c']);
    const cleared = clearReminder(snoozed, 'c', new Date(now.getTime() + 11 * 60_000));
    expect(cleared.reminders[0]!.snoozedUntil).toBeUndefined();
    expect(new Date(cleared.reminders[0]!.due).getTime()).toBe(at(27, 9).getTime());
  });

  it('ignores blank text and invalid times', () => {
    expect(addReminder(emptyMemory(), '  ', at(27, 9), 'none', now, 'x').reminders).toEqual([]);
    expect(addReminder(emptyMemory(), 'x', new Date('nope'), 'none', now, 'x').reminders).toEqual([]);
  });
});

describe('notes and matching', () => {
  const m = addNote(addNote(emptyMemory(), 'my locker code is 4821', now, 'n1'), 'wifi password is blue sky', now, 'n2');

  it('stores the newest note first and cleans spacing', () => {
    expect(m.notes.map((n) => n.id)).toEqual(['n2', 'n1']);
    expect(addNote(emptyMemory(), '  a   b \n c ', now, 'x').notes[0]!.text).toBe('a b c');
    expect(addNote(emptyMemory(), '   ', now, 'x').notes).toEqual([]);
  });

  it('finds one note by key words and removes only a single clear match', () => {
    expect(resolveNotes(m, 'locker code').removed.map((n) => n.id)).toEqual(['n1']);
    expect(resolveNotes(m, 'password').removed.map((n) => n.id)).toEqual(['n2']);
    expect(resolveNotes(m, 'is').ambiguous).toHaveLength(2); // two matches: nothing is removed on a guess
    expect(resolveNotes(m, 'is').removed).toEqual([]);
    expect(resolveNotes(m, 'zebra')).toEqual({ removed: [], ambiguous: [] });
    expect(resolveNotes(m, '*').removed).toHaveLength(2);
  });

  it('applies the same rule to reminders and removes by id', () => {
    const r = addReminder(emptyMemory(), 'call Dhriti', at(27, 17), 'none', now, 'a');
    expect(resolveReminders(r, 'dhriti').removed.map((x) => x.id)).toEqual(['a']);
    expect(withoutIds(r, ['a'], []).reminders).toEqual([]);
    expect(withoutIds(m, [], ['n1']).notes.map((n) => n.id)).toEqual(['n2']);
  });
});

describe('reading from disk', () => {
  it('drops damaged entries and keeps good ones', () => {
    const m = migrateMemory({
      notes: [{ id: 'n', text: ' ok ', at: '2026-11-20T08:00:00.000Z' }, { id: '', text: 'no id' }, 'junk', { id: 'z', text: '  ' }],
      reminders: [
        { id: 'r', text: 'x', due: '2026-11-27T10:00:00.000Z', repeat: 'daily' },
        { id: 'bad', text: 'y', due: 'not a date' },
      ],
    });
    expect(m.notes.map((n) => n.text)).toEqual(['ok']);
    expect(m.reminders.map((r) => r.id)).toEqual(['r']);
    expect(m.reminders[0]!.repeat).toBe('daily');
    expect(migrateMemory(42)).toEqual(emptyMemory());
  });
});

describe('time text', () => {
  it('writes today, tomorrow and later dates in plain words', () => {
    expect(formatWhen(at(26, 23, 59), now)).toBe('Today 11:59 pm');
    expect(formatWhen(at(27, 9), now)).toBe('Tomorrow 9:00 am');
    expect(formatWhen(at(30, 0, 5), now)).toBe('Mon 30 Nov, 12:05 am');
    expect(formatWhen(new Date(2027, 0, 2, 12, 0), now)).toBe('Sat 2 Jan 2027, 12:00 pm');
  });

  it('describes the clock for the model with an explicit offset', () => {
    expect(describeNow(now, 330)).toBe('Thursday 26 November 2026, 23:50 (UTC+05:30)');
    expect(describeNow(now, -480)).toBe('Thursday 26 November 2026, 23:50 (UTC-08:00)');
  });
});

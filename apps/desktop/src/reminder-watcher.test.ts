import { addReminder, clearReminder, emptyMemory, snoozeReminder, type MemoryData } from '@flow/core';
import { describe, expect, it } from 'vitest';
import { ReminderWatcher } from './reminder-watcher';

const at = (h: number, mi = 0) => new Date(2026, 10, 27, h, mi);

function setup(initial: MemoryData = emptyMemory()) {
  let memory = initial;
  let now = at(8);
  const announced: string[][] = [];
  const w = new ReminderWatcher(
    () => memory,
    () => now,
    (fresh) => announced.push(fresh.map((r) => r.id)),
  );
  return {
    w,
    announced,
    set: (m: MemoryData) => (memory = m),
    get: () => memory,
    at: (d: Date) => (now = d),
  };
}

describe('ReminderWatcher', () => {
  it('announces a reminder once, when it becomes due', () => {
    const s = setup();
    s.set(addReminder(s.get(), 'call Dhriti', at(9), 'none', at(8), 'a'));
    s.w.check();
    expect(s.announced).toEqual([]);
    s.at(at(9, 1));
    s.w.check();
    s.w.check();
    expect(s.announced).toEqual([['a']]);
    expect(s.w.due().map((r) => r.id)).toEqual(['a']);
  });

  it('keeps a queue of everything due, oldest first, and announces only the new ones', () => {
    const s = setup();
    s.set(addReminder(addReminder(s.get(), 'two', at(10), 'none', at(8), 'b'), 'one', at(9), 'none', at(8), 'a'));
    s.at(at(9, 30));
    s.w.check();
    s.at(at(10, 30));
    s.w.check();
    expect(s.announced).toEqual([['a'], ['b']]);
    expect(s.w.due().map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('clearing one leaves the next in the queue, and a repeating one comes back later', () => {
    const s = setup();
    s.set(addReminder(addReminder(s.get(), 'daily', at(9), 'daily', at(8), 'r'), 'once', at(9, 5), 'none', at(8), 'o'));
    s.at(at(10));
    s.w.check();
    s.set(clearReminder(s.get(), 'r', at(10)));
    expect(s.w.due().map((r) => r.id)).toEqual(['o']);
    s.set(clearReminder(s.get(), 'o', at(10)));
    expect(s.w.due()).toEqual([]);
    s.at(new Date(2026, 10, 28, 9, 1));
    s.w.check();
    expect(s.announced.at(-1)).toEqual(['r']);
  });

  it('a snoozed reminder leaves the queue and announces itself again when the snooze ends', () => {
    const s = setup();
    s.set(addReminder(s.get(), 'call', at(9), 'none', at(8), 'a'));
    s.at(at(9, 1));
    s.w.check();
    s.set(snoozeReminder(s.get(), 'a', at(9, 1), 10));
    s.w.check();
    expect(s.w.due()).toEqual([]);
    s.at(at(9, 12));
    s.w.check();
    expect(s.announced).toEqual([['a'], ['a']]);
  });
});

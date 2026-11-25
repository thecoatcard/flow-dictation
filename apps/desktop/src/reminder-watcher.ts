import { dueReminders, type MemoryData, type Reminder } from '@flow/core';

/** How often the clock is checked. Reminders are to the minute, so a few seconds of slack is fine. */
const CHECK_MS = 15_000;

/**
 * Watches the saved reminders and tells the app when one becomes due, once. The queue the user clears one by
 * one is simply the reminders that are due right now. It checks on a short timer, and again after the PC wakes
 * from sleep, so a reminder that came due while the PC slept appears as soon as it is back.
 */
export class ReminderWatcher {
  private announced = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly memory: () => MemoryData,
    private readonly now: () => Date,
    /** Called with reminders that just became due (not ones already announced). */
    private readonly onNewlyDue: (fresh: Reminder[]) => void,
  ) {}

  /** The reminders due now, oldest first. */
  due(): Reminder[] {
    return dueReminders(this.memory(), this.now());
  }

  /** Looks at the clock now. Safe to call as often as wanted. */
  check(): void {
    const due = this.due();
    const fresh = due.filter((r) => !this.announced.has(`${r.id}@${r.snoozedUntil ?? r.due}`));
    // A reminder that is cleared, snoozed or moved on is forgotten, so it can announce itself again later.
    this.announced = new Set(due.map((r) => `${r.id}@${r.snoozedUntil ?? r.due}`));
    if (fresh.length) this.onNewlyDue(fresh);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.check(), CHECK_MS);
    this.timer.unref?.();
    this.check();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

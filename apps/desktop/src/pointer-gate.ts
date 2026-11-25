import { screen, type BrowserWindow } from 'electron';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Cursor {
  x: number;
  y: number;
}

/** Tells whether a point is inside a box, with a few pixels of slack so a grab at the very edge still lands. */
export function insideBox(p: Cursor, box: Box, slack = 3): boolean {
  return (
    p.x >= box.x - slack &&
    p.x <= box.x + box.width + slack &&
    p.y >= box.y - slack &&
    p.y <= box.y + box.height + slack
  );
}

/**
 * Keeps a transparent floating window click-through everywhere except over its own content, by watching where the
 * mouse actually is, instead of waiting for the page to hear the pointer move. Pages only hear it when Chromium forwards
 * mouse moves to a click-through window, and that stops working after some time (window shown or hidden, another
 * app in front, the PC locked or woken), which left the icon and cards impossible to grab until Flow was restarted.
 * Here the state is decided from the cursor position 25 times a second and set again every second, so it cannot stay
 * wrong. While something is being dragged the window stays interactive even if the cursor briefly leaves the box.
 */
export class PointerGate {
  private inside = false;
  private heldUntil = 0;
  private ticks = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly o: {
      win: () => BrowserWindow | null;
      /** The part of the window that takes the mouse, in window coordinates, or null when there is none. */
      area: () => Box | null;
      /** The pointer came onto the area, or went off it. */
      onChange?: (inside: boolean) => void;
      cursor?: () => Cursor;
      now?: () => number;
    },
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 40);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Keeps the window interactive for a moment longer; call it on every step of a drag. */
  hold(ms = 1500): void {
    this.heldUntil = (this.o.now ?? Date.now)() + ms;
  }

  release(): void {
    this.heldUntil = 0;
  }

  get isInside(): boolean {
    return this.inside;
  }

  /** One look at the mouse. Exposed so it can be called straight away after the window moves or changes. */
  tick(): void {
    const win = this.o.win();
    if (!win || win.isDestroyed() || !win.isVisible()) {
      this.inside = false;
      return;
    }
    const area = this.o.area();
    const at = (this.o.cursor ?? (() => screen.getCursorScreenPoint()))();
    const b = win.getBounds();
    const local = { x: at.x - b.x, y: at.y - b.y };
    const held = (this.o.now ?? Date.now)() < this.heldUntil;
    const want = held || (!!area && insideBox(local, area));
    const changed = want !== this.inside;
    this.inside = want;
    // Set again every second as well as on a change, so a state that went wrong by itself is put right.
    if (changed || ++this.ticks % 25 === 0) win.setIgnoreMouseEvents(!want, { forward: true });
    if (changed) this.o.onChange?.(want);
  }
}

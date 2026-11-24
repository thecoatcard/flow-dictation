export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}

const distanceToRect = (p: Point, r: Rect): number =>
  Math.hypot(
    Math.max(r.x - p.x, 0, p.x - (r.x + r.width)),
    Math.max(r.y - p.y, 0, p.y - (r.y + r.height)),
  );

/**
 * Keep a window's centre inside the nearest display, so a saved or dragged position can never
 * leave the icon stranded off-screen (e.g. after unplugging a monitor).
 */
export function clampOrigin(
  origin: Point,
  size: { width: number; height: number },
  areas: Rect[],
): Point {
  if (!areas.length) return origin;
  const centre = { x: origin.x + size.width / 2, y: origin.y + size.height / 2 };
  const area = areas.reduce((best, a) =>
    distanceToRect(centre, a) < distanceToRect(centre, best) ? a : best,
  );
  const cx = Math.min(Math.max(centre.x, area.x), area.x + area.width);
  const cy = Math.min(Math.max(centre.y, area.y), area.y + area.height);
  return { x: Math.round(cx - size.width / 2), y: Math.round(cy - size.height / 2) };
}

/** Default spot: bottom centre of the area, just above the taskbar. */
export function defaultOrigin(area: Rect, size: { width: number; height: number }): Point {
  return {
    x: Math.round(area.x + (area.width - size.width) / 2),
    y: Math.round(area.y + area.height - size.height - 24),
  };
}

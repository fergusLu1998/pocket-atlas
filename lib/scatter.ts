export type Bounds = { xmin: number; xmax: number; ymin: number; ymax: number };
export type PlotPoint = {
  x: number;
  y: number;
  key: string;
  visible: boolean;
  depth?: number;
};
export type PlotFrame = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export function fitBounds(points: { x: number; y: number }[]): Bounds {
  const finite = points.filter(
    (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
  );
  if (!finite.length) return { xmin: -1, xmax: 1, ymin: -1, ymax: 1 };
  let xmin = Infinity,
    xmax = -Infinity,
    ymin = Infinity,
    ymax = -Infinity;
  for (const p of finite) {
    xmin = Math.min(xmin, p.x);
    xmax = Math.max(xmax, p.x);
    ymin = Math.min(ymin, p.y);
    ymax = Math.max(ymax, p.y);
  }
  const dx = Math.max(xmax - xmin, 0.01),
    dy = Math.max(ymax - ymin, 0.01);
  return {
    xmin: xmin - dx * 0.08,
    xmax: xmax + dx * 0.08,
    ymin: ymin - dy * 0.08,
    ymax: ymax + dy * 0.08,
  };
}
export function toScreen(p: { x: number; y: number }, b: Bounds, f: PlotFrame) {
  return {
    x: f.left + ((p.x - b.xmin) / (b.xmax - b.xmin)) * (f.right - f.left),
    y: f.bottom - ((p.y - b.ymin) / (b.ymax - b.ymin)) * (f.bottom - f.top),
  };
}
export function fromScreen(x: number, y: number, b: Bounds, f: PlotFrame) {
  return {
    x: b.xmin + ((x - f.left) / (f.right - f.left)) * (b.xmax - b.xmin),
    y: b.ymin + ((f.bottom - y) / (f.bottom - f.top)) * (b.ymax - b.ymin),
  };
}
export function boxBounds(
  start: number[],
  end: number[],
  b: Bounds,
  f: PlotFrame,
): Bounds | null {
  const clampX = (x: number) => Math.max(f.left, Math.min(f.right, x));
  const clampY = (y: number) => Math.max(f.top, Math.min(f.bottom, y));
  const x0 = clampX(start[0]),
    x1 = clampX(end[0]),
    y0 = clampY(start[1]),
    y1 = clampY(end[1]);
  if (Math.abs(x0 - x1) < 6 || Math.abs(y0 - y1) < 6) return null;
  const a = fromScreen(x0, y0, b, f),
    z = fromScreen(x1, y1, b, f);
  return {
    xmin: Math.min(a.x, z.x),
    xmax: Math.max(a.x, z.x),
    ymin: Math.min(a.y, z.y),
    ymax: Math.max(a.y, z.y),
  };
}
export function scaleBounds(
  b: Bounds,
  factor: number,
  anchor?: { x: number; y: number },
): Bounds {
  const p = anchor || { x: (b.xmin + b.xmax) / 2, y: (b.ymin + b.ymax) / 2 };
  return {
    xmin: p.x + (b.xmin - p.x) * factor,
    xmax: p.x + (b.xmax - p.x) * factor,
    ymin: p.y + (b.ymin - p.y) * factor,
    ymax: p.y + (b.ymax - p.y) * factor,
  };
}
export function hitPoints<T extends PlotPoint>(
  points: T[],
  x: number,
  y: number,
  frame: PlotFrame,
  radius = 12,
): T[] {
  return points
    .filter(
      (p) =>
        p.x >= frame.left &&
        p.x <= frame.right &&
        p.y >= frame.top &&
        p.y <= frame.bottom &&
        Math.hypot(p.x - x, p.y - y) <= radius,
    )
    .sort(
      (a, b) =>
        Number(b.visible) - Number(a.visible) ||
        Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y) ||
        (b.depth || 0) - (a.depth || 0),
    );
}
export function rotatePoint(
  p: { x: number; y: number; z?: number },
  yaw: number,
  pitch: number,
) {
  const z = p.z || 0,
    x = p.x * Math.cos(yaw) + z * Math.sin(yaw),
    depth = -p.x * Math.sin(yaw) + z * Math.cos(yaw);
  return {
    x,
    y: p.y * Math.cos(pitch) - depth * Math.sin(pitch),
    depth: p.y * Math.sin(pitch) + depth * Math.cos(pitch),
  };
}

'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Scan } from 'lucide-react';
import type { Mol } from '@/lib/chem';
import {
  boxBounds,
  fitBounds,
  fromScreen,
  hitPoints,
  rotatePoint,
  scaleBounds,
  toScreen,
  type Bounds,
} from '@/lib/scatter';

const colors = [
  '#3572d4',
  '#e89837',
  '#28a394',
  '#9661c8',
  '#d86683',
  '#6d9e39',
  '#5a9ec4',
  '#b07445',
  '#c469c0',
  '#6b79a6',
  '#dc7653',
  '#3a9981',
];
function hull(points: { x: number; y: number }[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: (typeof sorted)[number], b: typeof a, c: typeof a) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (list: typeof sorted) => {
    const out: typeof sorted = [];
    for (const p of list) {
      while (
        out.length > 1 &&
        cross(out[out.length - 2], out[out.length - 1], p) <= 0
      )
        out.pop();
      out.push(p);
    }
    return out;
  };
  const a = half(sorted),
    b = half([...sorted].reverse());
  a.pop();
  b.pop();
  return [...a, ...b];
}
export function Scatter({
  rows,
  visible,
  selected,
  active,
  onActive,
  onRegion,
  mode,
}: {
  rows: Mol[];
  visible: Set<string>;
  selected: string[];
  active: string | null;
  onActive: (key: string) => void;
  onRegion: (keys: string[] | null) => void;
  mode: 'map' | 'scores' | 'clusters';
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    start: number[];
    angles: number[];
    moved: boolean;
  } | null>(null);
  const [size, setSize] = useState({ w: 700, h: 385 }),
    [bounds, setBounds] = useState<Bounds | null>(null);
  const [dimension, setDimension] = useState<'2d' | '3d'>('2d'),
    [tool, setTool] = useState<'zoom' | 'filter' | 'rotate'>('zoom');
  const [angles, setAngles] = useState([0.45, -0.3]),
    [rect, setRect] = useState<number[] | null>(null);
  const [hover, setHover] = useState<Mol | null>(null),
    [hits, setHits] = useState<Mol[]>([]);
  const is3d = mode !== 'scores' && dimension === '3d';
  const data = useMemo(
    () =>
      rows.filter(
        (r) =>
          mode !== 'scores' ||
          (Number.isFinite(r.docking) &&
            Number.isFinite(r.mmgbsa) &&
            r.docking !== null &&
            r.mmgbsa !== null),
      ),
    [rows, mode],
  );
  const coordinates = useMemo(() => {
    const center = { x: 0, y: 0, z: 0 };
    for (const r of data) {
      center.x += r.x;
      center.y += r.y;
      center.z += r.z || 0;
    }
    const n = data.length || 1;
    center.x /= n;
    center.y /= n;
    center.z /= n;
    return data.map((row) => ({
      row,
      ...(mode === 'scores'
        ? { x: row.docking!, y: row.mmgbsa!, depth: 0 }
        : is3d
          ? rotatePoint(
              {
                x: row.x - center.x,
                y: row.y - center.y,
                z: (row.z || 0) - center.z,
              },
              angles[0],
              angles[1],
            )
          : { x: row.x, y: row.y, depth: 0 }),
    }));
  }, [data, mode, is3d, angles]);
  const frame = useMemo(
    () => ({
      left: 56,
      right: Math.max(80, size.w - 24),
      top: 38,
      bottom: size.h - 40,
    }),
    [size],
  );
  const fullBounds = useMemo(() => fitBounds(coordinates), [coordinates]);
  const view = bounds || fullBounds;
  const points = useMemo(
    () =>
      coordinates.map((p) => ({
        ...toScreen(p, view, frame),
        row: p.row,
        key: p.row.key,
        visible: visible.has(p.row.key),
        depth: p.depth,
      })),
    [coordinates, view, frame, visible],
  );
  const clusters = useMemo(() => {
    const groups = new Map<number, typeof points>();
    for (const p of points) {
      if (!groups.has(p.row.cluster)) groups.set(p.row.cluster, []);
      groups.get(p.row.cluster)!.push(p);
    }
    return [...groups].sort((a, b) => b[1].length - a[1].length);
  }, [points]);
  useEffect(() => {
    if (!wrap.current) return;
    const obs = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: 385 }),
    );
    obs.observe(wrap.current);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const handler = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const box = el.getBoundingClientRect(),
        x = ((event.clientX - box.left) * size.w) / box.width,
        y = ((event.clientY - box.top) * size.h) / box.height;
      if (
        x < frame.left ||
        x > frame.right ||
        y < frame.top ||
        y > frame.bottom
      )
        return;
      setBounds(
        scaleBounds(
          view,
          event.deltaY > 0 ? 1.15 : 1 / 1.15,
          fromScreen(x, y, view, frame),
        ),
      );
      setHits([]);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [size, frame, view]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = size.w * dpr;
    el.height = size.h * dpr;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.font = '11px Segoe UI';
    ctx.fillStyle = '#708198';
    for (let i = 0; i <= 4; i++) {
      const x = frame.left + ((frame.right - frame.left) * i) / 4,
        y = frame.bottom - ((frame.bottom - frame.top) * i) / 4;
      ctx.strokeStyle = '#e5ebf3';
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(x, frame.top);
      ctx.lineTo(x, frame.bottom);
      ctx.moveTo(frame.left, y);
      ctx.lineTo(frame.right, y);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(
        (view.xmin + ((view.xmax - view.xmin) * i) / 4).toFixed(2),
        x,
        frame.bottom + 18,
      );
      ctx.textAlign = 'right';
      ctx.fillText(
        (view.ymin + ((view.ymax - view.ymin) * i) / 4).toFixed(2),
        frame.left - 8,
        y + 4,
      );
    }
    ctx.setLineDash([]);
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      frame.left,
      frame.top,
      frame.right - frame.left,
      frame.bottom - frame.top,
    );
    ctx.clip();
    if (mode === 'clusters')
      for (const [cluster, list] of clusters) {
        const members = list.filter((p) => p.visible),
          polygon = hull(members);
        if (!members.length) continue;
        ctx.fillStyle = colors[(cluster - 1) % colors.length];
        ctx.strokeStyle = ctx.fillStyle;
        ctx.globalAlpha = 0.08;
        ctx.beginPath();
        if (polygon.length >= 3) {
          ctx.moveTo(polygon[0].x, polygon[0].y);
          for (const p of polygon.slice(1)) ctx.lineTo(p.x, p.y);
          ctx.closePath();
        } else {
          const p = members[0];
          ctx.ellipse(p.x, p.y, 13, 13, 0, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.globalAlpha = 0.4;
        ctx.stroke();
      }
    const selectedSet = new Set(selected);
    for (const p of [...points].sort(
      (a, b) =>
        a.depth - b.depth ||
        Number(a.key === active) - Number(b.key === active),
    )) {
      const chosen = selectedSet.has(p.key),
        focused = p.key === active;
      ctx.globalAlpha = p.visible ? 0.85 : 0.13;
      ctx.fillStyle = colors[(p.row.cluster - 1) % colors.length];
      ctx.beginPath();
      ctx.arc(
        p.x,
        p.y,
        focused ? 8 : chosen ? 6 : data.length > 700 ? 3.5 : 5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      if (chosen || focused) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = focused ? '#182e4d' : '#1b9b73';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    if (mode === 'clusters')
      for (const [id, list] of clusters.slice(0, 18)) {
        const p =
          list.find((p) => p.row.center && p.visible) ||
          list.find((p) => p.visible);
        if (!p) continue;
        ctx.globalAlpha = 1;
        ctx.font = 'bold 11px Segoe UI';
        ctx.fillStyle = '#263e5b';
        ctx.textAlign = 'left';
        ctx.fillText('C' + id, p.x + 9, p.y - 8);
      }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.font = '11px Segoe UI';
    ctx.fillStyle = '#708198';
    ctx.textAlign = 'center';
    ctx.fillText(
      mode === 'scores'
        ? 'Docking score (kcal/mol)'
        : is3d
          ? '旋转投影水平坐标'
          : 'FastMap 1',
      size.w / 2,
      size.h - 3,
    );
    ctx.save();
    ctx.translate(12, size.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(
      mode === 'scores'
        ? 'MM/GBSA (kcal/mol)'
        : is3d
          ? '旋转投影垂直坐标'
          : 'FastMap 2',
      0,
      0,
    );
    ctx.restore();
    if (rect) {
      ctx.fillStyle = 'rgba(36,101,211,.1)';
      ctx.strokeStyle = '#2465d3';
      ctx.setLineDash([4, 3]);
      ctx.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
      ctx.strokeRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
    }
  }, [
    points,
    clusters,
    mode,
    view,
    frame,
    size,
    data.length,
    active,
    selected,
    rect,
    is3d,
  ]);
  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const b = e.currentTarget.getBoundingClientRect();
    return [
      ((e.clientX - b.left) * size.w) / b.width,
      ((e.clientY - b.top) * size.h) / b.height,
    ];
  }
  function pick(p: number[]) {
    return hitPoints(points, p[0], p[1], frame).map((h) => h.row);
  }
  return (
    <div>
      <div className="scatter-controls" aria-label="散点图交互选项">
        <label>
          拖动操作{' '}
          <select
            aria-label="拖动操作"
            value={tool}
            onChange={(e) => setTool(e.target.value as typeof tool)}
          >
            <option value="zoom">框选放大</option>
            <option value="filter">框选筛选</option>
            {is3d && <option value="rotate">旋转视图</option>}
          </select>
        </label>
        {mode !== 'scores' && (
          <label>
            投影维度{' '}
            <select
              aria-label="投影维度"
              value={dimension}
              onChange={(e) => {
                setDimension(e.target.value as typeof dimension);
                setTool('zoom');
                setBounds(null);
                setHits([]);
              }}
            >
              <option value="2d">二维 FastMap</option>
              <option value="3d">三维 FastMap</option>
            </select>
          </label>
        )}
        <button
          type="button"
          onClick={() => {
            setBounds(null);
            setHits([]);
          }}
        >
          恢复全图
        </button>
        <button type="button" onClick={() => onRegion(null)}>
          清除框选筛选
        </button>
      </div>
      <div className="plot" ref={wrap}>
        <canvas
          ref={canvas}
          data-view-bounds={JSON.stringify(view)}
          data-view-angles={JSON.stringify(angles)}
          data-point-count={points.length}
          style={{ width: '100%', height: 385, touchAction: 'none' }}
          aria-label="分子散点图：点击点查看分子，拖动框选放大或筛选，滚轮缩放。重叠点可从列表逐个选择。"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            drag.current = { start: pos(e), angles: [...angles], moved: false };
            setHits([]);
            setHover(null);
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const p = pos(e),
              d = drag.current;
            if (d) {
              if (Math.hypot(p[0] - d.start[0], p[1] - d.start[1]) > 5)
                d.moved = true;
              if (d.moved) {
                if (tool === 'rotate' && is3d) {
                  setAngles([
                    d.angles[0] + (p[0] - d.start[0]) * 0.009,
                    d.angles[1] + (p[1] - d.start[1]) * 0.009,
                  ]);
                  setBounds(null);
                } else setRect([...d.start, ...p]);
              }
            } else setHover(pick(p)[0] || null);
          }}
          onPointerUp={(e) => {
            const p = pos(e),
              d = drag.current;
            if (!d) return;
            if (d.moved && tool === 'zoom') {
              const b = boxBounds(d.start, p, view, frame);
              if (b) setBounds(b);
            } else if (d.moved && tool === 'filter') {
              const [x, y] = d.start;
              onRegion(
                points
                  .filter(
                    (k) =>
                      k.visible &&
                      k.x >= frame.left &&
                      k.x <= frame.right &&
                      k.y >= frame.top &&
                      k.y <= frame.bottom &&
                      k.x >= Math.min(x, p[0]) &&
                      k.x <= Math.max(x, p[0]) &&
                      k.y >= Math.min(y, p[1]) &&
                      k.y <= Math.max(y, p[1]),
                  )
                  .map((k) => k.key),
              );
            } else if (!d.moved) {
              const found = pick(p);
              if (found.length) {
                onActive(found[0].key);
                if (found.length > 1) setHits(found);
              }
            }
            drag.current = null;
            setRect(null);
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setRect(null);
          }}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setBounds(
              scaleBounds(
                view,
                0.5,
                fromScreen(
                  ((e.clientX - box.left) * size.w) / box.width,
                  ((e.clientY - box.top) * size.h) / box.height,
                  view,
                  frame,
                ),
              ),
            );
          }}
        />
        <div className="plot-tools">
          <button
            aria-label="放大图"
            title="放大"
            onClick={() => setBounds(scaleBounds(view, 1 / 1.3))}
          >
            <Plus size={16} />
          </button>
          <button
            aria-label="缩小图"
            title="缩小"
            onClick={() => setBounds(scaleBounds(view, 1.3))}
          >
            <Minus size={16} />
          </button>
          <button
            aria-label="重置图"
            title="恢复全图"
            onClick={() => {
              setBounds(null);
              setAngles([0.45, -0.3]);
              setHits([]);
            }}
          >
            <Scan size={16} />
          </button>
        </div>
        {hover && !hits.length && (
          <div className="plot-tooltip">
            <b>{hover.id}</b>
            <span>结构簇 {hover.cluster}</span>
            <span>
              Docking {hover.docking ?? '—'} · MM/GBSA {hover.mmgbsa ?? '—'}
            </span>
          </div>
        )}
        {!!hits.length && (
          <div
            className="scatter-hit-list"
            role="dialog"
            aria-label="重叠分子选择"
          >
            <div>
              <b>邻近或重叠点：{hits.length} 个分子</b>
              <button aria-label="关闭重叠分子列表" onClick={() => setHits([])}>
                关闭
              </button>
            </div>
            {hits.map((r) => (
              <button
                key={r.key}
                className={r.key === active ? 'active' : ''}
                onClick={() => onActive(r.key)}
              >
                {r.id}
                <small>
                  簇 {r.cluster} · MM/GBSA {r.mmgbsa ?? '—'}
                </small>
              </button>
            ))}
          </div>
        )}
        {!data.length && (
          <div className="plot-empty">
            {mode === 'scores'
              ? '导入 Docking 和 MM/GBSA 后显示评分分布'
              : '导入分子或载入演示后显示降维分布'}
          </div>
        )}
      </div>
      <div className="plot-note">
        <span>点击查看分子；重叠点展开列表。滚轮缩放，默认拖动框选放大。</span>
        <span>
          {mode === 'scores'
            ? `${data.length} / ${rows.length} 个分子有完整评分`
            : is3d
              ? '三维 FastMap；选择旋转视图可拖动旋转'
              : '二维 FastMap；距离仅用于导航，不替代 Tanimoto 相似性'}
        </span>
      </div>
      {mode === 'clusters' && (
        <div className="scatter-cluster-legend" aria-label="聚类图例">
          {clusters.map(([id, list]) => (
            <button key={id} onClick={() => onRegion(list.map((p) => p.key))}>
              <i style={{ background: colors[(id - 1) % colors.length] }} />簇{' '}
              {id}（{list.length}）
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

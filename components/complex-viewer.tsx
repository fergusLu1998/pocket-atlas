'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Structure, toMolBlock, toPDB } from '@/lib/structures';
import { csv, download } from '@/lib/chem';
import {
  EngineConnection,
  Interaction,
  InteractionResult,
  calculateInteractions,
} from '@/lib/local-engine';
import { residueKey, endpointResidue } from '@/lib/interactions';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
let loading: Promise<any> | null = null;
function engine() {
  return (loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/3Dmol-min.js';
    s.onload = () => resolve((window as any).$3Dmol);
    s.onerror = () => {
      loading = null;
      reject(Error('三维引擎加载失败'));
    };
    document.head.appendChild(s);
  }));
}
const kinds: Record<string, [string, string]> = {
  hbond: ['氢键', '#1783bd'],
  halogen: ['卤键', '#9861c7'],
  salt: ['盐桥', '#e35959'],
  pipi: ['π–π', '#d49422'],
  pication: ['π–阳离子', '#299c78'],
  contact: ['几何近接', '#7b8fa0'],
};
const aa3: Record<string, string> = {
  ALA: 'A',
  ARG: 'R',
  ASN: 'N',
  ASP: 'D',
  CYS: 'C',
  GLN: 'Q',
  GLU: 'E',
  GLY: 'G',
  HIS: 'H',
  ILE: 'I',
  LEU: 'L',
  LYS: 'K',
  MET: 'M',
  PHE: 'F',
  PRO: 'P',
  SER: 'S',
  THR: 'T',
  TRP: 'W',
  TYR: 'Y',
  VAL: 'V',
  SEC: 'U',
};
const aaNames: Record<string, string> = {
  A: 'Ala',
  R: 'Arg',
  N: 'Asn',
  D: 'Asp',
  C: 'Cys',
  Q: 'Gln',
  E: 'Glu',
  G: 'Gly',
  H: 'His',
  I: 'Ile',
  L: 'Leu',
  K: 'Lys',
  M: 'Met',
  F: 'Phe',
  P: 'Pro',
  S: 'Ser',
  T: 'Thr',
  W: 'Trp',
  Y: 'Tyr',
  V: 'Val',
};
type SeqResidue = {
  key: string;
  aa: string;
  resn: string;
  resi: number;
  chain: string;
};
function sequenceOf(s: Structure | null): SeqResidue[] {
  if (!s) return [];
  const seen = new Set<string>(),
    out: SeqResidue[] = [];
  for (const a of s.atoms) {
    const aa = aa3[a.resn.toUpperCase()];
    const key = residueKey(a);
    if (aa && !seen.has(key)) {
      seen.add(key);
      out.push({ key, aa, resn: a.resn, resi: a.resi, chain: a.chain || '_' });
    }
  }
  return out;
}
function align(reference: SeqResidue[], query: SeqResidue[]) {
  const a = reference.map((r) => r.aa),
    b = query.map((r) => r.aa),
    cols = b.length + 1,
    score = new Int32Array((a.length + 1) * cols),
    trace = new Uint8Array((a.length + 1) * cols);
  for (let i = 1; i <= a.length; i++) {
    score[i * cols] = -i;
    trace[i * cols] = 1;
  }
  for (let j = 1; j <= b.length; j++) {
    score[j] = -j;
    trace[j] = 2;
  }
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const diag =
          score[(i - 1) * cols + j - 1] + (a[i - 1] === b[j - 1] ? 2 : -1),
        up = score[(i - 1) * cols + j] - 1,
        left = score[i * cols + j - 1] - 1,
        p = i * cols + j;
      if (diag >= up && diag >= left) {
        score[p] = diag;
        trace[p] = 0;
      } else if (up >= left) {
        score[p] = up;
        trace[p] = 1;
      } else {
        score[p] = left;
        trace[p] = 2;
      }
    }
  const map = new Map<number, string>(),
    ra: string[] = [],
    qa: string[] = [];
  let i = a.length,
    j = b.length;
  while (i || j) {
    const t = trace[i * cols + j];
    if (i && j && t === 0) {
      ra.push(a[--i]);
      qa.push(b[--j]);
      map.set(i, b[j]);
    } else if (i && (!j || t === 1)) {
      ra.push(a[--i]);
      qa.push('-');
      map.set(i, '-');
    } else {
      ra.push('-');
      qa.push(b[--j]);
    }
  }
  return {
    map,
    reference: ra.reverse().join(''),
    query: qa.reverse().join(''),
  };
}
const aaClass = (aa: string) =>
  'DE'.includes(aa)
    ? '酸性'
    : 'KRH'.includes(aa)
      ? '碱性'
      : 'STNQ'.includes(aa)
        ? '极性'
        : 'FWY'.includes(aa)
          ? '芳香族'
          : 'ILVMAC'.includes(aa)
            ? '疏水'
            : aa === 'G'
              ? '柔性'
              : aa === 'P'
                ? '构象受限'
                : '其他';
export function ComplexViewer({
  open,
  ligand,
  protein,
  proteins,
  connection,
  cached,
  onCache,
  onClose,
}: {
  open: boolean;
  ligand: Structure | null;
  protein: Structure | null;
  proteins: Structure[];
  connection: EngineConnection | null;
  cached: Record<string, InteractionResult>;
  onCache: (key: string, value: InteractionResult) => void;
  onClose: () => void;
}) {
  const [hostElement, setHostElement] = useState<HTMLDivElement | null>(null);
  const [hoveredInteraction, setHoveredInteraction] = useState<{ pair: Interaction; x: number; y: number } | null>(null);
  const labelLayer = useRef<HTMLDivElement>(null),
    stage = useRef<HTMLDivElement>(null),
    viewer = useRef<any>(null),
    camera = useRef<any>(null),
    lastScene = useRef('');
  const [style, setStyle] = useState('oval'),
    [preset, setPreset] = useState('pocket'),
    [cutoff, setCutoff] = useState(4),
    [surface, setSurface] = useState('none'),
    [surfaceOpacity, setSurfaceOpacity] = useState(0.3),
    [proteinOpacity, setProteinOpacity] = useState(0.7),
    [distanceLabels, setDistanceLabels] = useState(true),
    [labels, setLabels] = useState(true),
    [residues, setResidues] = useState(true),
    [contacts, setContacts] = useState(false),
    [depth, setDepth] = useState(40),
    [clipping, setClipping] = useState(false),
    [projection, setProjection] = useState('orthographic'),
    [enabled, setEnabled] = useState(Object.keys(kinds)),
    [alignmentSelection, setAlignmentSelection] = useState<number[]>([]),
    [mutationResidue, setMutationResidue] = useState(''),
    [mutationTo, setMutationTo] = useState('A'),
    [error, setError] = useState(''),
    [calculating, setCalculating] = useState(false),
    [surfaceBusy, setSurfaceBusy] = useState(false);
  const [focusedResidue, setFocusedResidue] = useState('');
  const mode = ligand ? preset : 'full';
  const cacheKey =
    protein?.nativeId && ligand?.nativeId
      ? protein.nativeId + '|' + ligand.nativeId
      : '';
  const native = cacheKey ? cached[cacheKey] : null;
  const referenceSequence = useMemo(() => sequenceOf(protein), [protein]);
  const alignments = useMemo(
    () =>
      alignmentSelection
        .filter((index) => proteins[index] && proteins[index] !== protein)
        .map((index) => ({
          index,
          title: proteins[index]?.title || `受体 ${index + 1}`,
          result: align(referenceSequence, sequenceOf(proteins[index])),
        })),
    [alignmentSelection, proteins, referenceSequence],
  );
  const autoRequested = useRef('');
  const neighborhood = useMemo(() => {
    const near = new Set<string>(),
      pairs: Interaction[] = [];
    if (protein && ligand) {
      for (const a of protein.atoms) {
        if (a.elem === 'H') continue;
        for (const [i, b] of ligand.atoms.entries()) {
          if (b.elem === 'H') continue;
          const distance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
          if (distance <= cutoff) near.add(residueKey(a));
          if (
            distance <= 3.5 &&
            ['N', 'O', 'S'].includes(a.elem) &&
            ['N', 'O', 'S'].includes(b.elem)
          )
            pairs.push({
              type: 'contact',
              a: {
                ...a,
                label: residueKey(a) + ':' + a.atom,
                side: 'receptor',
                atomIndices: [],
              },
              b: {
                ...b,
                label: '配体:' + b.elem + (i + 1),
                side: 'ligand',
                atomIndices: [i + 1],
              },
              distance,
              distanceType: 'heavy-atom',
            });
        }
      }
    }
    return { near, pairs };
  }, [protein, ligand, cutoff]);
  const shown = useMemo(
    () =>
      [
        ...(native?.pairs || []),
        ...(contacts ? neighborhood.pairs : []),
      ].filter((p) => enabled.includes(p.type)),
    [native, contacts, neighborhood, enabled],
  );
  const residueOptions = useMemo(() => {
    const keys = new Set([...neighborhood.near]);
    shown.forEach((p) => keys.add(endpointResidue(p.a)));
    return referenceSequence.filter((r) => keys.has(r.key));
  }, [referenceSequence, neighborhood.near, shown]);
  useEffect(() => {
    setAlignmentSelection(
      proteins.flatMap((item, i) => (item !== protein ? [i] : [])),
    );
  }, [proteins, protein]);
  useEffect(() => {
    if (!residueOptions.some((r) => r.key === mutationResidue))
      setMutationResidue(residueOptions[0]?.key || '');
  }, [residueOptions, mutationResidue]);
  function conservation(key: string) {
    const ri = referenceSequence.findIndex((r) => r.key === key);
    if (ri < 0 || !alignments.length) return null;
    const wt = referenceSequence[ri].aa,
      observed = alignments.map((a) => a.result.map.get(ri) || '-'),
      same = observed.filter((aa) => aa === wt).length;
    return { wt, observed, same, total: observed.length };
  }
  async function calculate() {
    if (!connection || !cacheKey) return;
    setCalculating(true);
    setError('');
    try {
      const result = await calculateInteractions(connection, protein!, ligand!);
      onCache(cacheKey, result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCalculating(false);
    }
  }
  useEffect(() => {
    if (
      open &&
      connection &&
      cacheKey &&
      !native &&
      autoRequested.current !== connection.token + cacheKey
    ) {
      autoRequested.current = connection.token + cacheKey;
      void calculate();
    }
  }, [open, connection, cacheKey, native]);
  useEffect(() => {
    const element = stage.current;
    if (!open || !element) return;
    const wheel = (event: WheelEvent) => {
      // Capture above both the WebGL canvas and the HTML residue labels.
      // Own the gesture so it cannot also scroll the containing dialog.
      event.preventDefault();
      event.stopImmediatePropagation();
      setHoveredInteraction(null);
      const v = viewer.current;
      if (!v) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      v.zoom(Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002));
      v.render();
    };
    element.addEventListener('wheel', wheel, { capture: true, passive: false });
    return () => element.removeEventListener('wheel', wheel, true);
  }, [open, hostElement]);
  useEffect(() => {
    if (!open) {
      camera.current = null;
      lastScene.current = '';
      setFocusedResidue('');
      return;
    }
    if (!ligand && !protein) return;
    let alive = true;
    let observer: ResizeObserver | undefined;
    const el = hostElement;
    engine()
      .then((D) => {
        if (!alive || !el) return;
        setError('');
        setSurfaceBusy(false);
        const v = D.createViewer(el, {
          backgroundColor: '#f5f8fc',
          antialias: true,
          minimumZoomToDistance: 6,
        });
        viewer.current = v;
        v.setDefaultCartoonQuality(10);
        v.setProjection(projection);
        let receptorModel: any = null;
        if (protein) receptorModel = v.addModel(toPDB(protein), 'pdb');
        if (ligand) v.addModel(toMolBlock(ligand), 'sdf');
        const lid = protein ? 1 : 0;
        v.setStyle({}, {});
        const proteinAtoms: any[] = receptorModel
          ? receptorModel.selectedAtoms({})
          : [];
        const nearIndices = proteinAtoms
          .filter((a) => neighborhood.near.has(residueKey(a)))
          .map((a) => a.index);
        const pocket = { model: 0, index: nearIndices };
        if (protein && mode !== 'ligand') {
          const chains = [...new Set(proteinAtoms.map((a) => a.chain))],
            colors = ['#759eb9', '#90afa7', '#a29cbd', '#b5a18b'];
          const hasBackbone =
            proteinAtoms.filter((a) => a.atom === 'CA').length >= 3;
          if (mode !== 'pocket-only' || !ligand)
            chains.forEach((chain, i) =>
              v.setStyle(
                { model: 0, chain },
                hasBackbone
                  ? {
                      cartoon: {
                        style,
                        thickness: style === 'trace' ? 0.24 : 0.14,
                        width: 0.72,
                        color: colors[i % colors.length],
                        arrows: true,
                        tubes: false,
                        opacity: proteinOpacity,
                      },
                    }
                  : { line: { colorscheme: 'grayCarbon' } },
              ),
            );
          if (residues && ligand)
            v.addStyle(
              { ...pocket, not: { elem: 'H' } },
              { stick: { radius: 0.12, colorscheme: 'grayCarbon' } },
            );
          v.setClickable(pocket, true, (atom: any) =>
            focusResidue(residueKey(atom)),
          );
          if (surface !== 'none' && ligand && nearIndices.length) {
            setSurfaceBusy(true);
            const haloIndices = proteinAtoms
              .filter((a) =>
                ligand.atoms.some(
                  (b) =>
                    b.elem !== 'H' &&
                    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < cutoff + 7,
                ),
              )
              .map((a) => a.index);
            v.addSurface(
              surface === 'sas' ? D.SurfaceType.SAS : D.SurfaceType.MS,
              { opacity: surfaceOpacity, color: '#92b4ca' },
              pocket,
              { model: 0, index: haloIndices },
            )
              .then(() => {
                if (alive) {
                  setSurfaceBusy(false);
                  v.render();
                }
              })
              .catch(() => {
                if (alive) {
                  setSurfaceBusy(false);
                  setError('口袋表面计算失败，可减小口袋半径后重试。');
                }
              });
          }
        }
        if (ligand) {
          v.setStyle(
            { model: lid },
            {
              stick: { radius: 0.18, colorscheme: 'tealCarbon' },
              sphere: { scale: 0.22, colorscheme: 'tealCarbon' },
            },
          );
          v.setStyle({ model: lid, elem: 'H' }, {});
        }
        if (mode !== 'ligand')
          shown.forEach((p) => {
            const color = kinds[p.type]?.[1] || '#778899';
            v.addCylinder({
              start: p.a,
              end: p.b,
              radius: 0.045,
              color,
              dashed: true,
              fromCap: 1,
              toCap: 1,
            });
            if (distanceLabels)
              v.addLabel(
                p.distance.toFixed(2) +
                  ' Å' +
                  (p.distanceType === 'centroid' ? ' · 中心' : ''),
                {
                  position: {
                    x: (p.a.x + p.b.x) / 2,
                    y: (p.a.y + p.b.y) / 2,
                    z: (p.a.z + p.b.z) / 2,
                  },
                  fontSize: 12,
                  fontColor: color,
                  backgroundColor: '#ffffff',
                  backgroundOpacity: 0.9,
                  inFront: true,
                },
              );
          });
        const scene =
          (ligand?.nativeId || ligand?.title || '') +
          '|' +
          (protein?.nativeId || protein?.title || '') +
          '|' +
          mode;
        const preserveCamera = scene === lastScene.current && camera.current;
        if (preserveCamera) v.setView(camera.current);
        else {
          if (!ligand || mode === 'full') v.zoomTo();
          else if (mode === 'pocket-only' && nearIndices.length)
            v.zoomTo({ or: [pocket, { model: lid }] });
          else {
            v.zoomTo({ model: lid });
            v.zoom(0.9);
          }
          lastScene.current = scene;
        }
        if (clipping) v.setSlab(-depth / 2, depth / 2);
        const layer = labelLayer.current;
        const anchors = new Map<string, any>();
        if (labels && mode !== 'ligand')
          proteinAtoms.forEach((a) => {
            const key = residueKey(a);
            if (
              neighborhood.near.has(key) &&
              (!anchors.has(key) || a.atom === 'CA')
            )
              anchors.set(key, a);
          });
        const tags = [...anchors].map(([key, atom]) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'residue-tag';
          button.textContent = key;
          button.title = `聚焦 ${key}`;
          button.setAttribute('aria-label', `聚焦残基 ${key}`);
          button.onclick = () => focusResidue(key);
          layer?.appendChild(button);
          return { button, atom };
        });
        const placeLabels = () => {
          const box = el.getBoundingClientRect(),
            view = v.getView();
          const [tx, ty, tz, , qx, qy, qz, qw] = view;
          tags.forEach(({ button, atom }) => {
            const point = v.modelToScreen(atom);
            const x = point.x - box.left - window.scrollX,
              y = point.y - box.top - window.scrollY;
            const ax = atom.x + tx,
              ay = atom.y + ty,
              az = atom.z + tz;
            const z =
              2 * (qx * qz - qy * qw) * ax +
              2 * (qy * qz + qx * qw) * ay +
              (1 - 2 * (qx * qx + qy * qy)) * az;
            const perPixel = v.screenToModelDistance(
              { x: point.x + 1, y: point.y },
              atom,
            );
            button.hidden =
              x < 0 ||
              x > box.width ||
              y < 0 ||
              y > box.height ||
              (clipping && Math.abs(z) > depth / 2);
            button.style.left = `${x}px`;
            button.style.top = `${y}px`;
            button.style.transform = `translate(-50%, -110%) scale(${Math.max(0.65, Math.min(1.35, 0.16 / Math.max(0.001, perPixel)))})`;
          });
        };
        v.setViewChangeCallback(placeLabels);
        v.render();
        placeLabels();
        let firstResize = true;
        observer = new ResizeObserver(() => {
          v.resize();
          // The dialog portal may still be entering when WebGL is initialized.
          // Reframe once after its actual dimensions are known.
          if (firstResize && el.clientWidth && el.clientHeight) {
            firstResize = false;
            if (preserveCamera) v.setView(preserveCamera);
            else if (!ligand || mode === 'full') v.zoomTo();
            else if (mode === 'pocket-only' && nearIndices.length)
              v.zoomTo({ or: [pocket, { model: lid }] });
            else {
              v.zoomTo({ model: lid });
              v.zoom(0.9);
            }
            if (clipping) v.setSlab(-depth / 2, depth / 2);
          }
          v.render();
          placeLabels();
        });
        observer.observe(el);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      observer?.disconnect();
      if (viewer.current) {
        camera.current = viewer.current.getView();
        viewer.current.clear();
        viewer.current = null;
      }
      el?.replaceChildren();
      labelLayer.current?.replaceChildren();
    };
  }, [
    open,
    hostElement,
    ligand,
    protein,
    style,
    preset,
    surface,
    surfaceOpacity,
    proteinOpacity,
    neighborhood,
    residues,
    labels,
    shown,
    distanceLabels,
    projection,
    clipping,
    depth,
  ]);
  function focus() {
    const v = viewer.current;
    if (!v) return;
    if (ligand && mode !== 'full') {
      v.zoomTo({ model: protein ? 1 : 0 });
      v.zoom(0.9);
    } else v.zoomTo();
    v.render();
    setFocusedResidue('');
  }
  function focusResidue(key: string) {
    const v = viewer.current;
    if (!v || !protein) return;
    // PDB readers may omit hydrogens; use the rendered atom indices, not source indices.
    const indices = v
      .selectedAtoms({ model: 0 })
      .filter((a: any) => residueKey(a) === key)
      .map((a: any) => a.index);
    if (!indices.length) return;
    v.zoomTo({ model: 0, index: indices });
    v.zoom(1.5);
    if (clipping) v.setSlab(-depth / 2, depth / 2);
    v.render();
    setFocusedResidue(key);
  }
  function hoverInteraction(event: React.PointerEvent<HTMLDivElement>) {
    const v = viewer.current;
    const el = stage.current;
    if (!v || !el || event.buttons || mode === 'ligand') { setHoveredInteraction(null); return; }
    const box = el.getBoundingClientRect();
    const x = event.clientX - box.left, y = event.clientY - box.top;
    let nearest: Interaction | null = null, nearestDistance = 8;
    const [tx, ty, tz, , qx, qy, qz, qw] = v.getView();
    for (const pair of shown) {
      if (clipping) {
        const ax = (pair.a.x + pair.b.x) / 2 + tx, ay = (pair.a.y + pair.b.y) / 2 + ty, az = (pair.a.z + pair.b.z) / 2 + tz;
        const z = 2 * (qx * qz - qy * qw) * ax + 2 * (qy * qz + qx * qw) * ay + (1 - 2 * (qx * qx + qy * qy)) * az;
        if (Math.abs(z) > depth / 2) continue;
      }
      const a = v.modelToScreen(pair.a), b = v.modelToScreen(pair.b);
      const ax = a.x - box.left - window.scrollX, ay = a.y - box.top - window.scrollY;
      const bx = b.x - box.left - window.scrollX, by = b.y - box.top - window.scrollY;
      const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
      const distance = Math.hypot(x - ax - t * dx, y - ay - t * dy);
      if (distance < nearestDistance) { nearest = pair; nearestDistance = distance; }
    }
    setHoveredInteraction(nearest ? { pair: nearest, x: Math.min(box.width - 240, Math.max(8, x + 12)), y: Math.max(8, y - 78) } : null);
  }
  async function saveImage() {
    if (!viewer.current || !hostElement) return;
    const png = new Image();
    png.src = viewer.current.pngURI();
    await png.decode();
    const canvas = document.createElement('canvas');
    canvas.width = png.width;
    canvas.height = png.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(png, 0, 0);
    const bounds = hostElement.getBoundingClientRect(),
      scale = png.width / bounds.width;
    ctx.save();
    ctx.scale(scale, scale);
    labelLayer.current
      ?.querySelectorAll<HTMLButtonElement>('button:not([hidden])')
      .forEach((button) => {
        const box = button.getBoundingClientRect(),
          x = box.left - bounds.left,
          y = box.top - bounds.top;
        ctx.globalAlpha = 0.8;
        ctx.font = `bold ${Math.max(9, box.height * 0.58)}px sans-serif`;
        ctx.fillStyle = '#294255';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          button.textContent || '',
          x + box.width / 2,
          y + box.height / 2,
        );
      });
    ctx.restore();
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'PocketAtlas_complex.png';
    a.click();
  }
  const mutation = referenceSequence.find((r) => r.key === mutationResidue);
  const mutationConservation = mutation ? conservation(mutation.key) : null;
  const mutationInteractions = mutation
    ? (native?.pairs || []).filter((p) => endpointResidue(p.a) === mutation.key)
    : [];
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="complex-dialog">
        <DialogHeader>
          <DialogTitle>
            {ligand?.title || protein?.title || '结构预览'}
          </DialogTitle>
          <DialogDescription>
            {protein ? `受体 ${protein.atoms.length} 原子` : '未载入受体'} ·{' '}
            {ligand ? `配体原始记录 ${ligand.sourceIndex}` : '独立蛋白预览'} ·
            原始坐标
          </DialogDescription>
        </DialogHeader>
        <div className="complex-toolbar">
          <label>
            预览范围
            <select value={mode} onChange={(e) => setPreset(e.target.value)}>
              <option value="pocket">口袋与蛋白背景</option>
              <option value="pocket-only">仅邻近口袋</option>
              <option value="full">完整复合物 / 蛋白</option>
              <option value="ligand" disabled={!ligand}>
                仅配体
              </option>
            </select>
          </label>
          <label>
            Cartoon
            <select value={style} onChange={(e) => setStyle(e.target.value)}>
              <option value="oval">柔和丝带</option>
              <option value="trace">纤细主链</option>
              <option value="rectangle">经典丝带</option>
            </select>
          </label>
          <button className="btn small" onClick={focus}>
            重置取景
          </button>
          <button
            className="btn small"
            onClick={() =>
              void saveImage().catch(() => setError('图片导出失败，请重试。'))
            }
          >
            保存图片
          </button>
        </div>
        <div className="complex-stage" ref={stage} onPointerMove={hoverInteraction} onPointerUp={hoverInteraction} onPointerLeave={() => setHoveredInteraction(null)} onPointerDown={() => setHoveredInteraction(null)}>
          <div className="complex-canvas" ref={setHostElement} />
          <div className="residue-label-layer" ref={labelLayer} />
          {hoveredInteraction && shown.includes(hoveredInteraction.pair) && (
            <div className="interaction-tooltip" role="tooltip" style={{ left: hoveredInteraction.x, top: hoveredInteraction.y }}>
              <strong>{endpointResidue(hoveredInteraction.pair.a)} · {kinds[hoveredInteraction.pair.type]?.[0] || hoveredInteraction.pair.type}</strong>
              <div>{hoveredInteraction.pair.a.label} → {hoveredInteraction.pair.b.label}</div>
              <div>{hoveredInteraction.pair.distance.toFixed(2)} Å</div>
            </div>
          )}
        </div>
        <p className="micro" role="status">
          {focusedResidue
            ? `已聚焦 ${focusedResidue} · 重置取景可返回配体`
            : '点击口袋原子、残基标签或互作明细中的受体端点可放大定位。'}
        </p>
        {error && <p role="alert">{error}</p>}
        {surfaceBusy && <p role="status">正在生成口袋表面…</p>}
        <div className="complex-toolbar">
          <label>
            邻近半径 Å
            <input
              type="number"
              min={2}
              max={10}
              step={0.5}
              value={cutoff}
              onChange={(e) =>
                setCutoff(
                  Math.max(2, Math.min(10, Number(e.target.value) || 4)),
                )
              }
            />
          </label>
          <label>
            口袋表面
            <select
              value={surface}
              disabled={!protein || !ligand}
              onChange={(e) => setSurface(e.target.value)}
            >
              <option value="none">关闭</option>
              <option value="ms">分子表面</option>
              <option value="sas">溶剂可及表面</option>
            </select>
          </label>
          <label>
            表面不透明度
            <input
              aria-label="表面不透明度"
              type="range"
              min={0.1}
              max={0.8}
              step={0.05}
              value={surfaceOpacity}
              onChange={(e) => setSurfaceOpacity(Number(e.target.value))}
            />
          </label>
          <label>
            蛋白不透明度
            <input
              aria-label="蛋白不透明度"
              type="range"
              min={0.15}
              max={1}
              step={0.05}
              value={proteinOpacity}
              onChange={(e) => setProteinOpacity(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="complex-toolbar">
          <label>
            <input
              type="checkbox"
              checked={residues}
              onChange={(e) => setResidues(e.target.checked)}
            />
            邻近残基棒状
          </label>
          <label>
            <input
              type="checkbox"
              checked={labels}
              onChange={(e) => setLabels(e.target.checked)}
            />
            残基标签
          </label>
          {labels && (
            <span className="micro">
              标签随视角和缩放更新，遵循景深裁切；为方便点选，文字不被表面遮挡
            </span>
          )}
          <label>
            <input
              type="checkbox"
              checked={distanceLabels}
              onChange={(e) => setDistanceLabels(e.target.checked)}
            />
            互作距离 Å
          </label>
          <label>
            投影
            <select
              value={projection}
              onChange={(e) => setProjection(e.target.value)}
            >
              <option value="orthographic">正交</option>
              <option value="perspective">透视</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={clipping}
              onChange={(e) => setClipping(e.target.checked)}
            />
            景深裁切
          </label>
          <label>
            厚度 Å
            <input
              aria-label="景深厚度"
              type="range"
              min={8}
              max={100}
              step={2}
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
            />
            {depth}
          </label>
        </div>
        {protein && ligand && (
          <>
            <p className="micro">
              {neighborhood.near.size} 个邻近残基：
              {!neighborhood.near.size &&
                '无；请检查受体与配体是否处于同一坐标系。'}
            </p>
            <div className="residue-chips">
              {[...neighborhood.near].map((key) => (
                <button
                  key={key}
                  className="btn small"
                  onClick={() => focusResidue(key)}
                >
                  {key}
                </button>
              ))}
            </div>
            <p className="micro">
              邻近半径决定口袋残基与表面范围；互作类型开关控制虚线和明细。原生互作判据独立于邻近半径，因此远于半径的
              π 互作仍会显示。
            </p>
            <div className="complex-toolbar">
              <button
                className="btn small"
                disabled={!connection || !cacheKey || calculating}
                onClick={calculate}
              >
                {calculating
                  ? '本地计算中…'
                  : native
                    ? '重新计算原生互作'
                    : '计算 Schrödinger 互作'}
              </button>
              <span className="micro">
                {!cacheKey
                  ? '连接本地引擎并重新导入受体和配体后可计算。'
                  : native
                    ? '原生接口默认规则 · 结果已缓存'
                    : '按当前受体与配体配对计算'}
              </span>
              <label>
                <input
                  type="checkbox"
                  checked={contacts}
                  onChange={(e) => setContacts(e.target.checked)}
                />
                附加几何近接
              </label>
            </div>
            <details className="analysis-block">
              <summary>
                序列比对与互作保守性 · 已选 {alignmentSelection.length} 个受体
              </summary>
              <p className="micro">
                以当前三维受体为参考；请选择其他受体作比对，参考自身不计入保守性。缺口记为未匹配。当前使用整条结构的全局序列比对；多链结构请导入目标单链，避免跨链匹配。
              </p>
              <div className="protein-choices">
                {proteins.map((item, index) => (
                  <label key={index}>
                    <input
                      type="checkbox"
                      disabled={item === protein}
                      checked={alignmentSelection.includes(index)}
                      onChange={(e) =>
                        setAlignmentSelection((old) =>
                          e.target.checked
                            ? [...new Set([...old, index])]
                            : old.filter((v) => v !== index),
                        )
                      }
                    />
                    {item.title} · {sequenceOf(item).length} aa{' '}
                    {item === protein ? '（当前参考）' : ''}
                  </label>
                ))}
              </div>
              {alignments.map((item) => {
                const same = [...item.result.map.entries()].filter(
                  ([i, aa]) => referenceSequence[i]?.aa === aa,
                ).length;
                return (
                  <div className="alignment-row" key={item.index}>
                    <b>{item.title}</b>
                    <span>
                      {referenceSequence.length
                        ? ((100 * same) / referenceSequence.length).toFixed(1)
                        : '0.0'}
                      % identity
                    </span>
                    <code>{item.result.reference}</code>
                    <code>{item.result.query}</code>
                  </div>
                );
              })}
            </details>
            <details className="analysis-block">
              <summary>单点氨基酸突变分析</summary>
              <div className="complex-toolbar">
                <label>
                  残基
                  <select
                    value={mutationResidue}
                    onChange={(e) => setMutationResidue(e.target.value)}
                  >
                    {residueOptions.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.key} ({r.aa})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  突变为
                  <select
                    value={mutationTo}
                    onChange={(e) => setMutationTo(e.target.value)}
                  >
                    {Object.entries(aaNames).map(([aa, name]) => (
                      <option key={aa} value={aa}>
                        {aa} · {name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="btn small"
                  disabled={!mutation}
                  onClick={() => mutation && focusResidue(mutation.key)}
                >
                  聚焦突变位点
                </button>
              </div>
              {mutation && (
                <div className="mutation-result">
                  <b>
                    {mutation.key}: {mutation.aa} → {mutationTo}
                  </b>
                  <span>
                    性质：{aaClass(mutation.aa)} → {aaClass(mutationTo)}
                  </span>
                  <span>当前直接互作：{mutationInteractions.length} 条</span>
                  <span>
                    比对保守性：
                    {mutationConservation
                      ? `${mutationConservation.same}/${mutationConservation.total}`
                      : '未选择比对受体'}
                  </span>
                  <span>
                    {mutation.aa === mutationTo
                      ? '与野生型相同'
                      : '待验证：检查侧链几何、原有互作及局部构象变化'}
                  </span>
                </div>
              )}
              <p className="micro">
                此处提供野生型位点的性质与互作对照，不生成突变体坐标，也不预测亲和力变化；需另行开展突变体优化或能量计算。互作计数不随显示开关改变。
              </p>
            </details>
            <div className="complex-toolbar">
              {Object.entries(kinds)
                .filter(([key]) => key !== 'contact' || contacts)
                .map(([key, [name, color]]) => (
                  <label key={key} style={{ color }}>
                    <input
                      type="checkbox"
                      checked={enabled.includes(key)}
                      onChange={(e) =>
                        setEnabled((a) =>
                          e.target.checked
                            ? [...a, key]
                            : a.filter((k) => k !== key),
                        )
                      }
                    />
                    {name}{' '}
                    {key === 'contact'
                      ? neighborhood.pairs.length
                      : native
                        ? native.pairs.filter((p) => p.type === key).length
                        : '未计算'}
                  </label>
                ))}
            </div>
            {native?.errors.length ? (
              <p role="alert">部分类型未能计算：{native.errors.join('；')}</p>
            ) : null}
            <p className="micro">
              距离按虚线端点测量；氢键可能显示 H···受体原子距离，π
              互作显示环/电荷中心距离。几何近接仅为 N/O/S 重原子 ≤ 3.5
              Å，不作为氢键。原生接口使用本机默认规则，未声称复现其他工作站的自定义
              LID 设置。
            </p>
            {shown.length > 0 && (
              <details>
                <summary>互作明细 · {shown.length} 条</summary>
                <div className="interaction-table">
                  <table>
                    <thead>
                      <tr>
                        <th>类型</th>
                        <th>受体端点</th>
                        <th>配体端点</th>
                        <th>距离 Å</th>
                        <th>序列保守性</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((p, i) => (
                        <tr key={i}>
                          <td>{kinds[p.type]?.[0]}</td>
                          <td>
                            <button
                              className="link-button"
                              onClick={() => {
                                focusResidue(endpointResidue(p.a));
                              }}
                            >
                              {p.a.label}
                            </button>
                          </td>
                          <td>{p.b.label}</td>
                          <td>
                            {p.distance.toFixed(2)}
                            {p.distanceType === 'centroid' ? '（中心）' : ''}
                          </td>
                          <td>
                            {(() => {
                              const c = conservation(endpointResidue(p.a));
                              return c ? (
                                <span
                                  className={
                                    c.same === c.total
                                      ? 'conserved'
                                      : 'nonconserved'
                                  }
                                >
                                  {c.wt} / {c.observed.join(' / ')} · {c.same}/
                                  {c.total}
                                </span>
                              ) : (
                                '—'
                              );
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        )}
        <div className="complex-toolbar">
          {ligand && (
            <button
              className="btn small"
              onClick={() =>
                download('ligand.sdf', toMolBlock(ligand) + '$$$$\n')
              }
            >
              导出姿态 SDF
            </button>
          )}
          {protein && (
            <button
              className="btn small"
              onClick={() => download('receptor.pdb', toPDB(protein))}
            >
              导出受体 PDB
            </button>
          )}
          {shown.length > 0 && (
            <button
              className="btn small"
              onClick={() =>
                download(
                  'interactions.csv',
                  csv(
                    shown.map((p) => {
                      const c = conservation(endpointResidue(p.a));
                      return {
                        type: p.type,
                        receptor: p.a.label,
                        ligand: p.b.label,
                        distance_A: p.distance,
                        distance_type: p.distanceType,
                        reference_aa: c?.wt || '',
                        aligned_aa: c?.observed.join('/') || '',
                        conserved_count: c?.same ?? '',
                        aligned_protein_count: c?.total ?? '',
                        engine:
                          p.type === 'contact' ? 'geometry' : native?.engine,
                      };
                    }),
                  ),
                )
              }
            >
              导出互作表
            </button>
          )}
          <button
            className="btn small"
            onClick={() => {
              download(
                'PocketAtlas_scene.pml',
                [
                  'python',
                  'from pymol import cmd',
                  protein
                    ? 'cmd.read_pdbstr(' +
                      JSON.stringify(toPDB(protein)) +
                      ', "receptor")'
                    : '',
                  ligand
                    ? 'cmd.read_molstr(' +
                      JSON.stringify(toMolBlock(ligand)) +
                      ', "ligand")'
                    : '',
                  'cmd.hide("everything")',
                  'cmd.show("cartoon", "receptor")',
                  'cmd.color("lightblue", "receptor")',
                  'cmd.set("cartoon_smooth_loops", 1)',
                  'cmd.set("cartoon_sampling", 14)',
                  'cmd.set("cartoon_transparency", 0.3)',
                  ligand ? 'cmd.show("sticks", "ligand")' : '',
                  'cmd.bg_color("white")',
                  ligand ? 'cmd.zoom("ligand", 6)' : 'cmd.zoom()',
                  'python end',
                ].join('\n'),
              );
            }}
          >
            导出 PyMOL 场景
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { Atom } from 'lucide-react';
import Image from 'next/image';
import type { RDKitModule, JSMol } from '@rdkit/rdkit';
let rdkitPromise: Promise<RDKitModule> | null = null;
export function getRDKit() {
  if (!rdkitPromise)
    rdkitPromise = new Promise((resolve, reject) => {
      const init = () => {
        window
          .initRDKitModule({ locateFile: () => '/rdkit/RDKit_minimal.wasm' })
          .then(resolve, reject);
      };
      if (typeof window.initRDKitModule === 'function') init();
      else {
        const s = document.createElement('script');
        s.src = '/rdkit/RDKit_minimal.js';
        s.onload = init;
        s.onerror = () => reject(Error('结构绘图引擎加载失败'));
        document.head.appendChild(s);
      }
    });
  return rdkitPromise;
}
export function Molecule({
  smiles,
  small = false,
}: {
  smiles: string;
  small?: boolean;
}) {
  const [drawing, setDrawing] = useState({
    smiles: '',
    small: false,
    svg: '',
    error: false,
  });
  const matches = drawing.smiles === smiles && drawing.small === small;
  const svg = matches ? drawing.svg : '';
  const error = matches && drawing.error;
  useEffect(() => {
    let alive = true;
    getRDKit()
      .then((R) => {
        let m: JSMol | null = null;
        try {
          m = R.get_mol(smiles);
          if (!m) throw Error();
          const output = m.get_svg(small ? 150 : 360, small ? 80 : 225);
          if (alive) setDrawing({ smiles, small, svg: output, error: false });
        } catch {
          if (alive) setDrawing({ smiles, small, svg: '', error: true });
        } finally {
          m?.delete();
        }
      })
      .catch(() => {
        if (alive) setDrawing({ smiles, small, svg: '', error: true });
      });
    return () => {
      alive = false;
    };
  }, [smiles, small]);
  return (
    <div className={'molecule ' + (small ? 'mini' : '')}>
      {svg ? (
        <Image
          unoptimized
          width={small ? 150 : 360}
          height={small ? 80 : 225}
          src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)}
          alt={'分子结构 ' + smiles}
        />
      ) : (
        <span>{error ? '结构绘图失败' : <Atom size={small ? 20 : 32} />}</span>
      )}
    </div>
  );
}
export const palette = [
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
export const color = (cluster: number) =>
  palette[(cluster - 1) % palette.length];
export { Scatter } from './scatter-view';

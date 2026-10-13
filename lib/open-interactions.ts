import type { Structure, StructureAtom } from './structures';
import type {
  Interaction,
  InteractionPoint,
  InteractionResult,
} from './local-engine';

type Vector = { x: number; y: number; z: number };
const distance = (a: Vector, b: Vector) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const sub = (a: Vector, b: Vector) => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
const dot = (a: Vector, b: Vector) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (a: Vector) => Math.hypot(a.x, a.y, a.z);
const cross = (a: Vector, b: Vector) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
function angle(a: Vector, b: Vector, c: Vector) {
  const u = sub(a, b),
    v = sub(c, b);
  return (
    (Math.acos(
      Math.max(-1, Math.min(1, dot(u, v) / (length(u) * length(v) || 1))),
    ) *
      180) /
    Math.PI
  );
}
function point(
  s: Structure,
  indices: number[],
  side: string,
): InteractionPoint {
  const atoms = indices.map((i) => s.atoms[i]),
    n = atoms.length;
  return {
    x: atoms.reduce((v, a) => v + a.x, 0) / n,
    y: atoms.reduce((v, a) => v + a.y, 0) / n,
    z: atoms.reduce((v, a) => v + a.z, 0) / n,
    side,
    atomIndices: indices.map((i) => i + 1),
    label:
      side === 'receptor'
        ? `${atoms[0].chain || '_'}:${atoms[0].resn.toUpperCase()}${atoms[0].resi}${atoms[0].icode || ''}:${atoms.map((a) => a.atom).join('/')}`
        : `LIG:${atoms.map((a) => a.atom).join('/')}`,
  };
}
function graph(s: Structure) {
  const g = s.atoms.map(
    (a) => new Set(a.bonds.filter((i) => i >= 0 && i < s.atoms.length)),
  );
  // PDB often lacks CONECT. Infer only local covalent neighbors within a residue.
  const radii: Record<string, number> = {
    H: 0.31,
    C: 0.76,
    N: 0.71,
    O: 0.66,
    S: 1.05,
    F: 0.57,
    Cl: 1.02,
    Br: 1.2,
    I: 1.39,
  };
  const groups = new Map<string, number[]>();
  s.atoms.forEach((a, i) => {
    const k = `${a.chain}:${a.resn}:${a.resi}:${a.icode || ''}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(i);
  });
  for (const ids of groups.values())
    if (ids.length < 200)
      for (let i = 0; i < ids.length; i++)
        for (let j = 0; j < i; j++) {
          const a = s.atoms[ids[i]],
            b = s.atoms[ids[j]],
            d = distance(a, b);
          if (
            !a.bonds.length &&
            !b.bonds.length &&
            d > 0.35 &&
            d < (radii[a.elem] || 0.8) + (radii[b.elem] || 0.8) + 0.35
          ) {
            g[ids[i]].add(ids[j]);
            g[ids[j]].add(ids[i]);
          }
        }
  return g;
}
function roles(s: Structure, g: Set<number>[]) {
  return s.atoms.map((a, i) => {
    const neighbors = [...g[i]].map((j) => s.atoms[j]);
    const hydrogens = [...g[i]].filter((j) => s.atoms[j].elem === 'H');
    const charge = a.charge || 0;
    const protein = s.protein,
      res = a.resn.toUpperCase(),
      name = a.atom.toUpperCase();
    const amideN =
      a.elem === 'N' &&
      [...g[i]].some(
        (j) =>
          s.atoms[j].elem === 'C' &&
          s.atoms[j].bonds.some(
            (k, b) => s.atoms[k]?.elem === 'O' && s.atoms[j].bondOrder[b] === 2,
          ),
      );
    const proteinNonAcceptor =
      protein &&
      a.elem === 'N' &&
      (name === 'N' ||
        res === 'ARG' ||
        res === 'LYS' ||
        res === 'TRP' ||
        (res === 'ASN' && name === 'ND2') ||
        (res === 'GLN' && name === 'NE2'));
    const acceptor =
      ['N', 'O', 'S'].includes(a.elem) &&
      charge <= 0 &&
      !amideN &&
      !proteinNonAcceptor &&
      !(a.elem === 'N' && neighbors.length >= 4) &&
      !(
        a.elem === 'N' &&
        hydrogens.length &&
        a.bondOrder.some((o) => o === 1.5)
      );
    // Missing H is treated as a donor candidate, not a confirmed hydrogen bond.
    const bondValence = a.bondOrder.reduce((sum, order) => sum + order, 0);
    const proteinHydroxyl =
      protein &&
      ((res === 'SER' && name === 'OG') ||
        (res === 'THR' && name === 'OG1') ||
        (res === 'TYR' && name === 'OH') ||
        (res === 'CYS' && name === 'SG') ||
        res === 'HOH');
    const donor =
      ['N', 'O', 'S'].includes(a.elem) &&
      charge >= 0 &&
      (hydrogens.length > 0 ||
        (a.elem === 'N' &&
          neighbors.length < 3 &&
          bondValence < 3 &&
          !(protein && res === 'PRO' && name === 'N')) ||
        (['O', 'S'].includes(a.elem) &&
          (protein
            ? proteinHydroxyl
            : neighbors.length <= 1 && bondValence < 2)));
    const ionic =
      charge > 0
        ? 1
        : charge < 0
          ? -1
          : protein &&
              ((res === 'ARG' && ['NE', 'NH1', 'NH2'].includes(name)) ||
                (res === 'LYS' && name === 'NZ'))
            ? 1
            : protein &&
                ((res === 'ASP' && ['OD1', 'OD2'].includes(name)) ||
                  (res === 'GLU' && ['OE1', 'OE2'].includes(name)))
              ? -1
              : 0;
    return { acceptor, donor, hydrogens, ionic };
  });
}
type Ring = { ids: number[]; center: InteractionPoint; normal: Vector };
function rings(s: Structure, g: Set<number>[], side: string): Ring[] {
  const cycles = new Map<string, number[]>();
  const patterns: Record<string, string[][]> = {
    PHE: [['CG', 'CD1', 'CE1', 'CZ', 'CE2', 'CD2']],
    TYR: [['CG', 'CD1', 'CE1', 'CZ', 'CE2', 'CD2']],
    HIS: [['CG', 'ND1', 'CE1', 'NE2', 'CD2']],
    TRP: [
      ['CG', 'CD1', 'NE1', 'CE2', 'CD2'],
      ['CD2', 'CE2', 'CZ2', 'CH2', 'CZ3', 'CE3'],
    ],
  };
  if (s.protein) {
    const groups = new Map<string, number[]>();
    s.atoms.forEach((a, i) => {
      const k = `${a.chain}:${a.resi}:${a.icode || ''}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(i);
    });
    for (const ids of groups.values())
      for (const names of patterns[s.atoms[ids[0]].resn.toUpperCase()] || []) {
        const ring = names.map((name) =>
          ids.find((i) => s.atoms[i].atom === name),
        );
        if (ring.every((i) => i !== undefined)) {
          const r = ring as number[];
          cycles.set([...r].sort((a, b) => a - b).join(','), r);
        }
      }
  } else {
    const walk = (start: number, path: number[]) => {
      const last = path[path.length - 1];
      for (const next of g[last]) {
        if (next === start && path.length >= 5 && path.length <= 6) {
          const key = [...path].sort((a, b) => a - b).join(',');
          cycles.set(key, [...path]);
        } else if (
          path.length < 6 &&
          next > start &&
          !path.includes(next) &&
          ['C', 'N', 'O', 'S'].includes(s.atoms[next].elem)
        )
          walk(start, [...path, next]);
      }
    };
    for (let i = 0; i < s.atoms.length; i++)
      if (['C', 'N', 'O', 'S'].includes(s.atoms[i].elem)) walk(i, [i]);
  }
  const out: Ring[] = [];
  for (const ids of cycles.values()) {
    const center = point(s, ids, side),
      normal = cross(
        sub(s.atoms[ids[1]], s.atoms[ids[0]]),
        sub(s.atoms[ids[2]], s.atoms[ids[0]]),
      ),
      len = length(normal);
    if (len < 0.1) continue;
    normal.x /= len;
    normal.y /= len;
    normal.z /= len;
    const planar = ids.every(
      (i) => Math.abs(dot(sub(s.atoms[i], center), normal)) <= 0.15,
    );
    const unsaturated =
      s.protein ||
      ids.every((i) =>
        s.atoms[i].bonds.some(
          (j, k) => ids.includes(j) && s.atoms[i].bondOrder[k] >= 1.5,
        ),
      );
    if (planar && unsaturated) out.push({ ids, center, normal });
  }
  return out;
}
function prepare(s: Structure, side: string) {
  const g = graph(s);
  return { g, roles: roles(s, g), rings: rings(s, g, side) };
}
const receptorCache = new WeakMap<Structure, ReturnType<typeof prepare>>();
export function calculateOpenInteractions(
  protein: Structure,
  ligand: Structure,
): InteractionResult {
  if (!protein.atoms.length || !ligand.atoms.length)
    throw Error('缺少受体或配体坐标');
  if (
    [...protein.atoms, ...ligand.atoms].some(
      (a) => ![a.x, a.y, a.z].every(Number.isFinite),
    )
  )
    throw Error('结构包含无效原子坐标');
  let rp = receptorCache.get(protein);
  if (!rp) {
    rp = prepare(protein, 'receptor');
    receptorCache.set(protein, rp);
  }
  const lp = prepare(ligand, 'ligand');
  const pairs: Interaction[] = [],
    seen = new Set<string>();
  const add = (
    type: string,
    a: InteractionPoint,
    b: InteractionPoint,
    criteria: string,
    angleValue?: number,
  ) => {
    const key =
      type + ':' + a.atomIndices.join(',') + ':' + b.atomIndices.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({
      type,
      a,
      b,
      distance: distance(a, b),
      distanceType: criteria,
      angle: angleValue,
    });
  };
  const xmin = Math.min(...ligand.atoms.map((a) => a.x)) - 7,
    xmax = Math.max(...ligand.atoms.map((a) => a.x)) + 7,
    ymin = Math.min(...ligand.atoms.map((a) => a.y)) - 7,
    ymax = Math.max(...ligand.atoms.map((a) => a.y)) + 7,
    zmin = Math.min(...ligand.atoms.map((a) => a.z)) - 7,
    zmax = Math.max(...ligand.atoms.map((a) => a.z)) + 7;
  for (let i = 0; i < protein.atoms.length; i++) {
    const a = protein.atoms[i],
      ar = rp.roles[i];
    if (
      a.elem === 'H' ||
      a.x < xmin ||
      a.x > xmax ||
      a.y < ymin ||
      a.y > ymax ||
      a.z < zmin ||
      a.z > zmax
    )
      continue;
    for (let j = 0; j < ligand.atoms.length; j++) {
      const b = ligand.atoms[j],
        br = lp.roles[j];
      if (b.elem === 'H') continue;
      const d = distance(a, b);
      if (d > 6.5 || d < 0.5) continue;
      const pa = point(protein, [i], 'receptor'),
        pb = point(ligand, [j], 'ligand');
      if (ar.ionic * br.ionic < 0 && d <= 4)
        add('salt', pa, pb, 'Open geometry: ionic heavy-atom distance ≤ 4.0 Å');
      if (d <= 3.5)
        for (const [donor, acceptor, dr, as, ds] of [
          [a, b, ar, br, protein],
          [b, a, br, ar, ligand],
        ] as [
          StructureAtom,
          StructureAtom,
          typeof ar,
          typeof ar,
          Structure,
        ][]) {
          if (!dr.donor || !as.acceptor) continue;
          const confirmed = dr.hydrogens
            .map((h) => ({
              h: ds.atoms[h],
              angle: angle(donor, ds.atoms[h], acceptor),
            }))
            .find((h) => distance(h.h, acceptor) <= 2.6 && h.angle >= 120);
          if (confirmed)
            add(
              'hbond',
              pa,
              pb,
              'Open geometry: D–A ≤ 3.5 Å; H–A ≤ 2.6 Å; D–H–A ≥ 120°',
              confirmed.angle,
            );
          else if (!dr.hydrogens.length)
            add(
              'hbond_candidate',
              pa,
              pb,
              'Open geometry: D–A ≤ 3.5 Å; donor H/angle unavailable, unconfirmed',
            );
        }
      for (const [halogen, acceptor, index, g, s, acceptorRole] of [
        [b, a, j, lp.g, ligand, ar],
        [a, b, i, rp.g, protein, br],
      ] as [
        StructureAtom,
        StructureAtom,
        number,
        Set<number>[],
        Structure,
        typeof ar,
      ][]) {
        const limit: Record<string, number> = { Cl: 3.5, Br: 3.7, I: 4 };
        if (
          !limit[halogen.elem] ||
          !acceptorRole.acceptor ||
          d > limit[halogen.elem]
        )
          continue;
        const carbon = [...g[index]].find((k) => s.atoms[k].elem === 'C');
        if (carbon === undefined) continue;
        const value = angle(s.atoms[carbon], halogen, acceptor);
        if (value >= 150)
          add(
            'halogen',
            pa,
            pb,
            'Open geometry: C–X–A ≥ 150°; Cl/Br/I–A ≤ 3.5/3.7/4.0 Å',
            value,
          );
      }
    }
  }
  for (const a of rp.rings)
    for (const b of lp.rings) {
      const d = distance(a.center, b.center),
        normalAngle =
          (Math.acos(Math.min(1, Math.abs(dot(a.normal, b.normal)))) * 180) /
          Math.PI,
        v = sub(b.center, a.center),
        offset = Math.sqrt(Math.max(0, d * d - dot(v, a.normal) ** 2));
      if (
        (d <= 5.5 && normalAngle <= 30 && offset <= 2.0) ||
        (d <= 5.0 && normalAngle >= 60)
      )
        add(
          'pipi',
          a.center,
          b.center,
          'Open geometry: ring centers ≤ 5.5 Å, normals ≤ 30°, offset ≤ 2 Å; or centers ≤ 5 Å, normals ≥ 60°',
          normalAngle,
        );
    }
  for (const [ringSet, s, rs, side] of [
    [rp.rings, ligand, lp.roles, 'ligand'],
    [lp.rings, protein, rp.roles, 'receptor'],
  ] as [Ring[], Structure, typeof lp.roles, string][])
    for (const ring of ringSet)
      for (let i = 0; i < s.atoms.length; i++)
        if (rs[i].ionic > 0) {
          const c = point(s, [i], side),
            v = sub(c, ring.center),
            d = length(v),
            deviation =
              (Math.acos(
                Math.min(1, Math.abs(dot(v, ring.normal)) / (d || 1)),
              ) *
                180) /
              Math.PI;
          if (d <= 6 && deviation <= 30)
            add(
              'pication',
              side === 'ligand' ? ring.center : c,
              side === 'ligand' ? c : ring.center,
              'Open geometry: cation–ring center ≤ 6 Å; normal deviation ≤ 30°',
              deviation,
            );
        }
  const errors: string[] = [];
  if (pairs.some((p) => p.type === 'hbond_candidate'))
    errors.push(
      'hbond: 缺少显式供体氢，部分氢键仅为距离候选，不能确认或据此排除',
    );
  if (!ligand.atoms.some((a) => a.charge))
    errors.push('salt: 配体未提供形式电荷，盐桥与阳离子相关负结果未确定');
  if (
    ligand.atoms.filter((a) => a.elem !== 'H').length >= 5 &&
    !ligand.atoms.some((a) => a.bonds.length)
  )
    errors.push('pipi: 配体未提供键拓扑，芳香环判定不完整');
  if (!ligand.atoms.some((a) => a.charge))
    errors.push('pication: 配体未提供形式电荷，阳离子相关负结果未确定');
  return {
    engine: 'Pocket Atlas Open Geometry 1.0',
    criteria:
      'Coordinate-based, open-source geometry rules; no protonation, energy minimization, or Schrodinger calls. Approximate chemical typing; hydrogen-bond candidates are not confirmed interactions.',
    pairs,
    errors,
    receptorId: protein.nativeId || protein.title,
    ligandId: ligand.nativeId || ligand.title,
    hydrogens: {
      receptor: protein.atoms.filter((a) => a.elem === 'H').length,
      ligand: ligand.atoms.filter((a) => a.elem === 'H').length,
    },
  };
}

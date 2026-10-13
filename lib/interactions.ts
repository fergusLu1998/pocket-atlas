import type { Structure, StructureAtom } from './structures';
import type { InteractionResult, Interaction } from './local-engine';
import { structureIdentity } from './structure-id';

export const interactionKinds: Record<string, [string, string]> = {
  hbond: ['氢键', '#1783bd'],
  hbond_candidate: ['氢键候选（缺氢）', '#8bb7cc'],
  halogen: ['卤键', '#9861c7'],
  salt: ['盐桥', '#e35959'],
  pipi: ['π–π', '#d49422'],
  pication: ['π–阳离子', '#299c78'],
  contact: ['几何近接', '#7b8fa0'],
};
export const residueKey = (
  a: Pick<StructureAtom, 'chain' | 'resn' | 'resi'> & { icode?: string },
) =>
  `${a.chain || '_'}:${a.resn.toUpperCase()}${a.resi}${a.icode?.trim() || ''}`;
export function endpointResidue(p: Interaction['a']) {
  return p.label.split(':').slice(0, 2).join(':');
}
export function interactionKey(
  protein: Structure | null | undefined,
  ligand: Structure | null | undefined,
  method: 'native' | 'open' = 'native',
) {
  return protein && ligand
    ? structureIdentity(protein) +
        '|' +
        structureIdentity(ligand) +
        (method === 'open' ? '|open-v1' : '')
    : '';
}
export type InteractionState = 'yes' | 'no' | 'unknown';
export function residueInteractionState(
  result: InteractionResult | undefined,
  residues: string[],
  kind = 'all',
  match = 'any',
): InteractionState {
  if (!result) return 'unknown';
  const pairs = result.pairs.filter(
    (p) =>
      !['contact', 'hbond_candidate'].includes(p.type) &&
      (kind === 'all' || p.type === kind),
  );
  const hits = residues.map((residue) =>
    pairs.some((p) => endpointResidue(p.a) === residue),
  );
  if (
    residues.length &&
    (match === 'all' ? hits.every(Boolean) : hits.some(Boolean))
  )
    return 'yes';
  // A failed type is unknown, never evidence of a negative interaction.
  if (result.errors.some((e) => kind === 'all' || e.startsWith(kind + ':')))
    return 'unknown';
  return 'no';
}

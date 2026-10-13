import { calculateOpenInteractions } from './open-interactions';
import type { Structure } from './structures';
let receptor: Structure | null = null;
self.onmessage = (
  event: MessageEvent<{ id: number; protein?: Structure; ligand: Structure }>,
) => {
  const { id, protein, ligand } = event.data;
  if (protein) receptor = protein;
  try {
    if (!receptor) throw Error('开源计算线程未收到受体');
    self.postMessage({
      id,
      result: calculateOpenInteractions(receptor, ligand),
    });
  } catch (error) {
    self.postMessage({ id, error: (error as Error).message });
  }
};

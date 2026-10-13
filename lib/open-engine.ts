import type { Structure } from './structures';
import type { InteractionResult } from './local-engine';
import { structureIdentity } from './structure-id';
let worker: Worker | null = null,
  lastProtein = '',
  sequence = 0;
const pending = new Map<
  number,
  {
    resolve: (value: InteractionResult) => void;
    reject: (error: Error) => void;
  }
>();
export function calculateInBrowser(protein: Structure, ligand: Structure) {
  if (!worker) {
    worker = new Worker(
      new URL('./open-interactions-worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (
      e: MessageEvent<{
        id: number;
        result: InteractionResult;
        error?: string;
      }>,
    ) => {
      const p = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (e.data.error) p?.reject(Error(e.data.error));
      else p?.resolve(e.data.result);
    };
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(Error('开源互作计算线程失败'));
      pending.clear();
      worker?.terminate();
      worker = null;
      lastProtein = '';
    };
  }
  const id = ++sequence,
    key = structureIdentity(protein),
    sendProtein = key !== lastProtein;
  lastProtein = key;
  return new Promise<InteractionResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({
      id,
      protein: sendProtein ? protein : undefined,
      ligand,
    });
  });
}

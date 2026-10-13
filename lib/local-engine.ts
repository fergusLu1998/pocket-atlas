import type { Structure } from './structures';
import { calculateInBrowser } from './open-engine';
export type EngineConnection = { url: string; token: string };
export async function discoverLocalEngine(
  port = 8765,
): Promise<EngineConnection> {
  const response = await fetch(`http://127.0.0.1:${port}/handshake`, {
    signal: AbortSignal.timeout(1800),
  });
  const data: any = await response.json();
  if (
    !response.ok ||
    data.format !== 'pocket-atlas-connection-v1' ||
    typeof data.token !== 'string'
  )
    throw Error('未检测到本机 Schrödinger');
  return { url: data.url, token: data.token };
}
export type InteractionPoint = {
  x: number;
  y: number;
  z: number;
  label: string;
  side: string;
  atomIndices: number[];
};
export type Interaction = {
  type: string;
  a: InteractionPoint;
  b: InteractionPoint;
  distance: number;
  distanceType: string;
  angle?: number;
};
export type InteractionResult = {
  engine: string;
  criteria: string;
  pairs: Interaction[];
  errors: string[];
  receptorId: string;
  ligandId: string;
  hydrogens?: { receptor: number; ligand: number };
  reconstruction?: string;
};
const restored = new Map<string, Promise<void>>();
async function ensureStructure(connection: EngineConnection, s: Structure) {
  if (!s.nativeId) throw Error('此结构缺少原生编号，请重新导入结构文件。');
  const key = connection.token + '|' + s.nativeId;
  let pending = restored.get(key);
  if (!pending) {
    pending = engineRequest(
      connection,
      '/restore',
      JSON.stringify({
        id: s.nativeId,
        title: s.title,
        atoms: s.atoms,
        protein: s.protein,
      }),
      { 'Content-Type': 'application/json' },
    ).then(() => undefined);
    restored.set(key, pending);
    pending.catch(() => restored.delete(key));
  }
  return pending;
}
export async function calculateInteractions(
  connection: EngineConnection | null,
  protein: Structure,
  ligand: Structure,
): Promise<InteractionResult> {
  if (!connection) return calculateInBrowser(protein, ligand);
  await ensureStructure(connection, protein);
  await ensureStructure(connection, ligand);
  return engineRequest(
    connection,
    '/interactions',
    JSON.stringify({ receptor: protein.nativeId, ligand: ligand.nativeId }),
    { 'Content-Type': 'application/json' },
  );
}
export async function engineRequest(
  connection: EngineConnection,
  path: string,
  body?: BodyInit,
  headers?: Record<string, string>,
) {
  const url = new URL(connection.url);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw Error('本地引擎必须是本机 localhost 地址');
  let response: Response;
  try {
    response = await fetch(url.origin + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + connection.token, ...headers },
      body,
      signal: AbortSignal.timeout(180000),
    });
  } catch {
    throw Error(
      '无法连接本机 Schrödinger。请运行 Pocket Atlas 启动器，页面会自动重连；如浏览器询问，请允许访问本地网络。',
    );
  }
  const data: any = await response.json();
  if (!response.ok) throw Error(data.error || '本地分析失败');
  return data;
}

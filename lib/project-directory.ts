/* oxlint-disable no-control-regex -- Control characters are intentionally removed from exported filenames. */
export type ProjectDirectory = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  values(): AsyncIterableIterator<
    FileSystemFileHandle | FileSystemDirectoryHandle
  >;
};
export type ProjectDocument = {
  format: string;
  name: string;
  raw: string;
  mapping: { smiles: string };
  selected: string[];
  [key: string]: unknown;
};
export function validateProjectDocument(
  value: unknown,
): asserts value is ProjectDocument {
  const p = value as ProjectDocument;
  if (
    !p ||
    p.format !== 'pocket-atlas-project-v1' ||
    typeof p.name !== 'string' ||
    typeof p.raw !== 'string' ||
    !p.mapping ||
    typeof p.mapping.smiles !== 'string' ||
    !Array.isArray(p.selected) ||
    !Array.isArray(p.excluded) ||
    !p.notes ||
    !Number.isFinite(p.threshold) ||
    Number(p.threshold) < 0.1 ||
    Number(p.threshold) > 1
  )
    throw Error('不是有效的 Pocket Atlas 项目');
}
export type DirectoryEntry = {
  id: string;
  name: string;
  savedAt: string;
  moleculeCount: number;
  selectedCount: number;
  payload: Record<string, unknown>;
  fileName: string;
};
type Binding = { handle: FileSystemFileHandle; stamp: string };
let directory: ProjectDirectory | null = null;
const bindings = new Map<string, Binding>();
const stamp = (f: File) => `${f.lastModified}:${f.size}`;
export function directoryName() {
  return directory?.name || '';
}
async function settings(write?: ProjectDirectory) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('maestro-illustrator-settings', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('settings');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return new Promise<ProjectDirectory | undefined>((resolve, reject) => {
    const tx = db.transaction('settings', write ? 'readwrite' : 'readonly');
    const r = write
      ? tx.objectStore('settings').put(write, 'project-directory')
      : tx.objectStore('settings').get('project-directory');
    tx.oncomplete = () => {
      db.close();
      resolve(write || r.result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function restoreDirectory() {
  directory = (await settings()) || null;
  bindings.clear();
  return directoryName();
}
export async function chooseDirectory() {
  const picker = (
    window as Window & {
      showDirectoryPicker?: (options: object) => Promise<ProjectDirectory>;
    }
  ).showDirectoryPicker;
  if (!picker)
    throw Error(
      '此浏览器不支持项目文件夹访问，请使用桌面 Chrome 或 Edge 打开工作台；仍可通过打开/下载项目 JSON 迁移。',
    );
  const next = await picker.call(window, {
    id: 'maestro-illustrator-projects',
    mode: 'readwrite',
  });
  await settings(next);
  directory = next;
  bindings.clear();
  return next.name;
}
export async function directoryPermission(request = false) {
  if (!directory) return false;
  const opts = { mode: 'readwrite' as const };
  return (
    (request
      ? await directory.requestPermission(opts)
      : await directory.queryPermission(opts)) === 'granted'
  );
}
export async function scanProjects(target: ProjectDirectory = directory!) {
  if (!target)
    return { entries: [] as DirectoryEntry[], warnings: [] as string[] };
  if ((await target.queryPermission({ mode: 'readwrite' })) !== 'granted')
    throw Error('项目目录需要重新授权，请点击“授权并检索”。');
  const entries: DirectoryEntry[] = [],
    warnings: string[] = [];
  const nextBindings = new Map<string, Binding>();
  for await (const handle of target.values()) {
    if (handle.kind !== 'file' || !handle.name.toLowerCase().endsWith('.json'))
      continue;
    try {
      const file = await (handle as FileSystemFileHandle).getFile();
      if (file.size > 600 * 1024 * 1024) throw Error('超过 600 MB');
      const payload = JSON.parse(await file.text());
      validateProjectDocument(payload);
      const id = 'file:' + handle.name;
      nextBindings.set(id, {
        handle: handle as FileSystemFileHandle,
        stamp: bindings.get(id)?.stamp || stamp(file),
      });
      entries.push({
        id,
        name: payload.name,
        savedAt:
          typeof payload.savedAt === 'string'
            ? payload.savedAt
            : new Date(file.lastModified).toISOString(),
        moleculeCount: Number(payload.moleculeCount || 0),
        selectedCount: payload.selected.length,
        payload: { projectNotes: payload.projectNotes || '' },
        fileName: handle.name,
      });
    } catch (e) {
      warnings.push(handle.name + '：' + (e as Error).message);
    }
  }
  if (target === directory) {
    bindings.clear();
    for (const [key, binding] of nextBindings) bindings.set(key, binding);
  }
  return {
    entries: entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
    warnings,
  };
}
export async function readDirectoryProject(id: string) {
  const binding = bindings.get(id);
  if (!binding) return undefined;
  const file = await binding.handle.getFile();
  const payload = JSON.parse(await file.text());
  validateProjectDocument(payload);
  binding.stamp = stamp(file);
  return {
    id,
    name: payload.name,
    savedAt: typeof payload.savedAt === 'string' ? payload.savedAt : '',
    moleculeCount: Number(payload.moleculeCount || 0),
    selectedCount: payload.selected.length,
    payload,
  };
}
export async function writeProjectFile(
  handle: FileSystemFileHandle,
  payload: Record<string, unknown>,
  expectedStamp?: string,
) {
  if (expectedStamp && stamp(await handle.getFile()) !== expectedStamp)
    throw Error(
      '项目文件已被其他窗口或程序修改。请先下载当前项目备份，再重新打开磁盘文件，避免覆盖他人修改。',
    );
  const stream = await handle.createWritable();
  try {
    await stream.write(JSON.stringify(payload));
    await stream.close();
  } catch (e) {
    try {
      await stream.abort();
    } catch {}
    throw e;
  }
  return stamp(await handle.getFile());
}
export async function writeDirectoryProject(
  id: string,
  payload: Record<string, unknown>,
) {
  if (!directory) return id;
  if (!(await directoryPermission()))
    throw Error('项目目录没有写入授权，请点击“授权并检索”。');
  let binding = bindings.get(id);
  if (!binding) {
    if (id.startsWith('file:'))
      throw Error(
        '原项目文件未找到，请重新检索目录并打开项目，或下载当前备份。',
      );
    const title =
      (typeof payload.name === 'string' ? payload.name : 'Project')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/[. ]+$/g, '')
        .slice(0, 80) || 'Project';
    const name = 'PocketAtlas_' + title + '_' + crypto.randomUUID() + '.json';
    const handle = await directory.getFileHandle(name, { create: true });
    id = 'file:' + name;
    binding = { handle, stamp: '' };
  }
  binding.stamp = await writeProjectFile(
    binding.handle,
    payload,
    binding.stamp || undefined,
  );
  bindings.set(id, binding);
  return id;
}

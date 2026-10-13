import Papa from 'papaparse';
export type InputRow = {
  key: string;
  id: string;
  smiles: string;
  docking: number | null;
  mmgbsa: number | null;
  supplier: string;
  catalog: string;
  sourceRow: number;
  raw: Record<string, string>;
};
export type Mol = InputRow & {
  canonical: string;
  scaffold?: string;
  fp: Uint32Array;
  bits: number;
  mw: number;
  logp: number;
  tpsa: number;
  hbd: number;
  hba: number;
  rot: number;
  unspecifiedStereo: number;
  multi: boolean;
  duplicateOf: string | null;
  cluster: number;
  center: boolean;
  centerSimilarity: number;
  x: number;
  y: number;
  z?: number;
};
export type Cluster = {
  id: number;
  center: number;
  size: number;
  members: number[];
};
export function compareLogP(
  a: Pick<Mol, 'logp' | 'sourceRow'>,
  b: Pick<Mol, 'logp' | 'sourceRow'>,
  direction: 'asc' | 'desc',
) {
  const aValid = typeof a.logp === 'number' && Number.isFinite(a.logp);
  const bValid = typeof b.logp === 'number' && Number.isFinite(b.logp);
  if (aValid !== bValid) return aValid ? -1 : 1;
  const difference = aValid && bValid ? a.logp - b.logp : 0;
  return (
    (direction === 'desc' ? -difference : difference) || a.sourceRow - b.sourceRow
  );
}
export type Issue = { row: number; id: string; smiles: string; reason: string };
export type Mapping = {
  id: string;
  smiles: string;
  docking: string;
  mmgbsa: string;
  supplier: string;
  catalog: string;
};
export type Parsed = { headers: string[]; rows: string[][]; mapping: Mapping };
const clean = (s: string) => s.toLowerCase().replace(/[\s_\-/().]/g, '');
const aliases: Record<keyof Mapping, string[]> = {
  smiles: ['smiles', 'smile', 'canonicalsmiles', 'isomericsmiles', '结构'],
  id: [
    'id',
    'compoundid',
    'compound',
    'name',
    'title',
    'molecule',
    '分子id',
    '化合物id',
    '化合物编号',
  ],
  docking: [
    'docking',
    'dockingscore',
    'glidescore',
    'glidegscore',
    'rpdockingscore',
    'score',
  ],
  mmgbsa: ['mmgbsa', 'mmgbsadgbind', 'dgbind', 'mmgbsascore'],
  supplier: ['supplier', 'vendor', '供应商'],
  catalog: ['catalog', 'catalogid', 'catalogue', '货号', 'vendorid'],
};
export function parseInput(text: string): Parsed {
  const value = text.replace(/^\uFEFF/, '').trim();
  if (!value) throw Error('请粘贴 SMILES 或选择数据文件。');
  const first = value.split(/\r?\n/)[0];
  const delimiter = first.includes('\t')
    ? '\t'
    : first.includes(',')
      ? ','
      : first.includes(';')
        ? ';'
        : null;
  let rows: string[][];
  if (delimiter) {
    const parsed = Papa.parse<string[]>(value, {
      delimiter,
      skipEmptyLines: 'greedy',
    });
    if (parsed.errors.length)
      throw Error('表格解析失败：' + parsed.errors[0].message);
    rows = parsed.data.map((r) => r.map((v) => v.trim()));
  } else
    rows = value
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith('#'))
      .map((l) => {
        const parts = l.trim().split(/\s+/);
        return parts.length > 1
          ? [parts[0], parts.slice(1).join(' ')]
          : [parts[0]];
      });
  const hasHeader =
    rows[0].some((v) => aliases.smiles.includes(clean(v))) ||
    rows[0].some((v) =>
      ['id', 'compoundid', 'dockingscore', 'mmgbsa'].includes(clean(v)),
    );
  const headers = hasHeader
    ? rows.shift()!
    : rows[0].length === 1
      ? ['smiles']
      : !delimiter
        ? ['smiles', 'id']
        : rows[0].map((_, i) => '列 ' + (i + 1));
  if (new Set(headers).size !== headers.length)
    throw Error('表头含重复列名，请先使各列名唯一。');
  if (rows.length > 5000)
    throw Error('单次最多分析 5000 行，请分批导入。');
  const mapping = {} as Mapping;
  for (const key of Object.keys(aliases) as (keyof Mapping)[])
    mapping[key] = headers.find((h) => aliases[key].includes(clean(h))) || '';
  if (!mapping.smiles && headers.length === 1) mapping.smiles = headers[0];
  return { headers, rows, mapping };
}
export function makeRecords(parsed: Parsed, mapping: Mapping) {
  if (!mapping.smiles) throw Error('请选择 SMILES 所在列。');
  const warnings: string[] = [];
  const used = new Set<string>();
  const records = parsed.rows.map((row, index) => {
    const read = (key: keyof Mapping) =>
      mapping[key]
        ? row[parsed.headers.indexOf(mapping[key])]?.trim() || ''
        : '';
    const score = (key: 'docking' | 'mmgbsa') => {
      const s = read(key);
      if (!s || ['na', 'nan', 'null', 'n/a', '-'].includes(s.toLowerCase()))
        return null;
      const n = Number(s);
      if (!Number.isFinite(n)) {
        warnings.push(
          '第 ' + (index + 1) + ' 条的 ' + key + ' 不是有效数字，按缺失处理',
        );
        return null;
      }
      return n;
    };
    const id = read('id') || 'CMP-' + String(index + 1).padStart(4, '0');
    if (used.has(id)) warnings.push('重复 ID：' + id + '；保留独立行记录');
    used.add(id);
    return {
      key: 'r' + index,
      id,
      smiles: read('smiles'),
      docking: score('docking'),
      mmgbsa: score('mmgbsa'),
      supplier: read('supplier'),
      catalog: read('catalog'),
      sourceRow: index + 1,
      raw: Object.fromEntries(parsed.headers.map((h, i) => [h, row[i] || ''])),
    };
  });
  return { records, warnings };
}
export function similarity(a: Mol, b: Mol) {
  let hit = 0;
  for (let i = 0; i < a.fp.length; i++) {
    let x = (a.fp[i] & b.fp[i]) >>> 0;
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    hit += (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  return a.bits + b.bits - hit ? hit / (a.bits + b.bits - hit) : 1;
}
export function chooseCandidate(
  selected: string[],
  record: Mol,
  rows: Mol[],
  limit = Infinity,
): { selected: string[]; error?: string } {
  if (selected.includes(record.key))
    return { selected: selected.filter((k) => k !== record.key) };
  if (selected.length >= limit)
    return {
      selected,
      error: '候选已达自定义上限 ' + limit + ' 个，请调整上限或移除一些分子。',
    };
  if (
    rows.some(
      (r) => selected.includes(r.key) && r.canonical === record.canonical,
    )
  )
    return {
      selected,
      error: '候选中已有相同规范结构。请先移除已有记录，再选择另一供应商。',
    };
  return { selected: [...selected, record.key] };
}
export function selectCandidatePage(selected: string[], page: Mol[], rows: Mol[], checked: boolean, limit = Infinity) {
  if (!checked) {
    const keys = new Set(page.map((r) => r.key));
    return { selected: selected.filter((key) => !keys.has(key)), skipped: 0 };
  }
  let next = [...selected], skipped = 0;
  for (const record of page) {
    if (next.includes(record.key)) continue;
    const result = chooseCandidate(next, record, rows, limit);
    if (result.error) skipped++;
    else next = result.selected;
  }
  return { selected: next, skipped };
}
export function download(
  name: string,
  content: string,
  type = 'text/plain;charset=utf-8',
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csv(
  data: Record<string, unknown>[],
  escapeFormulae: boolean | RegExp = true,
) {
  return '\uFEFF' + Papa.unparse(data, { escapeFormulae });
}
export const demo = `id,smiles,docking,mmgbsa,supplier,catalog_id
DEMO-001,CC(=O)Oc1ccccc1C(=O)O,-8.2,-42.1,演示供应商,D001
DEMO-002,CC(=O)Nc1ccc(O)cc1,-7.5,-35.8,演示供应商,D002
DEMO-003,CC(C)Cc1ccc(C(C)C(=O)O)cc1,-9.1,-48.4,演示供应商,D003
DEMO-004,COc1ccc2cc(C(C)C(=O)O)ccc2c1,-9.3,-51.2,演示供应商,D004
DEMO-005,O=C(O)c1ccccc1O,-7.4,-32.6,演示供应商,D005
DEMO-006,CC(=O)Nc1ccccc1,-7.2,-31.0,演示供应商,D006
DEMO-007,CCOc1ccc(NC(C)=O)cc1,-8.0,-40.3,演示供应商,D007
DEMO-008,CC(=O)Nc1ccc(Cl)cc1,-8.3,-44.4,演示供应商,D008
DEMO-009,CC(=O)Nc1ccc(F)cc1,-8.1,-39.6,演示供应商,D009
DEMO-010,CC(=O)Nc1ccc(C)cc1,-7.9,-38.2,演示供应商,D010
DEMO-011,CC(=O)Nc1ccc(OC)cc1,-8.5,-43.2,演示供应商,D011
DEMO-012,CC(=O)Nc1ccc(Br)cc1,-8.4,-44.8,演示供应商,D012
DEMO-013,O=C(O)c1ccccc1,-6.8,-26.4,演示供应商,D013
DEMO-014,O=C(O)c1ccc(F)cc1,-7.1,-28.8,演示供应商,D014
DEMO-015,O=C(O)c1ccc(Cl)cc1,-7.5,-33.4,演示供应商,D015
DEMO-016,O=C(O)c1ccc(OC)cc1,-7.6,-34.2,演示供应商,D016
DEMO-017,O=C(O)c1ccc(C)cc1,-7.3,-30.5,演示供应商,D017
DEMO-018,O=C(O)c1ccc(O)cc1,-7.4,-32.0,演示供应商,D018
DEMO-019,CCN(CC)C(=O)c1ccccc1,-8.7,-44.6,演示供应商,D019
DEMO-020,CCN(CC)C(=O)c1ccc(F)cc1,-9.0,-46.5,演示供应商,D020
DEMO-021,CCN(CC)C(=O)c1ccc(Cl)cc1,-9.1,-47.7,演示供应商,D021
DEMO-022,CCN(CC)C(=O)c1ccc(C)cc1,-8.8,-45.4,演示供应商,D022
DEMO-023,CN1CCN(c2ccccc2)CC1,-8.5,-42.2,演示供应商,D023
DEMO-024,CN1CCN(c2ccc(F)cc2)CC1,-8.7,-44.9,演示供应商,D024
DEMO-025,CN1CCN(c2ccc(Cl)cc2)CC1,-9.2,-48.6,演示供应商,D025
DEMO-026,CN1CCN(c2ccc(OC)cc2)CC1,-9.0,-47.0,演示供应商,D026
DEMO-027,CN1CCN(c2ccc(C)cc2)CC1,-8.9,-45.6,演示供应商,D027
DEMO-028,CN1CCN(c2ncccc2)CC1,-8.4,-41.0,演示供应商,D028
DEMO-029,CCOc1ccc2nc(N)sc2c1,-9.3,-50.4,演示供应商,D029
DEMO-030,COc1ccc2nc(N)sc2c1,-9.2,-49.8,演示供应商,D030
DEMO-031,Nc1nc2ccc(Cl)cc2s1,-9.0,-46.7,演示供应商,D031
DEMO-032,Nc1nc2ccc(F)cc2s1,-8.8,-45.0,演示供应商,D032
DEMO-033,Nc1nc2ccccc2s1,-8.6,-41.8,演示供应商,D033
DEMO-034,Cc1ccc2nc(N)sc2c1,-8.9,-46.2,演示供应商,D034
DEMO-035,CC(=O)Oc1ccccc1C(=O)O,-8.0,-41.2,演示供应商乙,D035
DEMO-036,C[C@H](O)C(=O)O,-5.2,-19.2,演示供应商,D036
DEMO-037,C[C@@H](O)C(=O)O,-5.1,-19.4,演示供应商,D037
DEMO-038,C[NH+](C)CCO.[Cl-],-6.0,-22.0,演示供应商,D038
DEMO-039,Cn1c(=O)c2c(ncn2C)n(C)c1=O,-7.5,-32.1,演示供应商,D039
DEMO-040,C1CC,,,演示供应商,D040`;

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const output = ts.transpileModule(fs.readFileSync('lib/chem.ts', 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
const libModule = { exports: {} };
vm.runInNewContext(output, {
  exports: libModule.exports,
  module: libModule,
  require,
  Uint32Array,
  Set,
  Map,
  console,
});
const lib = libModule.exports;
// Include negative values, ties and legacy project records with absent descriptors.
const logpRows = [2, null, -1.5, NaN, 2, undefined, Infinity, 0].map(
  (logp, sourceRow) => ({ logp, sourceRow }),
);
assert.deepEqual(
  [...logpRows].sort((a, b) => lib.compareLogP(a, b, 'asc')).map((r) => r.sourceRow),
  [2, 7, 0, 4, 1, 3, 5, 6],
);
assert.deepEqual(
  [...logpRows].sort((a, b) => lib.compareLogP(a, b, 'desc')).map((r) => r.sourceRow),
  [0, 4, 7, 2, 1, 3, 5, 6],
);
assert.deepEqual(logpRows.map((r) => r.sourceRow), [0, 1, 2, 3, 4, 5, 6, 7]);
const RDKit = await require('@rdkit/rdkit')();
let result;
const context = vm.createContext({
  console,
  Uint32Array,
  Float32Array,
  Uint8Array,
  Map,
  Set,
  importScripts() {},
  initRDKitModule: async () => RDKit,
  postMessage(data) {
    if (data.type === 'result' || data.type === 'error') result = data;
  },
});
vm.runInContext(fs.readFileSync('public/chem-core.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('public/scaffold.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('public/chem-worker.js', 'utf8'), context);
async function analyze(text, threshold = 0.6, chirality = false, extra = {}) {
  const p = lib.parseInput(text),
    made = lib.makeRecords(p, p.mapping);
  result = null;
  await context.onmessage({
    data: { records: made.records, threshold, chirality, ...extra },
  });
  assert.equal(result.type, 'result', result.message);
  return { ...result, warnings: made.warnings };
}
const sample = await analyze(lib.demo);
assert.equal(sample.rows.length, 39);
assert.equal(sample.issues.length, 1);
assert.equal(new Set(sample.rows.map((r) => r.canonical)).size, 38);
assert.equal(sample.rows.filter((r) => r.duplicateOf).length, 1);
for (const cluster of sample.clusters)
  for (const i of cluster.members) {
    assert.equal(sample.rows[i].cluster, cluster.id);
    assert.ok(
      lib.similarity(sample.rows[i], sample.rows[cluster.center]) >=
        0.6 - 1e-12,
    );
  }
assert.equal(new Set(sample.clusters.flatMap((c) => c.members)).size, 39);
assert.ok(
  sample.rows.every((r) => Number.isFinite(r.x) && Number.isFinite(r.y)),
);
const identities = await analyze(
  'id,smiles,docking,mmgbsa\na,CCO,0,\na,OCC,-1,not_a_score\nc,C[C@H](O)C(=O)O,,\nd,C[C@@H](O)C(=O)O,,\ne,C[NH+](C)CCO.[Cl-],,\nf,,,-1\ng,invalid,,-3',
);
assert.equal(identities.rows.length, 5);
assert.equal(identities.issues.length, 2);
assert.equal(identities.rows[0].docking, 0);
assert.equal(identities.rows[0].mmgbsa, null);
assert.equal(identities.rows[1].mmgbsa, null);
assert.equal(identities.rows[0].canonical, identities.rows[1].canonical);
assert.notEqual(identities.rows[2].canonical, identities.rows[3].canonical);
assert.equal(lib.similarity(identities.rows[2], identities.rows[3]), 1);
assert.ok(identities.rows[4].multi);
assert.equal(identities.warnings.length, 2);
const stereo = await analyze('C[C@H](O)C(=O)O\nC[C@@H](O)C(=O)O', 0.6, true);
assert.ok(lib.similarity(stereo.rows[0], stereo.rows[1]) < 1);
const one = await analyze('CCO');
assert.equal(one.clusters.length, 1);
assert.equal(one.rows[0].x, 0);
assert.equal(one.rows[0].y, 0);
const identical = await analyze(Array(25).fill('CCO').join('\n'));
assert.equal(identical.clusters.length, 1);
assert.ok(identical.rows.every((r) => r.x === 0 && r.y === 0));
assert.throws(() => lib.parseInput('  '));
assert.throws(() => lib.parseInput('smiles,smiles\nCCO,CCO'));
const quoted = lib.parseInput('id,smiles,supplier\n"A,1",CCO,"Vendor, Inc."');
assert.equal(lib.makeRecords(quoted, quoted.mapping).records[0].id, 'A,1');
const tsv = await analyze('ID\tSMILES\tMMGBSA\nT1\tCCO\t-2.3');
assert.equal(tsv.rows[0].mmgbsa, -2.3);
const smi = await analyze('CCO Ethanol\nCC(=O)O Acetic acid');
assert.equal(smi.rows[1].id, 'Acetic acid');
const escaped = lib.csv([
  { id: '=HYPERLINK("malicious")', notes: 'line1\nline2', score: -4.3 },
]);
assert.ok(escaped.includes("'=HYPERLINK"));
assert.ok(escaped.includes('-4.3'));
const selectionRows = Array.from({ length: 75 }, (_, i) => ({
  ...sample.rows[0],
  key: 's' + i,
  canonical: 'unique' + i,
}));
let selected = [];
for (let i = 0; i < 74; i++)
  selected = lib.chooseCandidate(
    selected,
    selectionRows[i],
    selectionRows,
  ).selected;
assert.equal(selected.length, 74);
assert.ok(
  lib.chooseCandidate(selected, selectionRows[74], selectionRows, 74).error,
);
selected = lib.chooseCandidate(
  selected,
  selectionRows[0],
  selectionRows,
).selected;
assert.equal(selected.length, 73);
const firstPage = lib.selectCandidatePage([], selectionRows.slice(0,20), selectionRows, true);
const secondPage = lib.selectCandidatePage(firstPage.selected, selectionRows.slice(20,50), selectionRows, true);
assert.equal(secondPage.selected.length, 50);
const clearedPage = lib.selectCandidatePage(secondPage.selected, selectionRows.slice(20,50), selectionRows, false);
assert.deepEqual([...clearedPage.selected], [...firstPage.selected]);
const capped = lib.selectCandidatePage(firstPage.selected, selectionRows.slice(20,50), selectionRows, true, 25);
assert.equal(capped.selected.length,25);
assert.equal(capped.skipped,25);
const lowered = lib.selectCandidatePage(secondPage.selected, selectionRows, selectionRows,true,10);
assert.equal(lowered.selected.length,50);
const repeated = lib.selectCandidatePage(secondPage.selected, selectionRows.slice(20,50), selectionRows,true);
assert.equal(repeated.selected.length,50);
const duplicate = lib.chooseCandidate(
  [identities.rows[0].key],
  identities.rows[1],
  identities.rows,
);
assert.ok(duplicate.error);
const before = sample.rows.map((r) => [r.key, r.canonical]);
context.ChemCore.analyze(sample.rows, 0.8);
assert.deepEqual(
  sample.rows.map((r) => [r.key, r.canonical]),
  before,
);
// Exercise the actual production worker on 2604 records; sample structures repeat intentionally.
const base = lib
  .makeRecords(lib.parseInput(lib.demo), lib.parseInput(lib.demo).mapping)
  .records.filter((r) => r.smiles !== 'C1CC');
const large = Array.from({ length: 2604 }, (_, i) => ({
  ...base[i % base.length],
  key: 'load' + i,
  id: 'LOAD-' + i,
  sourceRow: i + 1,
}));
const start = performance.now();
await context.onmessage({
  data: { records: large, threshold: 0.6, chirality: false },
});
assert.equal(result.rows.length, 2604);
assert.equal(result.issues.length, 0);
assert.equal(new Set(result.clusters.flatMap((c) => c.members)).size, 2604);
assert.ok(
  result.rows.every((r) => Number.isFinite(r.x) && Number.isFinite(r.y)),
);
const summary = {
  status: 'passed',
  rdkit: RDKit.version(),
  demo: { valid: 39, invalid: 1, unique: 38, clusters: sample.clusters.length },
  load: {
    records: 2604,
    pairs: (2604 * 2603) / 2,
    elapsedSeconds: +((performance.now() - start) / 1000).toFixed(2),
  },
  checks: [
    'SMILES validation and empty molecules',
    'canonical duplicate retention',
    'stereochemistry switch',
    'multi-fragment flag',
    'zero and missing scores',
    'cLogP ascending and descending: negative values, ties, missing values last',
    'duplicate IDs',
    'CSV quoting and formula escaping',
    'TSV and SMI inputs',
    'Butina membership and complete assignment',
    'finite deterministic projection',
    'single and identical structures',
    'unlimited candidates, custom cap, current-page selection and duplicates',
    'stable record identity on reclustering',
  ],
};
fs.mkdirSync('work', { recursive: true });
fs.writeFileSync('work/validation.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

const skeletons = await analyze(
  'smiles,id\nOc1ccccc1,A\nNc1ccccc1,B\nC1CCNCC1,C\nCCO,D',
  0.6,
  false,
  { basis: 'generic', radius: 3, nBits: 4096 },
);
assert.equal(skeletons.rows.length, 4);
assert.equal(skeletons.rows[0].cluster, skeletons.rows[1].cluster);
assert.equal(skeletons.rows[0].cluster, skeletons.rows[2].cluster);
assert.equal(skeletons.rows[3].scaffold, '');
assert.equal(skeletons.rows[0].fp.length, 128);
assert.equal(
  skeletons.clusters.reduce((n, c) => n + c.size, 0),
  4,
);
assert.equal(
  skeletons.rows.filter((r) => r.center).length,
  skeletons.clusters.length,
);
console.log(
  'Scaffold superclasses, acyclic fallback and 4096-bit parameters passed',
);

const rankInput =
  'smiles,id,mmgbsa,docking\nCCO,A,-30,-9\nCCN,B,-50,-7\nCCC,C,-50,-8\nCCCl,D,,-10\nnot_a_smiles,E,-100,-11';
const retained = await analyze(rankInput, 0.6, false, {
  retention: { limit: 2, rank: 'mmgbsa' },
});
assert.equal(retained.rows.map((r) => r.id).join(','), 'B,C');
assert.equal(retained.rows.map((r) => r.key).join(','), 'r1,r2');
assert.equal(retained.allRows.length, 4);
assert.equal(retained.issues.length, 1);
assert.equal(
  retained.clusters.reduce((n, c) => n + c.size, 0),
  2,
);
const dockingTop = await analyze(rankInput, 0.6, false, {
  retention: { limit: 1, rank: 'docking' },
});
assert.equal(dockingTop.rows[0].id, 'D');
const sourceTop = await analyze(rankInput, 0.6, false, {
  retention: { limit: 1, rank: 'source' },
});
assert.equal(sourceTop.rows[0].id, 'A');
const oversized = await analyze(rankInput, 0.6, false, {
  retention: { limit: 100, rank: 'mmgbsa' },
});
assert.equal(oversized.rows.length, 3);
const restored = await analyze(rankInput);
assert.equal(restored.rows.length, 4);
assert.equal(restored.rows[3].key, 'r3');
assert.throws(() =>
  context.ChemCore.retain(restored.rows, { limit: 0, rank: 'source' }),
);
assert.throws(() =>
  context.ChemCore.retain([{ mmgbsa: null }], { limit: 1, rank: 'mmgbsa' }),
);
console.log(
  'Top-N passed: valid structures, missing scores, ties, original keys, exact membership and full restoration',
);

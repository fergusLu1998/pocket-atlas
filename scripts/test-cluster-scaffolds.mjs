import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = await require('@rdkit/rdkit')();
const context = vm.createContext({ console, Map, Set });
vm.runInContext(fs.readFileSync('public/scaffold.js', 'utf8'), context);
vm.runInContext(
  fs.readFileSync('public/cluster-scaffolds.js', 'utf8'),
  context,
);
const build = (smiles) =>
  context.ClusterScaffolds.build(
    R,
    smiles.map((s, i) => ({
      id: `QA-${i}`,
      key: `k${i}`,
      smiles: s,
      sourceRow: i,
      multi: s.includes('.'),
    })),
    1,
  );

const substituents = build([
  'COc1ccc(Cl)cc1',
  'COc1ccc(F)cc1',
  'COc1ccc(Br)cc1',
]);
assert.equal(substituents.mode, 'shared');
assert.equal(substituents.cores[0].groups.length, 1);
assert.equal(substituents.cores[0].groups[0].variants, 3);
assert.ok(substituents.cores[0].templateSmiles.includes('CO')); // Constant methoxy is retained.
assert.ok(substituents.cores[0].templateSmiles.includes('[*:1]'));
assert.ok(!substituents.cores[0].templateSmiles.includes('Cl'));

const symmetric = build(['COc1ccc(Cl)cc1', 'Fc1ccc(OC)cc1']);
assert.equal(symmetric.cores[0].groups.length, 1); // Reverse atom order does not invent extra R sites.
const identical = build(['Cc1ccccc1', 'c1ccc(C)cc1']);
assert.equal(identical.cores[0].status, 'single');
assert.equal(identical.cores[0].groups.length, 0);
const hydrogen = build(['c1ccccc1', 'Cc1ccccc1']);
assert.equal(hydrogen.cores[0].groups.length, 1);
assert.ok(hydrogen.cores[0].groups[0].values.some((v) => v.smiles === 'H'));
const positional = build(['COc1ccc(Cl)cc1', 'COc1cc(Cl)ccc1']);
assert.ok(positional.cores[0].groups.length >= 2);
const geminal = build(['CC1(O)CCCCC1', 'CCC1(N)CCCCC1']);
assert.equal(geminal.cores[0].groups[0].labels.length, 2);
const fused = build(['c1ccccc1', 'c1ccc2ccccc2c1']);
assert.equal(fused.mode, 'series');
assert.equal(
  fused.cores.reduce((n, c) => n + c.count, 0),
  2,
);
const hetero = build(['c1ccccc1', 'c1ccncc1']);
assert.equal(hetero.mode, 'series');
const charges = build(['CN1CCCCC1', 'C[NH+]1CCCCC1']);
assert.equal(charges.mode, 'series');
const chain = build(['CCO', 'CCCO']);
assert.equal(chain.mode, 'shared');
assert.equal(chain.cores[0].acyclic, true);
assert.equal(chain.cores[0].groups.length, 1);
const salts = build(['COc1ccc(Cl)cc1.[Na+]', 'COc1ccc(F)cc1.[Cl-]']);
assert.equal(salts.disconnected, 2);
assert.equal(salts.cores[0].groups.length, 1);

for (const summary of [
  substituents,
  symmetric,
  identical,
  hydrogen,
  positional,
  geminal,
  fused,
  hetero,
  chain,
  salts,
]) {
  assert.equal(
    summary.cores.reduce((n, c) => n + c.count, 0),
    summary.total,
  );
  for (const core of summary.cores) {
    assert.ok(core.svg.startsWith('<?xml') || core.svg.startsWith('<svg'));
    const mol = R.get_mol(core.templateSmiles);
    assert.ok(mol?.is_valid());
    mol?.delete();
  }
}
console.log(
  'Cluster scaffold tests passed: symmetry alignment, constant branches, R/H variation, geminal slots, fused and hetero fallback, acyclic cores, salts and complete coverage.',
);

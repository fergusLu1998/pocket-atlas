import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
function load(file) {
  const testModule = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      module: testModule,
      exports: testModule.exports,
      require: (name) => load(path.resolve(path.dirname(file), name + '.ts')),
      console,
      Map,
      Set,
      WeakMap,
      Math,
      Number,
    },
  );
  return testModule.exports;
}
const plot = load('lib/scatter.ts'),
  open = load('lib/open-interactions.ts'),
  interaction = load('lib/interactions.ts');
const frame = { left: 50, right: 650, top: 30, bottom: 350 },
  bounds = { xmin: -2, xmax: 4, ymin: -3, ymax: 5 };
const point = { x: 1.2, y: 2.5 },
  screen = plot.toScreen(point, bounds, frame),
  back = plot.fromScreen(screen.x, screen.y, bounds, frame);
assert.ok(
  Math.abs(back.x - point.x) < 1e-9 && Math.abs(back.y - point.y) < 1e-9,
);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(plot.boxBounds([650, 350], [50, 30], bounds, frame)),
  ),
  bounds,
);
assert.equal(plot.boxBounds([100, 100], [103, 200], bounds, frame), null);
const zoom = plot.boxBounds([150, 100], [450, 250], bounds, frame);
assert.ok(zoom.xmax - zoom.xmin < bounds.xmax - bounds.xmin);
assert.ok(zoom.ymax - zoom.ymin < bounds.ymax - bounds.ymin);
assert.equal(
  plot.hitPoints(
    [
      { x: 100, y: 100, key: 'a', visible: true },
      { x: 100, y: 100, key: 'b', visible: true },
      { x: 20, y: 100, key: 'outside', visible: true },
    ],
    100,
    100,
    frame,
  ).length,
  2,
);
assert.equal(
  plot.hitPoints(
    [{ x: 20, y: 100, key: 'outside', visible: true }],
    20,
    100,
    frame,
  ).length,
  0,
);
assert.deepEqual(
  JSON.parse(JSON.stringify(plot.rotatePoint({ x: 1, y: 2, z: 3 }, 0, 0))),
  { x: 1, y: 2, depth: 3 },
);
const atom = (elem, x, y = 0, z = 0, extra = {}) => ({
  elem,
  x,
  y,
  z,
  atom: elem,
  resn: 'LIG',
  resi: 1,
  chain: 'A',
  charge: 0,
  bonds: [],
  bondOrder: [],
  ...extra,
});
const structure = (atoms, protein = false) => ({
  atoms,
  protein,
  title: 'fixture',
  sourceIndex: 1,
  properties: {},
});
const donor = structure(
  [
    atom('N', 0, 0, 0, { atom: 'N', resn: 'ALA', bonds: [1], bondOrder: [1] }),
    atom('H', 1, 0, 0, { atom: 'H', resn: 'ALA', bonds: [0], bondOrder: [1] }),
  ],
  true,
);
const acceptor = structure([atom('O', 2.8)]);
let result = open.calculateOpenInteractions(donor, acceptor);
assert.equal(result.pairs.filter((p) => p.type === 'hbond').length, 1);
assert.equal(result.pairs.find((p) => p.type === 'hbond').angle, 180);
assert.equal(
  interaction.residueInteractionState(result, ['A:ALA1'], 'hbond'),
  'yes',
);
result = open.calculateOpenInteractions(
  structure([atom('N', 0, 0, 0, { resn: 'ALA' })], true),
  acceptor,
);
assert.equal(result.pairs.filter((p) => p.type === 'hbond').length, 0);
assert.ok(result.pairs.some((p) => p.type === 'hbond_candidate'));
assert.equal(
  interaction.residueInteractionState(result, ['A:ALA1'], 'hbond'),
  'unknown',
);
assert.equal(
  interaction.residueInteractionState(result, ['A:ALA1'], 'all'),
  'unknown',
);
const salt = open.calculateOpenInteractions(
  structure([atom('N', 0, 0, 0, { resn: 'ARG', atom: 'NH1' })], true),
  structure([atom('O', 3, 0, 0, { charge: -1 })]),
);
assert.ok(salt.pairs.some((p) => p.type === 'salt'));
assert.equal(
  interaction.residueInteractionState(salt, ['A:ARG1'], 'salt'),
  'yes',
);
const far = open.calculateOpenInteractions(
  donor,
  structure([atom('O', 20, 0, 0, { charge: -1 })]),
);
assert.equal(
  interaction.residueInteractionState(far, ['A:ALA1'], 'hbond'),
  'no',
);
const halogen = structure([
  atom('C', 0, 0, 0, { bonds: [1], bondOrder: [1] }),
  atom('Br', 1.8, 0, 0, { bonds: [0], bondOrder: [1] }),
]);
assert.ok(
  open
    .calculateOpenInteractions(
      structure([atom('O', 5.3, 0, 0, { resn: 'SER' })], true),
      halogen,
    )
    .pairs.some((p) => p.type === 'halogen'),
);
assert.ok(
  !open
    .calculateOpenInteractions(
      structure([atom('O', 1.8, 3.5, 0, { resn: 'SER' })], true),
      halogen,
    )
    .pairs.some((p) => p.type === 'halogen'),
);
const ring = (z, protein) =>
  structure(
    Array.from({ length: 6 }, (_, i) =>
      atom(
        'C',
        1.4 * Math.cos((i * Math.PI) / 3),
        1.4 * Math.sin((i * Math.PI) / 3),
        z,
        {
          resn: protein ? 'PHE' : 'LIG',
          atom: ['CG', 'CD1', 'CE1', 'CZ', 'CE2', 'CD2'][i],
          bonds: [(i + 5) % 6, (i + 1) % 6],
          bondOrder: i % 2 ? [2, 1] : [1, 2],
        },
      ),
    ),
    protein,
  );
assert.ok(
  open
    .calculateOpenInteractions(ring(0, true), ring(3.6, false))
    .pairs.some((p) => p.type === 'pipi'),
);
assert.ok(
  open
    .calculateOpenInteractions(
      structure([atom('N', 0, 0, 4, { resn: 'LYS', atom: 'NZ' })], true),
      ring(0, false),
    )
    .pairs.some((p) => p.type === 'pication'),
);
assert.notEqual(
  interaction.interactionKey(donor, acceptor, 'open'),
  interaction.interactionKey(donor, acceptor, 'native'),
);
assert.equal(
  interaction.interactionKey(donor, acceptor, 'open'),
  interaction.interactionKey(
    structuredClone(donor),
    structuredClone(acceptor),
    'open',
  ),
);
assert.throws(() => open.calculateOpenInteractions(structure([]), acceptor));
assert.throws(() =>
  open.calculateOpenInteractions(donor, structure([atom('O', NaN)])),
);
console.log(
  'Scatter and open interaction tests passed: reversible transforms, bounded box zoom, overlapping picks, 3D rotation, explicit-H bonds, unknown candidates, salt, directional halogen, aromatic stacking, cation-pi and separate cache identities.',
);

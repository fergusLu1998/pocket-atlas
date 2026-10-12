import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const module = { exports: {} };
const output = ts.transpileModule(
  fs.readFileSync('lib/structure-export.ts', 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
vm.runInNewContext(output, { module, exports: module.exports });
const { structurePages, descriptorText } = module.exports;
for (const count of [0, 1, 12, 13, 25, 73]) {
  const records = Array.from({ length: count }, (_, i) => ({
    key: `record-${i}`,
  }));
  const pages = structurePages(records);
  assert.equal(pages.length, Math.ceil(count / 12));
  assert.deepEqual(
    Array.from(pages.flat(), (r) => r.key),
    records.map((r) => r.key),
  );
  assert.ok(pages.every((page) => page.length > 0 && page.length <= 12));
  assert.equal(records.length, count);
}
assert.equal(descriptorText(0), '0.00');
assert.equal(descriptorText(-81.234), '-81.23');
assert.equal(descriptorText(306.405), '306.40');
for (const missing of [null, undefined, NaN, Infinity])
  assert.equal(descriptorText(missing), '—');
console.log(
  'Structure export passed: complete ordered pagination, partial final pages, zero scores and missing descriptors.',
);

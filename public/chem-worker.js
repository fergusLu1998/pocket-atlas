importScripts('/rdkit/RDKit_minimal.js', '/chem-core.js', '/scaffold.js');
let engine;
onmessage = async function (event) {
  const {
    records,
    threshold,
    chirality,
    radius = 2,
    nBits = 2048,
    basis = 'molecule',
  } = event.data;
  const progress = (value, message) =>
    postMessage({ type: 'progress', value, message });
  try {
    progress(2, '载入 RDKit 分析引擎');
    engine =
      engine || (await initRDKitModule({ locateFile: (f) => '/rdkit/' + f }));
    let rows = [];
    const issues = [],
      seen = new Map();
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      let mol, scaffold;
      try {
        if (!rec.smiles.trim()) throw Error('SMILES 为空');
        mol = engine.get_mol(rec.smiles.trim());
        if (!mol || !mol.is_valid()) throw Error('无法解析 SMILES');
        const desc = JSON.parse(mol.get_descriptors());
        if (!(desc.NumHeavyAtoms > 0)) throw Error('结构没有重原子');
        const canonical = mol.get_smiles();
        const result = Scaffolds.get(engine, mol, basis === 'generic');
        scaffold = result.mol;
        const bits = (
          basis === 'molecule' ? mol : scaffold || mol
        ).get_morgan_fp(
          JSON.stringify({ radius, nBits, useChirality: chirality }),
        );
        if (bits.length !== nBits) throw Error('指纹位数校验未通过');
        const packed = ChemCore.pack(bits);
        const duplicateOf = seen.get(canonical) || null;
        seen.set(canonical, seen.get(canonical) || rec.id);
        rows.push({
          ...rec,
          canonical,
          scaffold: result.smiles,
          fp: packed.words,
          bits: packed.count,
          mw: desc.amw,
          logp: desc.CrippenClogP,
          tpsa: desc.tpsa,
          hbd: desc.NumHBD,
          hba: desc.NumHBA,
          rot: desc.NumRotatableBonds,
          unspecifiedStereo: desc.NumUnspecifiedAtomStereoCenters || 0,
          multi: canonical.includes('.'),
          duplicateOf,
        });
      } catch (e) {
        issues.push({
          row: rec.sourceRow,
          id: rec.id,
          smiles: rec.smiles,
          reason: e.message || '结构解析失败',
        });
      } finally {
        if (mol) mol.delete();
        if (scaffold) scaffold.delete();
      }
      if (i % 40 === 0)
        progress(
          5 + Math.round((28 * i) / records.length),
          '验证结构并计算 Morgan 指纹 · ' + i + ' / ' + records.length,
        );
    }
    const allRows = rows;
    rows = ChemCore.retain(rows, event.data.retention);
    // Duplicate markers reflect the active analysis, while original keys remain stable.
    const retainedSeen = new Map();
    rows.forEach((r) => {
      r.duplicateOf = retainedSeen.get(r.canonical) || null;
      if (!retainedSeen.has(r.canonical)) retainedSeen.set(r.canonical, r.id);
    });
    let clusters;
    if (basis === 'molecule')
      clusters = ChemCore.analyze(rows, threshold, progress);
    else {
      const groups = new Map();
      rows.forEach((r, i) => {
        const key = r.scaffold || 'acyclic:' + r.canonical;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(i);
      });
      const members = [...groups.values()],
        representatives = members.map((a) => ({ ...rows[a[0]] }));
      const superclusters = ChemCore.analyze(
        representatives,
        threshold,
        progress,
      );
      representatives.forEach((r, i) =>
        members[i].forEach((j) =>
          Object.assign(rows[j], {
            cluster: r.cluster,
            x: r.x,
            y: r.y,
            z: r.z,
            centerSimilarity: r.centerSimilarity,
            center: r.center && j === members[i][0],
          }),
        ),
      );
      clusters = superclusters.map((c) => ({
        ...c,
        center: members[c.center][0],
        members: c.members.flatMap((i) => members[i]),
        size: c.members.reduce((n, i) => n + members[i].length, 0),
      }));
    }
    postMessage({
      type: 'result',
      rows,
      allRows,
      issues,
      clusters,
      version: engine.version(),
    });
  } catch (e) {
    postMessage({
      type: 'error',
      message: e.message || '分析失败，请检查输入后重试。',
    });
  }
};

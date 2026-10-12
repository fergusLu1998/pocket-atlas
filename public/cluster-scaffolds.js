/* Verified Murcko-template summaries. Not an exhaustive maximum-common-subgraph search. */
(function (root) {
  const symbols =
    '* H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(
      ' ',
    );
  function graph(mol) {
    const doc = JSON.parse(mol.get_json()),
      m = doc.molecules[0];
    const atoms = m.atoms.map((a) => ({ ...doc.defaults.atom, ...a }));
    const bonds = m.bonds.map((b) => ({ ...doc.defaults.bond, ...b }));
    const rep =
      m.extensions?.find((e) => e.name === 'rdkitRepresentation') || {};
    const aromaticAtoms = new Set(rep.aromaticAtoms || []),
      aromaticBonds = new Set(rep.aromaticBonds || []);
    const adj = atoms.map(() => []);
    bonds.forEach((b, i) => {
      adj[b.atoms[0]].push(i);
      adj[b.atoms[1]].push(i);
    });
    return { atoms, bonds, adj, aromaticAtoms, aromaticBonds };
  }
  function block(g, keep, dummies = []) {
    const ids = [...keep].sort((a, b) => a - b),
      map = new Map(ids.map((a, i) => [a, i + 1]));
    const bonds = g.bonds
      .filter((b) => b.atoms.every((a) => keep.has(a)))
      .map((b) => ({
        bo: b.bo,
        a: map.get(b.atoms[0]),
        b: map.get(b.atoms[1]),
      }));
    dummies.forEach((d, i) =>
      bonds.push({ bo: d.bo, a: map.get(d.at), b: ids.length + i + 1 }),
    );
    return [
      'Pocket Atlas common core',
      '  PocketAtlas',
      '',
      '  0  0  0     0  0            999 V3000',
      'M  V30 BEGIN CTAB',
      `M  V30 COUNTS ${ids.length + dummies.length} ${bonds.length} 0 0 0`,
      'M  V30 BEGIN ATOM',
      ...ids.map(
        (a, i) =>
          `M  V30 ${i + 1} ${symbols[g.atoms[a].z]} 0 0 0 0${g.atoms[a].chg ? ' CHG=' + g.atoms[a].chg : ''}${g.atoms[a].isotope ? ' MASS=' + g.atoms[a].isotope : ''}`,
      ),
      ...dummies.map(
        (d, i) => `M  V30 ${ids.length + i + 1} * 0 0 0 ${d.label || 0}`,
      ),
      'M  V30 END ATOM',
      'M  V30 BEGIN BOND',
      ...bonds.map((b, i) => `M  V30 ${i + 1} ${b.bo} ${b.a} ${b.b}`),
      'M  V30 END BOND',
      'M  V30 END CTAB',
      'M  END',
    ].join('\n');
  }
  function canonical(R, g, keep, dummies) {
    const m = R.get_mol(block(g, keep, dummies));
    if (!m) throw Error('侧链片段无法解析');
    try {
      return m.get_smiles();
    } finally {
      m.delete();
    }
  }
  // RDKit uniquifies matches by target atom set. Expand chemical graph symmetries
  // explicitly so equivalent ring orientations do not invent variable positions.
  function symmetries(g) {
    const n = g.atoms.length,
      edges = Array.from({ length: n }, () => new Map());
    g.bonds.forEach((b, i) => {
      const t = g.aromaticBonds.has(i) ? 4 : b.bo;
      edges[b.atoms[0]].set(b.atoms[1], t);
      edges[b.atoms[1]].set(b.atoms[0], t);
    });
    const sig = (i) =>
      [
        g.atoms[i].z,
        g.atoms[i].chg,
        g.atoms[i].isotope,
        g.aromaticAtoms.has(i),
        g.adj[i].length,
      ].join(':');
    const candidates = g.atoms.map((_, i) =>
      g.atoms.map((_, j) => j).filter((j) => sig(i) === sig(j)),
    );
    const order = g.atoms
      .map((_, i) => i)
      .sort(
        (a, b) =>
          candidates[a].length - candidates[b].length ||
          g.adj[b].length - g.adj[a].length ||
          a - b,
      );
    const result = [g.atoms.map((_, i) => i)],
      map = new Array(n).fill(-1),
      used = new Set();
    let visits = 0,
      limited = false;
    function visit(depth) {
      if (++visits > 30000 || result.length >= 192) {
        limited = true;
        return;
      }
      if (depth === n) {
        if (map.some((x, i) => x !== i)) result.push([...map]);
        return;
      }
      const a = order[depth];
      for (const b of candidates[a]) {
        if (used.has(b)) continue;
        if (
          order
            .slice(0, depth)
            .some((i) => edges[a].get(i) !== edges[b].get(map[i]))
        )
          continue;
        map[a] = b;
        used.add(b);
        visit(depth + 1);
        used.delete(b);
        map[a] = -1;
        if (limited) return;
      }
    }
    visit(0);
    return { maps: result, limited };
  }
  function components(R, entry, mapping) {
    const g = entry.graph,
      core = new Set(mapping),
      seen = new Set(),
      result = [];
    for (let start = 0; start < g.atoms.length; start++) {
      if (core.has(start) || seen.has(start) || g.atoms[start].z === 1)
        continue;
      const keep = new Set(),
        stack = [start],
        attachments = [];
      seen.add(start);
      while (stack.length) {
        const a = stack.pop();
        keep.add(a);
        for (const k of g.adj[a]) {
          const b = g.bonds[k],
            other = b.atoms[0] === a ? b.atoms[1] : b.atoms[0];
          if (core.has(other))
            attachments.push({ at: a, coreAtom: other, bo: b.bo });
          else if (g.atoms[other].z !== 1 && !seen.has(other)) {
            seen.add(other);
            stack.push(other);
          }
        }
      }
      if (!attachments.length) continue; // Disconnected salts/solvents are not R groups.
      if (attachments.length !== 1) return null; // Keep fused/bridged cores as separate Murcko series.
      const a = attachments[0];
      result.push({
        keep: [...keep],
        coreAtom: a.coreAtom,
        bo: a.bo,
        signature: canonical(R, g, keep, [{ at: a.at, bo: a.bo }]),
      });
    }
    return result;
  }
  function mapped(R, entry, core, symmetry, reference) {
    const matches = JSON.parse(entry.mol.get_substruct_matches(core) || '[]');
    if (!Array.isArray(matches) || !matches.length) return null;
    let best = null,
      bestCost = Infinity;
    for (const match of matches.slice(0, 64)) {
      // Ordinary molecule queries can be broader than a scaffold diagram.
      // Require exact elements, formal charges and aromaticity on its core atoms.
      if (
        match.atoms.some((a, i) => {
          const source = entry.graph.atoms[a],
            query = symmetry.coreGraph.atoms[i];
          return (
            source.z !== query.z ||
            source.chg !== query.chg ||
            entry.graph.aromaticAtoms.has(a) !==
              symmetry.coreGraph.aromaticAtoms.has(i)
          );
        })
      )
        continue;
      const parts = components(R, entry, match.atoms);
      if (!parts) continue;
      for (const perm of symmetry.maps) {
        const atoms = perm.map((i) => match.atoms[i]),
          inverse = new Map(atoms.map((a, i) => [a, i]));
        const byPosition = atoms.map(() => []);
        parts.forEach((p) => byPosition[inverse.get(p.coreAtom)].push(p));
        byPosition.forEach((p) =>
          p.sort((a, b) => a.signature.localeCompare(b.signature)),
        );
        const tokens = byPosition.map((p) =>
          p.map((x) => x.signature).join(' + '),
        );
        const cost = reference
          ? tokens.reduce(
              (sum, t, i) =>
                sum +
                (t === reference.tokens[i]
                  ? 0
                  : !t || !reference.tokens[i]
                    ? 4
                    : 1),
              0,
            )
          : 0;
        if (cost < bestCost) {
          bestCost = cost;
          best = {
            atoms,
            byPosition,
            tokens,
            limited: symmetry.limited || matches.length > 64,
          };
        }
        if (cost === 0) return best;
      }
    }
    return best;
  }
  function sketch(mol, labels = {}) {
    mol.set_new_coords();
    return mol.get_svg_with_highlights(
      JSON.stringify({ width: 560, height: 350, atomLabels: labels }),
    );
  }
  function buildCore(R, entries, coreSmiles) {
    const core = R.get_mol(coreSmiles);
    if (!core) return null;
    try {
      const unique = new Set(entries.map((e) => e.canonical));
      if (unique.size === 1)
        return {
          coreSmiles,
          templateSmiles: core.get_smiles(),
          svg: sketch(core),
          groups: [],
          count: entries.length,
          status: 'single',
          limited: false,
        };
      const symmetry = symmetries(graph(core));
      symmetry.coreGraph = graph(core);
      const ordered = [...entries].sort(
        (a, b) =>
          b.graph.atoms.length - a.graph.atoms.length ||
          a.row.sourceRow - b.row.sourceRow,
      );
      const anchor = mapped(R, ordered[0], core, symmetry, null);
      if (!anchor) return null;
      const matches = [anchor];
      for (const e of ordered.slice(1)) {
        const m = mapped(R, e, core, symmetry, anchor);
        if (!m) return null;
        matches.push(m);
      }
      const keep = new Set(anchor.atoms),
        dummies = [],
        groups = [];
      for (let position = 0; position < anchor.atoms.length; position++) {
        const counts = matches.map((m) => {
          const c = new Map();
          m.byPosition[position].forEach((p) =>
            c.set(p.signature, (c.get(p.signature) || 0) + 1),
          );
          return c;
        });
        const shared = new Map();
        for (const [s, n] of counts[0])
          shared.set(
            s,
            Math.min(n, ...counts.slice(1).map((c) => c.get(s) || 0)),
          );
        const fixedLeft = new Map(shared);
        anchor.byPosition[position].forEach((p) => {
          const n = fixedLeft.get(p.signature) || 0;
          if (n) {
            p.keep.forEach((a) => keep.add(a));
            fixedLeft.set(p.signature, n - 1);
          }
        });
        const remaining = matches.map((m) => {
          const left = new Map(shared);
          return m.byPosition[position].filter((p) => {
            const n = left.get(p.signature) || 0;
            if (n) {
              left.set(p.signature, n - 1);
              return false;
            }
            return true;
          });
        });
        const max = Math.max(...remaining.map((p) => p.length));
        if (!max) continue;
        const orders = new Set(remaining.flatMap((p) => p.map((x) => x.bo)));
        if (orders.size !== 1) return null; // A single R bond must not hide changing bond types.
        const labels = [];
        for (let i = 0; i < max; i++) {
          const label = dummies.length + 1;
          labels.push('R' + label);
          dummies.push({
            at: anchor.atoms[position],
            bo: [...orders][0],
            label,
          });
        }
        const values = new Map();
        remaining.forEach((parts) => {
          const text = [
            ...parts.map((p) => p.signature),
            ...Array(max - parts.length).fill('H'),
          ]
            .sort()
            .join(' + ');
          values.set(text, (values.get(text) || 0) + 1);
        });
        groups.push({
          labels,
          variants: values.size,
          values: [...values].map(([smiles, count]) => ({ smiles, count })),
        });
      }
      const template = R.get_mol(block(ordered[0].graph, keep, dummies));
      if (!template) return null;
      try {
        const fixed = R.get_mol(block(ordered[0].graph, keep));
        if (!fixed) return null;
        let fixedCoreSmiles;
        try {
          if (
            entries.some(
              (e) =>
                !JSON.parse(e.mol.get_substruct_match(fixed)).atoms?.length,
            )
          )
            return null;
          fixedCoreSmiles = fixed.get_smiles();
        } finally {
          fixed.delete();
        }
        const atomLabels = {};
        dummies.forEach((d, i) => {
          atomLabels[keep.size + i] = 'R' + d.label;
        });
        return {
          coreSmiles,
          fixedCoreSmiles,
          templateSmiles: template.get_smiles(),
          svg: sketch(template, atomLabels),
          groups,
          count: entries.length,
          status: groups.length ? 'variable' : 'constant',
          limited: matches.some((m) => m.limited),
        };
      } finally {
        template.delete();
      }
    } finally {
      core.delete();
    }
  }
  root.ClusterScaffolds = {
    build(R, rows, clusterId) {
      const entries = [];
      try {
        for (const row of rows) {
          const mol = R.get_mol(row.canonical || row.smiles);
          if (!mol) throw Error(`无法读取 ${row.id} 的结构`);
          const entry = {
            row,
            mol,
            graph: graph(mol),
            canonical: mol.get_smiles(),
            seed: '',
            acyclic: false,
          };
          entries.push(entry);
          const scaffold = root.Scaffolds.get(R, mol, false);
          try {
            entry.seed = scaffold.smiles || entry.canonical;
            entry.acyclic = !scaffold.smiles;
          } finally {
            scaffold.mol?.delete();
          }
        }
        if (!entries.length) throw Error('结构簇没有成员');
        const seeds = [...new Set(entries.map((e) => e.seed))]
          .map((s) => {
            const m = R.get_mol(s);
            try {
              return {
                smiles: s,
                size: JSON.parse(m.get_json()).molecules[0].atoms.length,
              };
            } finally {
              m?.delete();
            }
          })
          .sort((a, b) => b.size - a.size || a.smiles.localeCompare(b.smiles));
        for (const seed of seeds) {
          const result = buildCore(R, entries, seed.smiles);
          if (result)
            return {
              clusterId,
              total: rows.length,
              mode: 'shared',
              cores: [{ ...result, acyclic: entries.every((e) => e.acyclic) }],
              disconnected: rows.filter((r) => r.multi).length,
            };
        }
        const families = new Map();
        entries.forEach((e) => {
          if (!families.has(e.seed)) families.set(e.seed, []);
          families.get(e.seed).push(e);
        });
        const cores = [];
        for (const [seed, family] of families) {
          const result = buildCore(R, family, seed);
          if (result)
            cores.push({ ...result, acyclic: family.every((e) => e.acyclic) });
          else {
            // Every record remains represented if attachment chemistry cannot be collapsed.
            const structures = new Map();
            family.forEach((e) => {
              if (!structures.has(e.canonical)) structures.set(e.canonical, []);
              structures.get(e.canonical).push(e);
            });
            for (const records of structures.values())
              cores.push({
                ...buildCore(R, records, seed),
                acyclic: records.every((e) => e.acyclic),
                status: 'unresolved',
              });
          }
        }
        cores.sort(
          (a, b) =>
            b.count - a.count || a.coreSmiles.localeCompare(b.coreSmiles),
        );
        return {
          clusterId,
          total: rows.length,
          mode: 'series',
          cores,
          disconnected: rows.filter((r) => r.multi).length,
        };
      } finally {
        entries.forEach((e) => e.mol.delete());
      }
    },
  };
})(typeof self !== 'undefined' ? self : globalThis);

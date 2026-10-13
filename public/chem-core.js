/* Shared deterministic chemistry algorithms, used by the analysis worker and tests. */
(function (root) {
  const popcount = (x) => {
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  };
  function pack(bits) {
    const words = new Uint32Array(bits.length / 32);
    let count = 0;
    for (let k = 0; k < bits.length; k++)
      if (bits[k] === '1') {
        words[k >>> 5] |= 1 << (k & 31);
        count++;
      }
    return { words, count };
  }
  function similarity(a, b) {
    let hit = 0;
    for (let k = 0; k < a.fp.length; k++) hit += popcount(a.fp[k] & b.fp[k]);
    const union = a.bits + b.bits - hit;
    return union ? hit / union : 1;
  }
  function analyze(rows, threshold, progress = () => {}) {
    const n = rows.length,
      dist = new Float32Array((n * (n - 1)) / 2),
      neighbors = Array.from({ length: n }, () => []);
    const index = (a, b) =>
      a > b ? (a * (a - 1)) / 2 + b : (b * (b - 1)) / 2 + a;
    const d = (a, b) => (a === b ? 0 : dist[index(a, b)]);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < i; j++) {
        const s = similarity(rows[i], rows[j]);
        dist[index(i, j)] = 1 - s;
        if (s + 1e-12 >= threshold) {
          neighbors[i].push(j);
          neighbors[j].push(i);
        }
      }
      if (i % 80 === 0)
        progress(35 + Math.round((40 * i) / n), '计算分子间 Tanimoto 相似度');
    }
    const used = new Uint8Array(n),
      degree = neighbors.map((a) => a.length),
      clusters = [];
    for (let assigned = 0; assigned < n;) {
      let center = -1;
      for (let i = 0; i < n; i++)
        if (!used[i] && (center < 0 || degree[i] > degree[center])) center = i;
      const members = [center, ...neighbors[center].filter((i) => !used[i])];
      const id = clusters.length + 1;
      members.forEach((i) => {
        used[i] = 1;
        rows[i].cluster = id;
        rows[i].center = i === center;
        rows[i].centerSimilarity = similarity(rows[i], rows[center]);
      });
      assigned += members.length;
      members.forEach((i) =>
        neighbors[i].forEach((j) => {
          if (!used[j]) degree[j]--;
        }),
      );
      clusters.push({ id, center, size: members.length, members });
    }
    progress(83, '生成化学空间投影');
    const coords = Array.from({ length: n }, () => [0, 0, 0]);
    for (let axis = 0; axis < 3; axis++) {
      const residual = (a, b) =>
        Math.max(
          0,
          d(a, b) ** 2 -
            coords[a]
              .slice(0, axis)
              .reduce((sum, v, k) => sum + (v - coords[b][k]) ** 2, 0),
        );
      let a = 0,
        b = 0;
      for (let iter = 0; iter < 5; iter++) {
        let far = -1;
        for (let i = 0; i < n; i++) {
          const value = residual(a, i);
          if (value > far) {
            far = value;
            b = i;
          }
        }
        [a, b] = [b, a];
      }
      const length = Math.sqrt(residual(a, b));
      if (length < 1e-9) continue;
      for (let i = 0; i < n; i++)
        coords[i][axis] =
          (residual(a, i) + length * length - residual(b, i)) / (2 * length);
    }
    rows.forEach((row, i) => {
      row.x = coords[i][0];
      row.y = coords[i][1];
      row.z = coords[i][2];
    });
    return clusters;
  }
  function addSelection(selected, record, rows, limit = Infinity) {
    if (selected.includes(record.key))
      return { selected: selected.filter((k) => k !== record.key) };
    if (selected.length >= limit)
      return { error: '初筛候选已达 ' + limit + ' 个，请先移除一些分子。' };
    if (
      rows.some(
        (r) => selected.includes(r.key) && r.canonical === record.canonical,
      )
    )
      return { error: '候选中已有相同规范结构。请保留一个供应商记录。' };
    return { selected: [...selected, record.key] };
  }
  function retain(rows, retention) {
    if (!retention) return rows;
    const { limit, rank } = retention;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      !['mmgbsa', 'docking', 'source'].includes(rank)
    )
      throw Error('保留数量必须是正整数，并选择有效的排名依据。');
    const eligible = rows.filter(
      (r) => rank === 'source' || Number.isFinite(r[rank]),
    );
    if (!eligible.length)
      throw Error('当前排名依据没有有效分数，请改用原始顺序或检查分数映射。');
    return eligible
      .sort(
        (a, b) =>
          (rank === 'source' ? 0 : a[rank] - b[rank]) ||
          a.sourceRow - b.sourceRow,
      )
      .slice(0, limit);
  }
  root.ChemCore = { pack, similarity, analyze, addSelection, retain };
})(globalThis);

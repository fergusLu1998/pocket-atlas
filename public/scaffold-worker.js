importScripts(
  '/rdkit/RDKit_minimal.js',
  '/scaffold.js',
  '/cluster-scaffolds.js',
);
onmessage = async function (event) {
  try {
    const R = await initRDKitModule({
      locateFile: () => '/rdkit/RDKit_minimal.wasm',
    });
    const clusters = event.data.clusters;
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      try {
        postMessage({
          type: 'result',
          summary: ClusterScaffolds.build(R, cluster.rows, cluster.id),
        });
      } catch (error) {
        postMessage({
          type: 'result',
          summary: {
            clusterId: cluster.id,
            total: cluster.rows.length,
            mode: 'error',
            cores: [],
            error: error.message,
          },
        });
      }
      postMessage({
        type: 'progress',
        completed: i + 1,
        total: clusters.length,
      });
    }
    postMessage({ type: 'complete' });
  } catch (error) {
    postMessage({ type: 'error', message: error.message });
  }
};

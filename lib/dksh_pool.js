// The renderer's DKSH cache (shadercache_dksh.bin): every shader of deko3d_glsl.bin in the variants the renderer asks
// for, plus the ones a console run listed (release/fh1_variants.txt), compiled by uam. FH1-nx's dksh_precompile does it
// on the PC with --jobs N; here N workers (dksh_worker.js) each run one --shard and the first merges them, which gives
// the same file. Without it the console compiles each variant itself the first time (seconds each, the objects that
// use it not drawn meanwhile).

// spawn: lib/dxc_pool.js's (spawnWebWorker) or Node's. Returns the cache's bytes.
export async function buildDkshCache(base, count, spawn, glslPackage, variants, log = () => {}) {
  const workers = [];
  for (let i = 0; i < count; i++) {
    workers.push(spawn(new URL('dksh_worker.js', base).href));
  }
  const request = (w, message) => new Promise((resolve, reject) => {
    w.listen((m) => {
      if (m.error) {
        reject(new Error(m.error));
      } else {
        resolve(m);
      }
    });
    w.post(message);
  });
  try {
    await Promise.all(workers.map((w) => request(w, { type: 'init', base })));
    log(`Compiling the shader cache with ${count} workers`);
    let finished = 0;
    const parts = await Promise.all(workers.map(async (w, k) => {
      const { bytes } = await request(w, { type: 'shard', k, n: count, pkg: glslPackage, list: variants });
      log(`Shader cache: part ${++finished}/${count} compiled`);
      return bytes;
    }));
    const { bytes } = await request(workers[0], { type: 'merge', parts });
    return bytes;
  } finally {
    workers.forEach((w) => w.stop());
  }
}
